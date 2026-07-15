import { useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import catalogSeed from './catalog-seed.json'
import { auth, db, firebaseConfigured } from './firebase'
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
    products: catalogSeed.map((product) => ({ ...product, category: product.brand === 'assaf' || product.name.includes('عطر') ? 'عطور' : 'عناية' })),
    representatives: seedRepresentatives,
    deliveries: seedDeliveries,
    sales: initialSales,
    payments: [],
  }
}

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!stored?.products || !stored?.sales) return createData()
    return {
      ...stored,
      products: stored.products.map(({ stock: _stock, ...product }) => product),
      payments: stored.payments || [],
    }
  } catch {
    return createData()
  }
}

function normalizeData(data) {
  const defaults = createData()
  return {
    products: (data.products || defaults.products).map(({ stock: _stock, ...product }) => product),
    representatives: data.representatives || defaults.representatives,
    deliveries: data.deliveries || defaults.deliveries,
    sales: data.sales || defaults.sales,
    payments: data.payments || [],
  }
}

function saleValues(sale, products) {
  const items = sale.items || [{ productId: sale.productId, quantity: sale.quantity }]
  const result = items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId)
    if (!product) return sum
    const quantity = Number(item.quantity) || 0
    const salePrice = Math.max(product.sellingPrice, Number(item.salePrice) || product.sellingPrice)
    sum.productTotal += salePrice * quantity
    sum.cost += product.purchasePrice * quantity
    sum.danaProfit += (product.representativePrice - product.purchasePrice) * quantity
    sum.repProfit += (salePrice - product.representativePrice) * quantity
    sum.itemCount += quantity
    return sum
  }, { productTotal: 0, cost: 0, danaProfit: 0, repProfit: 0, itemCount: 0 })
  const deliveryFee = Number(sale.deliveryFee) || 0
  return { ...result, deliveryFee, total: result.productTotal + deliveryFee }
}

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [data, setData] = useState(loadData)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(() => newSaleDraft())
  const [authState, setAuthState] = useState(firebaseConfigured ? 'checking' : 'unavailable')
  const [remoteReady, setRemoteReady] = useState(false)
  const [remoteError, setRemoteError] = useState('')
  const applyingSnapshot = useRef(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, (user) => setAuthState(user ? 'authenticated' : 'unauthenticated'))
  }, [])

  useEffect(() => {
    if (authState !== 'authenticated' || !db) return undefined
    const project = doc(db, 'projects', 'dana-plus')
    return onSnapshot(project, (snapshot) => {
      if (snapshot.exists()) {
        applyingSnapshot.current = true
        setData(normalizeData(snapshot.data()))
      }
      setRemoteReady(true)
      setRemoteError('')
    }, () => setRemoteError('تعذر الاتصال ببيانات Firebase. تأكدي من قواعد Firestore ثم أعيدي المحاولة.'))
  }, [authState])

  useEffect(() => {
    if (authState !== 'authenticated' || !remoteReady || !db) return
    if (applyingSnapshot.current) {
      applyingSnapshot.current = false
      return
    }
    setDoc(doc(db, 'projects', 'dana-plus'), { ...data, updatedAt: serverTimestamp() }, { merge: true })
      .catch(() => setRemoteError('تعذر حفظ التعديل في Firebase.'))
  }, [authState, data, remoteReady])

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
    const paid = data.payments.filter((payment) => payment.repId === representative.id).reduce((sum, payment) => sum + Number(payment.amount), 0)
    const repProfit = values.reduce((sum, value) => sum + value.repProfit, 0)
    return {
      ...representative,
      orderCount: values.length,
      sales: values.reduce((sum, value) => sum + value.productTotal, 0),
      danaProfit: values.reduce((sum, value) => sum + value.danaProfit, 0),
      repProfit,
      paid,
      due: repProfit - paid,
    }
  }).sort((first, second) => second.sales - first.sales), [data])

  const topProducts = useMemo(() => {
    const quantities = new Map()
    data.sales.forEach((sale) => (sale.items || []).forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) || 0) + Number(item.quantity))))
    return [...quantities.entries()].map(([id, quantity]) => ({ ...data.products.find((product) => product.id === id), quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 4)
  }, [data])

  const saveSale = (event) => {
    event.preventDefault()
    const cleanItems = draft.items.filter((item) => item.productId && Number(item.quantity) > 0).map((item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId)
      return { ...item, salePrice: Math.max(product?.sellingPrice || 0, Number(item.salePrice) || product?.sellingPrice || 0) }
    })
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
    products: current.products.map((product) => product.id === id ? { ...product, [field]: ['purchasePrice', 'representativePrice', 'sellingPrice'].includes(field) ? Number(value) || 0 : value } : product),
  }))

  const addProduct = () => {
    const id = `product-${Date.now()}`
    setData((current) => ({ ...current, products: [{ id, name: 'منتج جديد', brand: 'دانا بلس', category: 'عناية', purchasePrice: 0, representativePrice: 0, sellingPrice: 0 }, ...current.products] }))
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

  const savePayment = (payment) => {
    setData((current) => ({ ...current, payments: [{ ...payment, id: String(Date.now()) }, ...current.payments] }))
    setNotice('تم تسجيل الدفعة وتحديث المستحق للمندوبة.')
  }

  if (authState === 'checking') return <main className="auth-shell" dir="rtl"><div className="auth-card"><span className="brand-mark">د+</span><h1>دانا بلس</h1><p>جارٍ فتح مساحة العمل…</p></div></main>
  if (authState !== 'authenticated') return <LoginScreen unavailable={authState === 'unavailable'} onLogin={async (email, password) => signInWithEmailAndPassword(auth, email, password)} />

  const navItems = [
    ['dashboard', 'لوحة التحكم'],
    ['sale', 'تسجيل عملية بيع'],
    ['sales', 'المبيعات'],
    ['products', 'المنتجات والأسعار'],
    ['representatives', 'المندوبات'],
    ['payments', 'دفعات المندوبات'],
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
          <div className="topbar-actions"><button className="text-button logout-button" onClick={() => signOut(auth)}>تسجيل الخروج</button><button className="primary-button" onClick={() => setActivePage('sale')}>تسجيل بيع جديد</button></div>
        </header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="إغلاق">×</button></div>}
        {remoteError && <div className="notice error-notice" role="alert">{remoteError}</div>}

        {activePage === 'dashboard' && <Dashboard metrics={metrics} orderCount={data.sales.length} representatives={repSummary} products={topProducts} onRepresentatives={() => setActivePage('representatives')} />}
        {activePage === 'sale' && <SaleForm draft={draft} setDraft={setDraft} representatives={data.representatives} products={data.products} deliveries={data.deliveries} onSubmit={saveSale} />}
        {activePage === 'sales' && <SalesTable sales={data.sales} products={data.products} representatives={data.representatives} deliveries={data.deliveries} />}
        {activePage === 'products' && <Products products={data.products} onChange={updateProduct} onAdd={addProduct} />}
        {activePage === 'representatives' && <Representatives summaries={repSummary} onAdd={addRepresentative} onChange={updateRepresentative} />}
        {activePage === 'payments' && <Payments representatives={repSummary} payments={data.payments} onSave={savePayment} />}
        {activePage === 'delivery' && <Delivery deliveries={data.deliveries} onChange={updateDelivery} />}
      </main>
    </div>
  )
}

