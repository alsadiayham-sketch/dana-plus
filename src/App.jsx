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
    pickupLocations: [
      { id: 'pickup-1', name: 'نقطة استلام نابلس' },
      { id: 'pickup-2', name: 'نقطة استلام رام الله' },
    ],
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
    pickupLocations: data.pickupLocations || defaults.pickupLocations,
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
    const salePrice = normalizedSalePrice(product, item.salePrice)
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

function normalizedSalePrice(product, value) {
  const wholesalePrice = Number(product?.representativePrice) || 0
  const suggestedPrice = Number(product?.sellingPrice) || wholesalePrice
  return Math.max(wholesalePrice, Number(value) || suggestedPrice)
}

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [data, setData] = useState(loadData)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(() => newSaleDraft())
  const [authState, setAuthState] = useState(firebaseConfigured ? 'checking' : 'unavailable')
  const [remoteReady, setRemoteReady] = useState(false)
  const [remoteError, setRemoteError] = useState('')
  const [modal, setModal] = useState('')
  const [confirmation, setConfirmation] = useState(null)
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

  const metrics = useMemo(() => data.sales.filter((sale) => sale.status === 'مكتمل').reduce((sum, sale) => {
    const values = saleValues(sale, data.products)
    sum.sales += values.productTotal
    sum.danaProfit += values.danaProfit
    sum.repProfit += values.repProfit
    sum.delivery += values.deliveryFee
    return sum
  }, { sales: 0, danaProfit: 0, repProfit: 0, delivery: 0 }), [data])
  const lastMonthProfit = useMemo(() => {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 1)
    return data.sales.filter((sale) => sale.status === 'مكتمل' && new Date(`${sale.date}T00:00:00`) >= from && new Date(`${sale.date}T00:00:00`) < to).reduce((sum, sale) => sum + saleValues(sale, data.products).danaProfit, 0)
  }, [data])

  const repSummary = useMemo(() => data.representatives.map((representative) => {
    const completedSales = data.sales.filter((sale) => sale.repId === representative.id && sale.status === 'مكتمل')
    const values = completedSales.map((sale) => saleValues(sale, data.products))
    const paid = data.payments.filter((payment) => payment.repId === representative.id && payment.status === 'مكتمل').reduce((sum, payment) => sum + Number(payment.amount), 0)
    const repProfit = values.reduce((sum, value) => sum + value.repProfit, 0)
    return {
      ...representative,
      orderCount: completedSales.length,
      rejectedCount: data.sales.filter((sale) => sale.repId === representative.id && sale.status === 'ملغي').length,
      sales: values.reduce((sum, value) => sum + value.productTotal, 0),
      danaProfit: values.reduce((sum, value) => sum + value.danaProfit, 0),
      repProfit,
      paid,
      due: repProfit - paid,
    }
  }).sort((first, second) => second.sales - first.sales), [data])

  const topProducts = useMemo(() => {
    const quantities = new Map()
    data.sales.filter((sale) => sale.status === 'مكتمل').forEach((sale) => (sale.items || []).forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) || 0) + Number(item.quantity))))
    return [...quantities.entries()].map(([id, quantity]) => ({ ...data.products.find((product) => product.id === id), quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 4)
  }, [data])

  const saveSale = (event) => {
    event.preventDefault()
    const cleanItems = draft.items.filter((item) => item.productId && Number(item.quantity) > 0).map((item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId)
      return { ...item, salePrice: normalizedSalePrice(product, item.salePrice) }
    })
    if (!draft.customerName.trim() || !cleanItems.length) {
      setNotice('أضيفي اسم العميلة ومنتجًا واحدًا على الأقل.')
      return
    }
    const savedSale = { ...draft, id: String(Date.now()), items: cleanItems, date: draft.date || new Date().toISOString().slice(0, 10) }
    setData((current) => ({ ...current, sales: [savedSale, ...current.sales] }))
    setDraft(newSaleDraft())
    setConfirmation(savedSale)
  }

  const updateProduct = (id, field, value) => setData((current) => ({
    ...current,
    products: current.products.map((product) => {
      if (product.id !== id) return product
      const nextValue = ['purchasePrice', 'representativePrice', 'sellingPrice'].includes(field) ? Number(value) || 0 : value
      const updated = { ...product, [field]: nextValue }
      if (field === 'representativePrice') updated.sellingPrice = Math.max(Number(product.sellingPrice) || 0, nextValue)
      if (field === 'sellingPrice') updated.sellingPrice = Math.max(Number(product.representativePrice) || 0, nextValue)
      return updated
    }),
  }))

  const addProduct = (product) => {
    const id = `product-${Date.now()}`
    setData((current) => ({ ...current, products: [{ id, ...product }, ...current.products] }))
    setNotice('أُضيف المنتج إلى الكتالوج.')
  }
  const removeProduct = (id) => setData((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) }))

  const updateDelivery = (id, field, value) => setData((current) => ({
    ...current,
    deliveries: current.deliveries.map((delivery) => delivery.id === id ? { ...delivery, [field]: field === 'fee' ? Number(value) || 0 : value } : delivery),
  }))
  const addPickupLocation = (name) => setData((current) => ({ ...current, pickupLocations: [...current.pickupLocations, { id: `pickup-${Date.now()}`, name }] }))
  const updatePickupLocation = (id, name) => setData((current) => ({ ...current, pickupLocations: current.pickupLocations.map((location) => location.id === id ? { ...location, name } : location) }))
  const removePickupLocation = (id) => setData((current) => ({ ...current, pickupLocations: current.pickupLocations.filter((location) => location.id !== id) }))

  const addRepresentative = (representative) => {
    const id = `rep-${Date.now()}`
    setData((current) => ({ ...current, representatives: [...current.representatives, { id, ...representative }] }))
  }

  const updateRepresentative = (id, field, value) => setData((current) => ({
    ...current,
    representatives: current.representatives.map((representative) => representative.id === id ? { ...representative, [field]: value } : representative),
  }))

  const savePayment = (payment) => {
    setData((current) => ({ ...current, payments: [{ ...payment, status: 'معلق', id: String(Date.now()) }, ...current.payments] }))
    setNotice('تم حفظ الدفعة كمعلّقة. لن يتغير المستحق حتى اعتمادها كمكتملة.')
  }
  const updatePaymentStatus = (id, status) => setData((current) => ({ ...current, payments: current.payments.map((payment) => payment.id === id ? { ...payment, status } : payment) }))
  const updateSaleStatus = (id, status) => setData((current) => ({ ...current, sales: current.sales.map((sale) => sale.id === id ? { ...sale, status } : sale) }))

  if (authState === 'checking') return <main className="auth-shell" dir="rtl"><div className="auth-card"><span className="brand-mark">د+</span><h1>دانا بلس</h1><p>جارٍ فتح مساحة العمل…</p></div></main>
  if (authState !== 'authenticated') return <LoginScreen unavailable={authState === 'unavailable'} onLogin={async (email, password) => signInWithEmailAndPassword(auth, email, password)} />

  const navItems = [
    ['dashboard', 'لوحة التحكم'],
    ['sale', 'تسجيل عملية بيع'],
    ['sales', 'المبيعات'],
    ['cancelled', 'الطلبات الملغاة'],
    ['products', 'المنتجات والأسعار'],
    ['representatives', 'المندوبات'],
    ['payments', 'دفعات المندوبات'],
    ['pickup-locations', 'نقاط الاستلام'],
    ['delivery', 'التوصيل'],
  ]

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">د+</span><div><strong>دانا بلس</strong><span>إدارة المبيعات</span></div></div>
        <nav aria-label="التنقل الرئيسي">
          {navItems.map(([id, label]) => <button className={activePage === id ? 'nav-item active' : 'nav-item'} key={id} aria-current={activePage === id ? 'page' : undefined} onClick={() => setActivePage(id)}>{label}</button>)}
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

        {activePage === 'dashboard' && <Dashboard metrics={metrics} lastMonthProfit={lastMonthProfit} orderCount={data.sales.filter((sale) => sale.status === 'مكتمل').length} representatives={repSummary} products={topProducts} sales={data.sales} onRepresentatives={() => setActivePage('representatives')} onSales={() => setActivePage('sales')} />}
        {activePage === 'sale' && <SaleForm draft={draft} setDraft={setDraft} representatives={data.representatives} products={data.products} deliveries={data.deliveries} pickupLocations={data.pickupLocations} onSubmit={saveSale} />}
        {activePage === 'sales' && <SalesTable sales={data.sales} products={data.products} representatives={data.representatives} deliveries={data.deliveries} pickupLocations={data.pickupLocations} onStatusChange={updateSaleStatus} />}
        {activePage === 'cancelled' && <SalesTable sales={data.sales.filter((sale) => sale.status === 'ملغي')} products={data.products} representatives={data.representatives} deliveries={data.deliveries} pickupLocations={data.pickupLocations} onStatusChange={updateSaleStatus} title="الطلبات الملغاة" />}
        {activePage === 'products' && <Products products={data.products} onChange={updateProduct} onRemove={removeProduct} onAdd={() => setModal('product')} />}
        {activePage === 'representatives' && <Representatives summaries={repSummary} onAdd={() => setModal('representative')} onChange={updateRepresentative} />}
        {activePage === 'payments' && <Payments representatives={repSummary} payments={data.payments} onSave={savePayment} onStatusChange={updatePaymentStatus} />}
        {activePage === 'pickup-locations' && <PickupLocations locations={data.pickupLocations} onAdd={() => setModal('pickup')} onChange={updatePickupLocation} onRemove={removePickupLocation} />}
        {activePage === 'delivery' && <Delivery deliveries={data.deliveries} onChange={updateDelivery} />}
      </main>
      {modal === 'product' && <ProductModal onClose={() => setModal('')} onSave={(product) => { addProduct(product); setModal('') }} />}
      {modal === 'representative' && <RepresentativeModal onClose={() => setModal('')} onSave={(representative) => { addRepresentative(representative); setModal('') }} />}
      {modal === 'pickup' && <PickupLocationModal onClose={() => setModal('')} onSave={(name) => { addPickupLocation(name); setModal('') }} />}
      {confirmation && <OrderConfirmation sale={confirmation} products={data.products} deliveries={data.deliveries} pickupLocations={data.pickupLocations} onClose={() => { setConfirmation(null); setActivePage('sales') }} />}
    </div>
  )
}

