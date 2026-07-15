import { useEffect, useMemo, useState } from 'react'
import catalogSeed from './catalog-seed.json'
import './App.css'

const STORAGE_KEY = 'dana-plus-data-v1'
const currency = new Intl.NumberFormat('ar-PS', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const seedDeliveries = [
  { id: 'pickup', label: 'استلام من نقطة البيع', fee: 0 },
  { id: 'west-bank', label: 'مدن الضفة', fee: 20 },
  { id: 'jerusalem', label: 'القدس', fee: 30 },
  { id: 'inside', label: 'الداخل', fee: 70 },
]

const seedRepresentatives = [
  { id: 'r1', name: 'سما أحمد', area: 'نابلس', phone: '0590000001' },
  { id: 'r2', name: 'لين محمود', area: 'رام الله', phone: '0590000002' },
  { id: 'r3', name: 'نور علي', area: 'جنين', phone: '0590000003' },
]

const initialSales = [
  { id: '1', repId: 'r1', items: [{ productId: 'dana-1', quantity: 2 }], delivery: 'west-bank', deliveryFee: 20, customerName: 'هبة', status: 'مكتمل', date: '2026-07-14', notes: '' },
  { id: '2', repId: 'r2', items: [{ productId: 'dana-2', quantity: 1 }], delivery: 'pickup', deliveryFee: 0, customerName: 'رنا', status: 'مكتمل', date: '2026-07-14', notes: '' },
  { id: '3', repId: 'r1', items: [{ productId: 'dana-3', quantity: 1 }], delivery: 'west-bank', deliveryFee: 20, customerName: 'سارة', status: 'قيد التجهيز', date: '2026-07-13', notes: '' },
]

function createData() {
  return {
    products: catalogSeed.map((product) => ({ ...product, category: product.brand === 'assaf' || product.name.includes('عطر') ? 'عطور' : 'عناية', stock: 10 })),
    representatives: seedRepresentatives,
    deliveries: seedDeliveries,
    sales: initialSales,
  }
}

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return stored && stored.products && stored.sales ? stored : createData()
  } catch {
    return createData()
  }
}

function saleValues(sale, products) {
  const items = sale.items || [{ productId: sale.productId, quantity: sale.quantity }]
  const result = items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId)
    if (!product) return sum
    const quantity = Number(item.quantity) || 0
    sum.productTotal += product.sellingPrice * quantity
    sum.cost += product.purchasePrice * quantity
    sum.danaProfit += (product.representativePrice - product.purchasePrice) * quantity
    sum.repProfit += (product.sellingPrice - product.representativePrice) * quantity
    sum.itemCount += quantity
    return sum
  }, { productTotal: 0, cost: 0, danaProfit: 0, repProfit: 0, itemCount: 0 })
  const deliveryFee = Number(sale.deliveryFee) || 0
  return { ...result, deliveryFee, total: result.productTotal + deliveryFee }
}