function newSaleDraft() {
  return { repId: 'r1', items: [{ productId: 'dana-1', quantity: 1, salePrice: catalogSeed[0].sellingPrice }], delivery: 'pickup', deliveryFee: 0, customerName: '', status: 'جديد', date: new Date().toISOString().slice(0, 10), notes: '' }
}

function LoginScreen({ unavailable, onLogin }) {
  const [email, setEmail] = useState('dana@mail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onLogin(email, password)
    } catch {
      setError('تعذر تسجيل الدخول. تأكدي من البريد وكلمة المرور.')
    } finally {
      setLoading(false)
    }
  }
  return <main className="auth-shell" dir="rtl"><form className="auth-card" onSubmit={submit}><span className="brand-mark">د+</span><p className="eyebrow">مساحة دانا الخاصة</p><h1>تسجيل الدخول</h1><p>{unavailable ? 'إعدادات Firebase غير مكتملة لهذا النشر.' : 'أدخلي بيانات Firebase للوصول إلى حسابات المبيعات.'}</p><label className="field">البريد الإلكتروني<input type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} required /></label><label className="field">كلمة المرور<input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading ? 'جارٍ الدخول…' : 'دخول'}</button></form></main>
}

function Dashboard({ metrics, orderCount, representatives, products, onRepresentatives }) {
  return <><section className="metric-grid" aria-label="ملخص المبيعات"><Metric title="إجمالي مبيعات المنتجات" value={currency.format(metrics.sales)} detail={`${orderCount} طلبات مسجلة`} /><Metric title="صافي ربح دانا" value={currency.format(metrics.danaProfit)} detail="من فرق الجملة والتكلفة" accent /><Metric title="أرباح المندوبات" value={currency.format(metrics.repProfit)} detail="من فرق البيع والجملة" /><Metric title="رسوم التوصيل" value={currency.format(metrics.delivery)} detail="تُضاف إلى إجمالي العميلة" /></section><section className="content-grid"><article className="panel"><div className="panel-heading"><div><h2>أداء المندوبات</h2><p>المبيعات والأرباح المحتسبة لكل مندوبة</p></div><button className="text-button" onClick={onRepresentatives}>إدارة المندوبات</button></div><div className="rep-list">{representatives.map((representative) => <div className="rep-row" key={representative.id}><span className="rep-avatar">{representative.name.slice(0, 1)}</span><div className="rep-name"><strong>{representative.name}</strong><span>{representative.area} · {representative.orderCount} طلبات</span></div><div><span className="small-label">مبيعات</span><strong>{currency.format(representative.sales)}</strong></div><div className="profit"><span className="small-label">ربح دانا</span><strong>{currency.format(representative.danaProfit)}</strong></div></div>)}</div></article><article className="panel insight"><p className="eyebrow">الأكثر مبيعًا</p><h2>المنتجات التي تتحرك الآن</h2>{products.length ? <ol className="top-products">{products.map((product) => <li key={product.id}><span>{product.name}</span><strong>{product.quantity} قطع</strong></li>)}</ol> : <p>أول طلب سيظهر أداء المنتجات هنا.</p>}</article></section></>
}