function newSaleDraft() {
  return { repId: 'r1', items: [{ productId: '', quantity: 1, salePrice: '' }], delivery: 'pickup', pickupLocation: 'pickup-1', deliveryAddress: '', deliveryFee: 0, customerName: '', status: 'جديد', date: new Date().toISOString().slice(0, 10), notes: '' }
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

function Dashboard({ metrics, lastMonthProfit, orderCount, representatives, products, sales, onRepresentatives, onSales }) {
  const attentionOrders = sales.filter((sale) => ['جديد', 'قيد التجهيز'].includes(sale.status))
  return <><section className="dashboard-summary"><div><p className="eyebrow">ملخص معتمد</p><h2>الأرقام المالية أدناه تشمل الطلبات المكتملة فقط</h2></div><span className="read-only-label">تُحتسب تلقائيًا</span></section><section className="metric-grid" aria-label="ملخص المبيعات المكتملة"><Metric title="إجمالي مبيعات المنتجات" value={currency.format(metrics.sales)} detail={`${orderCount} طلبات مكتملة`} /><Metric title="صافي ربح دانا" value={currency.format(metrics.danaProfit)} detail="من الطلبات المكتملة" accent /><Metric title="ربح الشهر الماضي" value={currency.format(lastMonthProfit)} detail="صافي ربح دانا" /><Metric title="أرباح المندوبات" value={currency.format(metrics.repProfit)} detail="من الطلبات المكتملة" /></section>{attentionOrders.length > 0 && <section className="attention-queue" aria-labelledby="attention-title"><div className="panel-heading"><div><p className="eyebrow">تحتاج متابعة</p><h2 id="attention-title">{attentionOrders.length} طلبات جديدة أو قيد التجهيز</h2><p>هذه الطلبات تشغيلية ولا تدخل في الأرباح قبل اكتمالها.</p></div><button className="secondary-button queue-action" onClick={onSales}>عرض كل الطلبات</button></div><div className="queue-list">{attentionOrders.slice(0, 4).map((sale) => <div className="queue-row" key={sale.id}><div><strong>{sale.customerName}</strong><span>{sale.date}</span></div><StatusBadge status={sale.status} /><span>{sale.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0} قطع</span></div>)}</div></section>}<section className="content-grid"><article className="panel"><div className="panel-heading"><div><h2>أداء المندوبات</h2><p>المبيعات والأرباح المحتسبة لكل مندوبة</p></div><button className="text-button" onClick={onRepresentatives}>إدارة المندوبات</button></div><div className="rep-list">{representatives.map((representative) => <div className="rep-row" key={representative.id}><span className="rep-avatar">{representative.name.slice(0, 1)}</span><div className="rep-name"><strong>{representative.name}</strong><span>{representative.area} · {representative.orderCount} مكتمل</span></div><div><span className="small-label">مبيعات</span><strong>{currency.format(representative.sales)}</strong></div><div className="profit"><span className="small-label">ربح دانا</span><strong>{currency.format(representative.danaProfit)}</strong></div></div>)}</div></article><article className="panel insight"><p className="eyebrow">الأكثر مبيعًا</p><h2>المنتجات التي تتحرك الآن</h2>{products.length ? <ol className="top-products">{products.map((product) => <li key={product.id}><span>{product.name}</span><strong>{product.quantity} قطع</strong></li>)}</ol> : <p>أول طلب سيظهر أداء المنتجات هنا.</p>}</article></section></>
}

function SaleForm({ draft, setDraft, representatives, products, deliveries, pickupLocations, onSubmit }) {
  const values = saleValues(draft, products)
  const updateItem = (index, field, value) => setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: field === 'quantity' ? Number(value) || 1 : value } : item) }))
  const selectProduct = (index, productId) => {
    const product = products.find((item) => item.id === productId)
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, productId, salePrice: normalizedSalePrice(product) } : item) }))
  }
  const selectDelivery = (id) => {
    const delivery = deliveries.find((item) => item.id === id)
    setDraft((current) => ({ ...current, delivery: id, deliveryFee: delivery?.fee || 0 }))
  }
  const fulfilmentField = draft.delivery === 'pickup'
    ? <Field label="نقطة الاستلام"><select value={draft.pickupLocation} onChange={(event) => setDraft({ ...draft, pickupLocation: event.target.value })}>{pickupLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
    : <Field label="عنوان أو موقع التوصيل"><input required value={draft.deliveryAddress} onChange={(event) => setDraft({ ...draft, deliveryAddress: event.target.value })} placeholder="اكتبي موقع التسليم" /></Field>
  return <section className="sale-layout"><form className="panel sale-form" onSubmit={onSubmit}><div className="panel-heading"><div><h2>تفاصيل الطلب</h2><p>سعر البيع الفعلي لا ينقص عن سعر الجملة، وربح دانا يبقى ثابتًا.</p></div></div><div className="form-columns"><Field label="اسم العميلة"><input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required /></Field><Field label="المندوبة"><select value={draft.repId} onChange={(event) => setDraft({ ...draft, repId: event.target.value })}>{representatives.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} — {representative.area}</option>)}</select></Field></div><div className="line-items"><div className="line-items-heading"><strong>المنتجات</strong><button className="text-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { productId: '', quantity: 1, salePrice: '' }] })}>+ إضافة منتج</button></div>{draft.items.map((item, index) => <ProductPicker item={item} products={products} key={index} onSelect={(productId) => selectProduct(index, productId)} onChange={(field, value) => updateItem(index, field, value)} onRemove={draft.items.length > 1 ? () => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }) : null} />)}</div><div className="form-columns"><Field label="طريقة التسليم"><select value={draft.delivery} onChange={(event) => selectDelivery(event.target.value)}>{deliveries.map((delivery) => <option value={delivery.id} key={delivery.id}>{delivery.label} — {currency.format(delivery.fee)}</option>)}</select></Field><Field label="رسوم التوصيل"><input type="number" min="0" value={draft.deliveryFee} onChange={(event) => setDraft({ ...draft, deliveryFee: Number(event.target.value) || 0 })} /></Field><Field label="تاريخ الطلب"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field><Field label="الحالة"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>جديد</option><option>قيد التجهيز</option><option>مكتمل</option><option>ملغي</option></select></Field></div>{fulfilmentField}<Field label="ملاحظات العميلة"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field><button className="primary-button full-width" type="submit">حفظ عملية البيع</button></form><SalePreview values={values} status={draft.status} /></section>
}