function App() {
  const [auth, setAuth] = useState('checking')
  const [activePage, setActivePage] = useState('dashboard')
  const [data, setData] = useState(loadData)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(() => newSaleDraft())

  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          setAuth('unauthenticated')
          return
        }
        const session = await response.json()
        setAuth(session.authenticated === true ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => setAuth('unavailable'))
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const metrics = useMemo(() => data.sales.reduce((sum, sale) => {
    const values = saleValues(sale, data.products)
    sum.sales += values.productTotal
    sum.danaProfit += values.danaProfit
    sum.repProfit += values.repProfit
    sum.delivery += values.deliveryFee
    return sum
  }, { sales: 0, danaProfit: 0, repProfit: 0, delivery: 0 }), [data])

  const repSummary = useMemo(() => data.representatives.map((representative) => {
    const values = data.sales.filter((sale) => sale.repId === representative.id).map((sale) => saleValues(sale, data.products))
    return {
      ...representative,
      orderCount: values.length,
      sales: values.reduce((sum, value) => sum + value.productTotal, 0),
      danaProfit: values.reduce((sum, value) => sum + value.danaProfit, 0),
      repProfit: values.reduce((sum, value) => sum + value.repProfit, 0),
    }
  }).sort((first, second) => second.sales - first.sales), [data])

  const topProducts = useMemo(() => {
    const quantities = new Map()
    data.sales.forEach((sale) => (sale.items || []).forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) || 0) + Number(item.quantity))))
    return [...quantities.entries()].map(([id, quantity]) => ({ ...data.products.find((product) => product.id === id), quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 4)
  }, [data])

  const saveSale = (event) => {
    event.preventDefault()
    const cleanItems = draft.items.filter((item) => item.productId && Number(item.quantity) > 0)
    if (!draft.customerName.trim() || !cleanItems.length) {
      setNotice('أضيفي اسم العميلة ومنتجًا واحدًا على الأقل.')
      return
    }
    setData((current) => ({ ...current, sales: [{ ...draft, id: String(Date.now()), items: cleanItems, date: draft.date || new Date().toISOString().slice(0, 10) }, ...current.sales] }))
    setDraft(newSaleDraft())
    setNotice('تم حفظ الطلب وحساب الأرباح تلقائيًا.')
    setActivePage('sales')
  }

  const updateProduct = (id, field, value) => setData((current) => ({
    ...current,
    products: current.products.map((product) => product.id === id ? { ...product, [field]: ['purchasePrice', 'representativePrice', 'sellingPrice', 'stock'].includes(field) ? Number(value) || 0 : value } : product),
  }))

  const addProduct = () => {
    const id = `product-${Date.now()}`
    setData((current) => ({ ...current, products: [{ id, name: 'منتج جديد', brand: 'دانا بلس', category: 'عناية', stock: 0, purchasePrice: 0, representativePrice: 0, sellingPrice: 0 }, ...current.products] }))
    setNotice('أُضيف منتج جديد. عدّلي التفاصيل والأسعار قبل استخدامه في البيع.')
  }

  const updateDelivery = (id, field, value) => setData((current) => ({
    ...current,
    deliveries: current.deliveries.map((delivery) => delivery.id === id ? { ...delivery, [field]: field === 'fee' ? Number(value) || 0 : value } : delivery),
  }))

  const addRepresentative = () => {
    const id = `rep-${Date.now()}`
    setData((current) => ({ ...current, representatives: [...current.representatives, { id, name: 'مندوبة جديدة', area: 'المنطقة', phone: '' }] }))
  }

  const updateRepresentative = (id, field, value) => setData((current) => ({
    ...current,
    representatives: current.representatives.map((representative) => representative.id === id ? { ...representative, [field]: value } : representative),
  }))

  if (auth === 'checking') return <main className="auth-shell" dir="rtl"><div className="auth-card"><span className="brand-mark">د+</span><h1>دانا بلس</h1><p>جارٍ التحقق من الجلسة…</p></div></main>
  if (auth !== 'authenticated') return <LoginScreen unavailable={auth === 'unavailable'} onSuccess={() => setAuth('authenticated')} />

  const navItems = [
    ['dashboard', 'لوحة التحكم'],
    ['sale', 'تسجيل عملية بيع'],
    ['sales', 'المبيعات'],
    ['products', 'المنتجات والأسعار'],
    ['representatives', 'المندوبات'],
    ['delivery', 'التوصيل'],
  ]

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">د+</span><div><strong>دانا بلس</strong><span>إدارة المبيعات</span></div></div>
        <nav aria-label="التنقل الرئيسي">
          {navItems.map(([id, label]) => <button className={activePage === id ? 'nav-item active' : 'nav-item'} key={id} onClick={() => setActivePage(id)}>{label}</button>)}
        </nav>
        <div className="sidebar-footer"><span className="admin-avatar">د</span><div><strong>دانا</strong><span>المديرة</span></div></div>
      </aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">حساباتك محفوظة على هذا الجهاز</p><h1>{navItems.find(([id]) => id === activePage)?.[1]}</h1></div>
          <button className="primary-button" onClick={() => setActivePage('sale')}>تسجيل بيع جديد</button>
        </header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="إغلاق">×</button></div>}

        {activePage === 'dashboard' && <Dashboard metrics={metrics} orderCount={data.sales.length} representatives={repSummary} products={topProducts} onRepresentatives={() => setActivePage('representatives')} />}
        {activePage === 'sale' && <SaleForm draft={draft} setDraft={setDraft} representatives={data.representatives} products={data.products} deliveries={data.deliveries} onSubmit={saveSale} />}
        {activePage === 'sales' && <SalesTable sales={data.sales} products={data.products} representatives={data.representatives} deliveries={data.deliveries} />}
        {activePage === 'products' && <Products products={data.products} onChange={updateProduct} onAdd={addProduct} />}
        {activePage === 'representatives' && <Representatives summaries={repSummary} onAdd={addRepresentative} onChange={updateRepresentative} />}
        {activePage === 'delivery' && <Delivery deliveries={data.deliveries} onChange={updateDelivery} />}
      </main>
    </div>
  )
}

function newSaleDraft() {
  return { repId: 'r1', items: [{ productId: 'dana-1', quantity: 1 }], delivery: 'pickup', deliveryFee: 0, customerName: '', status: 'جديد', date: new Date().toISOString().slice(0, 10), notes: '' }
}