function SaleForm({ draft, setDraft, representatives, products, deliveries, onSubmit }) {
  const values = saleValues(draft, products)
  const updateItem = (index, field, value) => setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: field === 'quantity' ? Number(value) || 1 : value } : item) }))
  const selectProduct = (index, productId) => {
    const product = products.find((item) => item.id === productId)
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, productId, salePrice: product?.sellingPrice || 0 } : item) }))
  }
  const selectDelivery = (id) => {
    const delivery = deliveries.find((item) => item.id === id)
    setDraft((current) => ({ ...current, delivery: id, deliveryFee: delivery?.fee || 0 }))
  }
  return <section className="sale-layout"><form className="panel sale-form" onSubmit={onSubmit}><div className="panel-heading"><div><h2>تفاصيل الطلب</h2><p>سعر البيع الفعلي لا ينقص عن سعر العميل، وربح دانا يبقى ثابتًا.</p></div></div><div className="form-columns"><Field label="اسم العميلة"><input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required /></Field><Field label="المندوبة"><select value={draft.repId} onChange={(event) => setDraft({ ...draft, repId: event.target.value })}>{representatives.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} — {representative.area}</option>)}</select></Field></div><div className="line-items"><div className="line-items-heading"><strong>المنتجات</strong><button className="text-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { productId: products[0]?.id || '', quantity: 1, salePrice: products[0]?.sellingPrice || 0 }] })}>+ إضافة منتج</button></div>{draft.items.map((item, index) => <ProductPicker item={item} products={products} key={index} onSelect={(productId) => selectProduct(index, productId)} onChange={(field, value) => updateItem(index, field, value)} onRemove={draft.items.length > 1 ? () => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }) : null} />)}</div><div className="form-columns"><Field label="طريقة التسليم"><select value={draft.delivery} onChange={(event) => selectDelivery(event.target.value)}>{deliveries.map((delivery) => <option value={delivery.id} key={delivery.id}>{delivery.label} — {currency.format(delivery.fee)}</option>)}</select></Field><Field label="رسوم التوصيل"><input type="number" min="0" value={draft.deliveryFee} onChange={(event) => setDraft({ ...draft, deliveryFee: Number(event.target.value) || 0 })} /></Field><Field label="تاريخ الطلب"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field><Field label="الحالة"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>جديد</option><option>قيد التجهيز</option><option>مكتمل</option><option>ملغي</option></select></Field></div><Field label="ملاحظات العميلة"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field><button className="primary-button full-width" type="submit">حفظ عملية البيع</button></form><SalePreview values={values} /></section>
}

function ProductPicker({ item, products, onSelect, onChange, onRemove }) {
  const [query, setQuery] = useState('')
  const selected = products.find((product) => product.id === item.productId)
  const matches = products.filter((product) => `${product.name} ${product.brand} ${product.category}`.includes(query.trim()))
  return <div className="sale-item product-picker"><input aria-label="ابحثي عن منتج" placeholder="ابحثي باسم المنتج…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="اختيار المنتج" value={item.productId} onChange={(event) => onSelect(event.target.value)}>{matches.map((product) => <option value={product.id} key={product.id}>{product.name} — من {currency.format(product.sellingPrice)}</option>)}</select><input aria-label="الكمية" type="number" min="1" value={item.quantity} onChange={(event) => onChange('quantity', event.target.value)} /><input aria-label="سعر البيع الفعلي" type="number" min={selected?.sellingPrice || 0} value={Math.max(selected?.sellingPrice || 0, Number(item.salePrice) || 0)} onChange={(event) => onChange('salePrice', Number(event.target.value) || selected?.sellingPrice || 0)} /><small>سعر البيع الفعلي · الحد الأدنى {currency.format(selected?.sellingPrice || 0)}</small>{onRemove && <button className="remove-button" type="button" onClick={onRemove}>حذف</button>}</div>
}