function ProductPicker({ item, products, onSelect, onChange, onRemove }) {
  const [query, setQuery] = useState('')
  const selected = products.find((product) => product.id === item.productId)
  const matches = products.filter((product) => `${product.name} ${product.brand} ${product.category}`.includes(query.trim()))
  const wholesalePrice = Number(selected?.representativePrice) || 0
  return <div className="sale-item product-picker"><div className="product-search"><input aria-label="ابحثي عن منتج" placeholder="ابحثي باسم المنتج…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <div className="search-results">{matches.slice(0, 6).map((product) => <button type="button" key={product.id} onClick={() => { onSelect(product.id); setQuery('') }}><span>{product.name}</span><small>{currency.format(normalizedSalePrice(product))}</small></button>)}</div>}</div><strong className="selected-product">{selected?.name || 'ابحثي واختاري منتجًا'}</strong><label className="compact-item-field">الكمية<input aria-label="الكمية" type="number" min="1" value={item.quantity} onChange={(event) => onChange('quantity', event.target.value)} /></label><label className="sale-price-field">سعر البيع الفعلي<input aria-label="سعر البيع الفعلي" type="number" min={wholesalePrice} value={selected ? normalizedSalePrice(selected, item.salePrice) : ''} disabled={!selected} onChange={(event) => onChange('salePrice', Number(event.target.value) || wholesalePrice)} /><small>{selected ? `الحد الأدنى سعر الجملة: ${currency.format(wholesalePrice)}` : 'اختاري منتجًا أولًا'}</small></label>{onRemove && <button className="remove-button" type="button" onClick={onRemove}>حذف</button>}</div>
}