function LoginScreen({ unavailable, onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const login = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null
      if (!response.ok || result?.ok !== true) throw new Error('invalid')
      onSuccess()
    } catch {
      setError('بيانات الدخول غير صحيحة أو أن خدمة الدخول غير متاحة.')
    }
  }
  return <main className="auth-shell" dir="rtl"><form className="auth-card" onSubmit={login}><span className="brand-mark">د+</span><p className="eyebrow">نظام إدارة مبيعات المندوبات</p><h1>مرحبًا دانا</h1><p>{unavailable ? 'شغّلي التطبيق عبر Cloudflare Pages بعد إعداد أسرار الدخول.' : 'سجّلي الدخول لمتابعة حساباتك.'}</p><label className="field">اسم المستخدم<input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} required /></label><label className="field">كلمة المرور<input value={password} type="password" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">دخول آمن</button></form></main>
}

function Dashboard({ metrics, orderCount, representatives, products, onRepresentatives }) {
  return <><section className="metric-grid" aria-label="ملخص المبيعات"><Metric title="إجمالي مبيعات المنتجات" value={currency.format(metrics.sales)} detail={`${orderCount} طلبات مسجلة`} /><Metric title="صافي ربح دانا" value={currency.format(metrics.danaProfit)} detail="من فرق الجملة والتكلفة" accent /><Metric title="أرباح المندوبات" value={currency.format(metrics.repProfit)} detail="من فرق البيع والجملة" /><Metric title="رسوم التوصيل" value={currency.format(metrics.delivery)} detail="تُضاف إلى إجمالي العميلة" /></section><section className="content-grid"><article className="panel"><div className="panel-heading"><div><h2>أداء المندوبات</h2><p>المبيعات والأرباح المحتسبة لكل مندوبة</p></div><button className="text-button" onClick={onRepresentatives}>إدارة المندوبات</button></div><div className="rep-list">{representatives.map((representative) => <div className="rep-row" key={representative.id}><span className="rep-avatar">{representative.name.slice(0, 1)}</span><div className="rep-name"><strong>{representative.name}</strong><span>{representative.area} · {representative.orderCount} طلبات</span></div><div><span className="small-label">مبيعات</span><strong>{currency.format(representative.sales)}</strong></div><div className="profit"><span className="small-label">ربح دانا</span><strong>{currency.format(representative.danaProfit)}</strong></div></div>)}</div></article><article className="panel insight"><p className="eyebrow">الأكثر مبيعًا</p><h2>المنتجات التي تتحرك الآن</h2>{products.length ? <ol className="top-products">{products.map((product) => <li key={product.id}><span>{product.name}</span><strong>{product.quantity} قطع</strong></li>)}</ol> : <p>أول طلب سيظهر أداء المنتجات هنا.</p>}</article></section></>
}

function SaleForm({ draft, setDraft, representatives, products, deliveries, onSubmit }) {
  const values = saleValues(draft, products)
  const updateItem = (index, field, value) => setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: field === 'quantity' ? Number(value) || 1 : value } : item) }))
  const selectDelivery = (id) => {
    const delivery = deliveries.find((item) => item.id === id)
    setDraft((current) => ({ ...current, delivery: id, deliveryFee: delivery?.fee || 0 }))
  }
  return <section className="sale-layout"><form className="panel sale-form" onSubmit={onSubmit}><div className="panel-heading"><div><h2>تفاصيل الطلب</h2><p>أضيفي المنتجات، ثم راجعي المبلغ والأرباح.</p></div></div><div className="form-columns"><Field label="اسم العميلة"><input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required /></Field><Field label="المندوبة"><select value={draft.repId} onChange={(event) => setDraft({ ...draft, repId: event.target.value })}>{representatives.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} — {representative.area}</option>)}</select></Field></div><div className="line-items"><div className="line-items-heading"><strong>المنتجات</strong><button className="text-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { productId: products[0]?.id || '', quantity: 1 }] })}>+ إضافة منتج</button></div>{draft.items.map((item, index) => <div className="sale-item" key={index}><select value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.name} — {currency.format(product.sellingPrice)}</option>)}</select><input aria-label="الكمية" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} />{draft.items.length > 1 && <button className="remove-button" type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}>حذف</button>}</div>)}</div><div className="form-columns"><Field label="طريقة التسليم"><select value={draft.delivery} onChange={(event) => selectDelivery(event.target.value)}>{deliveries.map((delivery) => <option value={delivery.id} key={delivery.id}>{delivery.label} — {currency.format(delivery.fee)}</option>)}</select></Field><Field label="رسوم التوصيل"><input type="number" min="0" value={draft.deliveryFee} onChange={(event) => setDraft({ ...draft, deliveryFee: Number(event.target.value) || 0 })} /></Field><Field label="تاريخ الطلب"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field><Field label="الحالة"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>جديد</option><option>قيد التجهيز</option><option>مكتمل</option><option>ملغي</option></select></Field></div><Field label="ملاحظات العميلة"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field><button className="primary-button full-width" type="submit">حفظ عملية البيع</button></form><SalePreview values={values} /></section>
}