function Products({ products, onChange, onAdd }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>كتالوج دانا بلس</h2><p>عدّلي الأسعار التي تحدد ربح دانا والمندوبة في كل عملية.</p></div><button className="primary-button" onClick={onAdd}>إضافة منتج</button></div><div className="product-table"><div className="product-table-head"><span>المنتج والتصنيف</span><span>التكلفة</span><span>سعر المندوبة</span><span>أقل سعر للعميلة</span></div>{products.map((product) => <div className="product-table-row" key={product.id}><div><input aria-label="اسم المنتج" value={product.name} onChange={(event) => onChange(product.id, 'name', event.target.value)} /><input aria-label="التصنيف" className="sub-input" value={product.category} onChange={(event) => onChange(product.id, 'category', event.target.value)} /></div>{['purchasePrice', 'representativePrice', 'sellingPrice'].map((field) => <input aria-label={`${field} ${product.name}`} key={field} type="number" min="0" value={product[field]} onChange={(event) => onChange(product.id, field, event.target.value)} />)}</div>)}</div></section>
}

function Representatives({ summaries, onAdd, onChange }) {
  return <section className="panel"><div className="panel-heading"><div><h2>حسابات المندوبات</h2><p>تظهر العمولات، الدفعات المسجلة، وما تبقى لكل مندوبة.</p></div><button className="primary-button" onClick={onAdd}>إضافة مندوبة</button></div><div className="representative-cards">{summaries.map((representative) => <article className="representative-card" key={representative.id}><span className="rep-avatar large">{representative.name.slice(0, 1)}</span><input aria-label="اسم المندوبة" value={representative.name} onChange={(event) => onChange(representative.id, 'name', event.target.value)} /><input aria-label="منطقة المندوبة" className="sub-input" value={representative.area} onChange={(event) => onChange(representative.id, 'area', event.target.value)} /><div><span>ربح المندوبة</span><strong>{currency.format(representative.repProfit)}</strong></div><div><span>دُفع لها</span><strong>{currency.format(representative.paid)}</strong></div><div className="highlight"><span>المستحق لها</span><strong>{currency.format(representative.due)}</strong></div><div><span>ربح دانا الثابت</span><strong>{currency.format(representative.danaProfit)}</strong></div></article>)}</div></section>
}

function Payments({ representatives, payments, onSave }) {
  const [draft, setDraft] = useState(() => ({ repId: representatives[0]?.id || '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' }))
  const submit = (event) => {
    event.preventDefault()
    if (!draft.repId || Number(draft.amount) <= 0) return
    onSave({ ...draft, amount: Number(draft.amount) })
    setDraft((current) => ({ ...current, amount: '', notes: '' }))
  }
  return <section className="payment-layout"><form className="panel payment-form" onSubmit={submit}><div className="panel-heading"><div><h2>تسجيل دفعة للمندوبة</h2><p>سجّلي ما دُفع فعليًا ليظهر الرصيد المتبقي بدقة.</p></div></div><Field label="المندوبة"><select value={draft.repId} onChange={(event) => setDraft({ ...draft, repId: event.target.value })}>{representatives.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} — المستحق {currency.format(representative.due)}</option>)}</select></Field><div className="form-columns"><Field label="المبلغ المدفوع"><input type="number" min="1" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} required /></Field><Field label="تاريخ الدفعة"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field></div><Field label="ملاحظة"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="مثال: تحويل بنكي" /></Field><button className="primary-button full-width" type="submit">حفظ الدفعة</button></form><aside className="panel payment-history"><h2>آخر الدفعات</h2>{payments.length ? payments.map((payment) => { const representative = representatives.find((item) => item.id === payment.repId); return <div className="payment-row" key={payment.id}><div><strong>{representative?.name}</strong><small>{payment.date}{payment.notes ? ` · ${payment.notes}` : ''}</small></div><strong>{currency.format(payment.amount)}</strong></div> }) : <p>لا توجد دفعات مسجلة بعد.</p>}</aside></section>
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