function Products({ products, onChange, onRemove, onAdd }) {
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>كتالوج دانا بلس</h2><p>عدّلي سعر التكلفة وسعر الجملة وسعر البيع المقترح لكل منتج.</p></div><button className="primary-button" onClick={onAdd}>إضافة منتج</button></div><div className="product-table"><div className="product-table-head"><span>المنتج والتصنيف</span><span>سعر التكلفة</span><span>سعر الجملة</span><span>سعر البيع المقترح</span><span>إجراء</span></div>{products.map((product) => <div className="product-table-row" key={product.id}><div><input aria-label="اسم المنتج" value={product.name} onChange={(event) => onChange(product.id, 'name', event.target.value)} /><input aria-label="التصنيف" className="sub-input" value={product.category} onChange={(event) => onChange(product.id, 'category', event.target.value)} /></div>{['purchasePrice', 'representativePrice', 'sellingPrice'].map((field) => <input aria-label={`${field} ${product.name}`} key={field} type="number" min={field === 'sellingPrice' ? product.representativePrice : 0} value={product[field]} onChange={(event) => onChange(product.id, field, event.target.value)} />)}<button className="remove-button" onClick={() => onRemove(product.id)}>حذف</button></div>)}</div></section>
}

function Representatives({ summaries, onAdd, onChange }) {
  const [query, setQuery] = useState('')
  const shown = summaries.filter((rep) => `${rep.name} ${rep.area}`.includes(query))
  return <section className="panel"><div className="panel-heading"><div><h2>حسابات المندوبات</h2><p>تظهر العمولات والدفعات المكتملة فقط في المستحق.</p></div><button className="primary-button" onClick={onAdd}>إضافة مندوبة</button>  </div><label className="sr-only" htmlFor="rep-search">ابحثي عن مندوبة</label><input id="rep-search" className="rep-search" placeholder="ابحثي عن مندوبة…" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="representative-cards">{shown.map((representative) => <article className="representative-card" key={representative.id}><div className="rep-card-heading"><span className="rep-avatar large">{representative.name.slice(0, 1)}</span><span className="editable-label">بيانات قابلة للتعديل</span></div><input aria-label="اسم المندوبة" value={representative.name} onChange={(event) => onChange(representative.id, 'name', event.target.value)} /><input aria-label="منطقة المندوبة" className="sub-input" value={representative.area} onChange={(event) => onChange(representative.id, 'area', event.target.value)} /><div className="computed-value"><span>مبيعات مكتملة</span><strong>{representative.orderCount}</strong></div><div className="computed-value"><span>مبيعات مرفوضة</span><strong>{representative.rejectedCount}</strong></div><div className="computed-value"><span>ربح المندوبة</span><strong>{currency.format(representative.repProfit)}</strong></div><div className="computed-value"><span>دُفع لها</span><strong>{currency.format(representative.paid)}</strong></div><div className="computed-value highlight"><span>المستحق لها</span><strong>{currency.format(representative.due)}</strong></div></article>)}</div></section>
}