function Products({ products, onChange, onAdd }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>كتالوج دانا بلس</h2><p>عدّلي الأسعار والمخزون، وتُستخدم الأسعار فورًا في حاسبة الأرباح.</p></div><button className="primary-button" onClick={onAdd}>إضافة منتج</button></div><div className="product-table"><div className="product-table-head"><span>المنتج والتصنيف</span><span>التكلفة</span><span>سعر المندوبة</span><span>سعر العميل</span><span>المخزون</span></div>{products.map((product) => <div className="product-table-row" key={product.id}><div><input aria-label="اسم المنتج" value={product.name} onChange={(event) => onChange(product.id, 'name', event.target.value)} /><input aria-label="التصنيف" className="sub-input" value={product.category} onChange={(event) => onChange(product.id, 'category', event.target.value)} /></div>{['purchasePrice', 'representativePrice', 'sellingPrice', 'stock'].map((field) => <input aria-label={`${field} ${product.name}`} key={field} type="number" min="0" value={product[field]} onChange={(event) => onChange(product.id, field, event.target.value)} />)}</div>)}</div></section>
}

function Representatives({ summaries, onAdd, onChange }) {
  return <section className="panel"><div className="panel-heading"><div><h2>حسابات المندوبات</h2><p>تظهر عمولات المندوبات وربح دانا من كل حساب.</p></div><button className="primary-button" onClick={onAdd}>إضافة مندوبة</button></div><div className="representative-cards">{summaries.map((representative) => <article className="representative-card" key={representative.id}><span className="rep-avatar large">{representative.name.slice(0, 1)}</span><input aria-label="اسم المندوبة" value={representative.name} onChange={(event) => onChange(representative.id, 'name', event.target.value)} /><input aria-label="منطقة المندوبة" className="sub-input" value={representative.area} onChange={(event) => onChange(representative.id, 'area', event.target.value)} /><div><span>إجمالي البيع</span><strong>{currency.format(representative.sales)}</strong></div><div><span>ربح المندوبة</span><strong>{currency.format(representative.repProfit)}</strong></div><div className="highlight"><span>ربح دانا</span><strong>{currency.format(representative.danaProfit)}</strong></div></article>)}</div></section>
}

function Delivery({ deliveries, onChange }) {
  return <section className="panel delivery-panel"><div className="panel-heading"><div><h2>رسوم التوصيل</h2><p>تُضاف تلقائيًا عند اختيار المنطقة، ويمكن تعديلها داخل الطلب.</p></div></div>{deliveries.map((delivery) => <label className="delivery-row" key={delivery.id}><span><strong>{delivery.label}</strong><small>تسعيرة افتراضية للطلبات الجديدة</small></span><input type="number" min="0" value={delivery.fee} onChange={(event) => onChange(delivery.id, 'fee', event.target.value)} /><b>₪</b></label>)}</section>
}

function SalePreview({ values }) {
  return <aside className="panel sale-preview"><p className="eyebrow">المعاينة المالية</p><h2>ملخص هذا الطلب</h2><div className="calculation"><span>منتجات للعميلة</span><strong>{currency.format(values.productTotal)}</strong></div><div className="calculation"><span>رسوم التوصيل</span><strong>{currency.format(values.deliveryFee)}</strong></div><div className="calculation"><span>المبلغ المطلوب</span><strong>{currency.format(values.total)}</strong></div><div className="calculation"><span>ربح المندوبة</span><strong>{currency.format(values.repProfit)}</strong></div><div className="calculation total"><span>ربح دانا</span><strong>{currency.format(values.danaProfit)}</strong></div><p className="helper-text">تكلفة المنتجات: {currency.format(values.cost)}</p></aside>
}

function SalesTable({ sales, products, representatives, deliveries }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>كل المبيعات</h2><p>{sales.length} عمليات مسجلة</p></div></div><div className="sales-table"><div className="sales-head"><span>التاريخ</span><span>العميلة / المندوبة</span><span>المنتجات</span><span>التسليم</span><span>إجمالي العميلة</span><span>ربح دانا</span></div>{sales.map((sale) => { const value = saleValues(sale, products); const representative = representatives.find((item) => item.id === sale.repId); const delivery = deliveries.find((item) => item.id === sale.delivery); return <div className="sales-row" key={sale.id}><span>{sale.date}</span><span><strong>{sale.customerName}</strong><small>{representative?.name}</small></span><span>{(sale.items || []).map((item) => `${products.find((product) => product.id === item.productId)?.name || 'منتج'} × ${item.quantity}`).join('، ')}</span><span>{delivery?.label || 'توصيل'}</span><strong>{currency.format(value.total)}</strong><strong className="profit">{currency.format(value.danaProfit)}</strong></div> })}</div></section>
}

function Metric({ title, value, detail, accent = false }) {
  return <article className={accent ? 'metric-card accent' : 'metric-card'}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export default App