function Payments({ representatives, payments, onSave, onStatusChange }) {
  const [draft, setDraft] = useState(() => ({ repId: representatives[0]?.id || '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' }))
  const submit = (event) => {
    event.preventDefault()
    if (!draft.repId || Number(draft.amount) <= 0) return
    onSave({ ...draft, amount: Number(draft.amount) })
    setDraft((current) => ({ ...current, amount: '', notes: '' }))
  }
  return <section className="payment-layout"><form className="panel payment-form" onSubmit={submit}><div className="panel-heading"><div><h2>تسجيل دفعة للمندوبة</h2><p>تُحفظ الدفعة معلّقة افتراضيًا، ولا تخفّض المستحق قبل اعتمادها.</p></div><StatusBadge status="معلق" /></div><Field label="المندوبة"><select value={draft.repId} onChange={(event) => setDraft({ ...draft, repId: event.target.value })}>{representatives.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} — المستحق {currency.format(representative.due)}</option>)}</select></Field><div className="form-columns"><Field label="المبلغ المدفوع"><input type="number" min="1" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} required /></Field><Field label="تاريخ الدفعة"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field></div><Field label="ملاحظة"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="مثال: تحويل بنكي" /></Field><button className="primary-button full-width" type="submit">حفظ الدفعة كمعلّقة</button></form><aside className="panel payment-history"><div className="panel-heading"><div><h2>آخر الدفعات</h2><p>تؤثر المكتملة فقط في الرصيد.</p></div></div>{payments.length ? payments.map((payment) => { const representative = representatives.find((item) => item.id === payment.repId); const status = payment.status || 'مكتمل'; return <div className="payment-row" key={payment.id}><div><strong>{representative?.name}</strong><small>{payment.date}{payment.notes ? ` · ${payment.notes}` : ''}</small></div><div className="payment-status"><StatusBadge status={status} /><label className="sr-only" htmlFor={`payment-${payment.id}`}>تحديث حالة دفعة {representative?.name}</label><select id={`payment-${payment.id}`} value={status} onChange={(event) => onStatusChange(payment.id, event.target.value)}><option>مكتمل</option><option>معلق</option><option>ملغي</option></select></div><strong>{currency.format(payment.amount)}</strong></div> }) : <p>لا توجد دفعات مسجلة بعد.</p>}</aside></section>
}

function Delivery({ deliveries, onChange }) {
  return <section className="panel delivery-panel"><div className="panel-heading"><div><h2>رسوم التوصيل</h2><p>تُضاف تلقائيًا عند اختيار المنطقة، ويمكن تعديلها داخل الطلب.</p></div></div>{deliveries.map((delivery) => <label className="delivery-row" key={delivery.id}><span><strong>{delivery.label}</strong><small>تسعيرة افتراضية للطلبات الجديدة</small></span><input type="number" min="0" value={delivery.fee} onChange={(event) => onChange(delivery.id, 'fee', event.target.value)} /><b>₪</b></label>)}</section>
}

function PickupLocations({ locations, onAdd, onChange, onRemove }) {
  return <section className="panel delivery-panel"><div className="panel-heading"><div><h2>نقاط الاستلام</h2><p>تظهر هذه القائمة عند اختيار الاستلام من نقطة البيع.</p></div><button className="primary-button" onClick={onAdd}>إضافة نقطة</button></div>{locations.map((location) => <label className="delivery-row" key={location.id}><span><strong>نقطة استلام</strong><small>اسم يظهر للمندوبة والعميلة  </small></span><input value={location.name} onChange={(event) => onChange(location.id, event.target.value)} /><button className="remove-button" onClick={() => onRemove(location.id)}>حذف</button></label>)}</section>
}

  function PickupLocationModal({ onClose, onSave }) {
    const [name, setName] = useState('')
    return <Modal title="إضافة نقطة استلام" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(name) }}><Field label="اسم النقطة"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></Field><button className="primary-button">حفظ النقطة</button></form></Modal>
  }

function SalePreview({ values, status }) {
  return <aside className="panel sale-preview" aria-label="قيم محسوبة تلقائيًا"><div className="panel-heading"><div><p className="eyebrow">معاينة تلقائية</p><h2>ملخص هذا الطلب</h2></div><span className="read-only-label">قراءة فقط</span></div><p className="helper-text preview-status">سيُعتمد هذا الأثر المالي عند اكتمال الطلب. الحالة الحالية: <StatusBadge status={status} /></p><div className="calculation"><span>منتجات للعميلة</span><strong>{currency.format(values.productTotal)}</strong></div><div className="calculation"><span>رسوم التوصيل</span><strong>{currency.format(values.deliveryFee)}</strong></div><div className="calculation"><span>المبلغ المطلوب</span><strong>{currency.format(values.total)}</strong></div><div className="calculation"><span>ربح المندوبة</span><strong>{currency.format(values.repProfit)}</strong></div><div className="calculation total"><span>ربح دانا</span><strong>{currency.format(values.danaProfit)}</strong></div><p className="helper-text">تكلفة المنتجات: {currency.format(values.cost)}</p></aside>
}

function SalesTable({ sales, products, representatives, onStatusChange, title = 'كل المبيعات' }) {
  const [filter, setFilter] = useState('الكل')
  const shown = filter === 'الكل' ? sales : sales.filter((sale) => sale.status === filter)
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{title}</h2><p>{shown.length} عمليات ظاهرة · الأرباح لا تظهر إلا للطلبات المكتملة</p></div><label className="filter-field">تصفية الحالة<select className="status-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option>الكل</option><option>جديد</option><option>قيد التجهيز</option><option>مكتمل</option><option>ملغي</option></select></label></div><div className="sales-table"><div className="sales-head"><span>التاريخ</span><span>العميلة / المندوبة</span><span>المنتجات</span><span>الحالة</span><span>إجمالي العميلة</span><span>ربح دانا</span></div>{shown.map((sale) => { const value = saleValues(sale, products); const representative = representatives.find((item) => item.id === sale.repId); return <div className="sales-row" key={sale.id}><span data-label="التاريخ">{sale.date}</span><span data-label="العميلة / المندوبة"><strong>{sale.customerName}</strong><small>{representative?.name}</small></span><span data-label="المنتجات">{(sale.items || []).map((item) => `${products.find((product) => product.id === item.productId)?.name || 'منتج'} × ${item.quantity}`).join('، ')}</span><div className="status-control" data-label="الحالة"><StatusBadge status={sale.status} /><label className="sr-only" htmlFor={`status-${sale.id}`}>تحديث حالة طلب {sale.customerName}</label><select id={`status-${sale.id}`} value={sale.status} onChange={(event) => onStatusChange(sale.id, event.target.value)}><option>جديد</option><option>قيد التجهيز</option><option>مكتمل</option><option>ملغي</option></select></div><strong data-label="إجمالي العميلة">{currency.format(value.total)}</strong><strong className="profit" data-label="ربح دانا">{sale.status === 'مكتمل' ? currency.format(value.danaProfit) : 'غير معتمد بعد'}</strong></div> })}</div></section>
}

function ProductModal({ onClose, onSave }) {
  const [product, setProduct] = useState({ name: '', brand: '', category: '', purchasePrice: '', representativePrice: '', sellingPrice: '' })
  const submit = (event) => {
    event.preventDefault()
    const representativePrice = Number(product.representativePrice)
    onSave({ ...product, purchasePrice: Number(product.purchasePrice), representativePrice, sellingPrice: Math.max(representativePrice, Number(product.sellingPrice)) })
  }
  return <Modal title="إضافة منتج" onClose={onClose}><form className="modal-form" onSubmit={submit}><Field label="اسم المنتج"><input autoFocus required value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></Field><div className="form-columns"><Field label="العلامة التجارية"><input required value={product.brand} onChange={(event) => setProduct({ ...product, brand: event.target.value })} /></Field><Field label="التصنيف"><input required value={product.category} onChange={(event) => setProduct({ ...product, category: event.target.value })} /></Field></div><div className="form-columns"><Field label="سعر التكلفة"><input required type="number" min="0" value={product.purchasePrice} onChange={(event) => setProduct({ ...product, purchasePrice: event.target.value })} /></Field><Field label="سعر الجملة"><input required type="number" min="0" value={product.representativePrice} onChange={(event) => setProduct({ ...product, representativePrice: event.target.value })} /></Field><Field label="سعر البيع المقترح"><input required type="number" min={product.representativePrice || 0} value={product.sellingPrice} onChange={(event) => setProduct({ ...product, sellingPrice: event.target.value })} /></Field></div><button className="primary-button">حفظ المنتج</button></form></Modal>
}

function RepresentativeModal({ onClose, onSave }) {
  const [representative, setRepresentative] = useState({ name: '', area: '', phone: '' })
  return <Modal title="إضافة مندوبة" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave(representative) }}><Field label="الاسم"><input required value={representative.name} onChange={(event) => setRepresentative({ ...representative, name: event.target.value })} /></Field><Field label="المنطقة"><input required value={representative.area} onChange={(event) => setRepresentative({ ...representative, area: event.target.value })} /></Field><Field label="رقم الهاتف"><input value={representative.phone} onChange={(event) => setRepresentative({ ...representative, phone: event.target.value })} /></Field><button className="primary-button">حفظ المندوبة</button></form></Modal>
}

function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="panel-heading"><h2>{title}</h2><button className="text-button" onClick={onClose}>إغلاق</button></div>{children}</section></div>
}

function OrderConfirmation({ sale, products, deliveries, pickupLocations, onClose }) {
  const delivery = deliveries.find((item) => item.id === sale.delivery)
  const location = sale.delivery === 'pickup' ? pickupLocations.find((item) => item.id === sale.pickupLocation)?.name : sale.deliveryAddress
  const details = [`طلب ${sale.customerName}`, ...sale.items.map((item) => { const product = products.find((candidate) => candidate.id === item.productId); return `${product?.name} × ${item.quantity}` }), `التسليم: ${sale.delivery === 'pickup' ? 'استلام' : delivery?.label}`, `الموقع: ${location || '—'}`, `المبلغ: ${currency.format(saleValues(sale, products).total)}`].join('\n')
  return <Modal title="تم حفظ الطلب" onClose={onClose}><p className="confirmation-copy">راجعي الطلب ثم انسخي تفاصيله لإرسالها للعميلة.</p><pre className="order-copy">{details}</pre><button className="primary-button full-width" onClick={() => navigator.clipboard.writeText(details)}>نسخ تفاصيل الطلب</button></Modal>
}

function Metric({ title, value, detail, accent = false }) {
  return <article className={accent ? 'metric-card accent' : 'metric-card'}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>
}

function StatusBadge({ status }) {
  const tone = {
    'جديد': 'new',
    'قيد التجهيز': 'progress',
    'مكتمل': 'complete',
    'معلق': 'pending',
    'ملغي': 'cancelled',
  }[status] || 'neutral'
  return <span className={`status-badge status-${tone}`}>{status}</span>
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export default App
