import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import heroImage from './assets/hero.png'
import { publicCatalogPayload } from './catalogData'
import { db, firebaseConfigured } from './firebase'
import './Catalog.css'

const catalogCurrency = new Intl.NumberFormat('ar-PS', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
})

function CatalogImage({ product }) {
  const [failed, setFailed] = useState(false)
  const image = !failed && product.images[0] ? product.images[0] : heroImage

  return <img className="catalog-image" src={image} alt={product.name} onError={() => setFailed(true)} />
}

function CatalogCard({ product }) {
  return <article className="catalog-card">
    <CatalogImage product={product} />
    <div className="catalog-card-content">
      <div className="catalog-product-meta">
        {product.brand && <span>{product.brand}</span>}
        {product.brand && product.category && <i aria-hidden="true">·</i>}
        {product.category && <span>{product.category}</span>}
      </div>
      <h2>{product.name}</h2>
      {product.description && <p className="catalog-description">{product.description}</p>}
      {product.sizes.length > 0 && <div className="catalog-sizes" aria-label="الأحجام المتوفرة">{product.sizes.map((size) => <span key={size}>{size}</span>)}</div>}
      <div className="catalog-price">
        <span>سعر الجملة</span>
        <strong>{catalogCurrency.format(product.representativePrice)}</strong>
      </div>
    </div>
  </article>
}

function CatalogState({ type, onReset }) {
  const copy = {
    loading: ['جارٍ تجهيز الكتالوج', 'نحمّل المنتجات والأسعار المتاحة للمندوبات.'],
    error: ['تعذر فتح الكتالوج', 'تحققي من الاتصال ثم أعيدي المحاولة.'],
    empty: ['لا توجد منتجات متاحة الآن', 'سيظهر الكتالوج هنا فور نشر المنتجات من مساحة الإدارة.'],
    noResults: ['لا توجد نتائج مطابقة', 'جرّبي اسمًا آخر أو اختاري كل التصنيفات.'],
  }[type]

  return <section className={`catalog-state catalog-state-${type}`} aria-live="polite">
    {type === 'loading' && <div className="catalog-skeleton" aria-hidden="true" />}
    <div>
      <h2>{copy[0]}</h2>
      <p>{copy[1]}</p>
      {(type === 'error' || type === 'noResults') && <button className="catalog-reset" type="button" onClick={onReset}>{type === 'error' ? 'إعادة المحاولة' : 'مسح البحث والتصفية'}</button>}
    </div>
  </section>
}

export default function Catalog() {
  const [phase, setPhase] = useState(firebaseConfigured && db ? 'loading' : 'error')
  const [products, setProducts] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!firebaseConfigured || !db) {
      setPhase('error')
      return undefined
    }
    setPhase('loading')
    return onSnapshot(doc(db, 'publicCatalog', 'dana-plus'), (snapshot) => {
      const catalog = publicCatalogPayload(snapshot.exists() ? snapshot.data()?.products : [])
      setProducts(catalog.products)
      setPhase('ready')
    }, () => setPhase('error'))
  }, [retry])

  const categories = useMemo(() => [...new Set(products.map((product) => product.category).filter(Boolean))].sort(), [products])
  const shown = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return products.filter((product) => {
      const matchesCategory = !category || product.category === category
      const searchable = [product.name, product.brand, product.category, product.description, ...product.sizes].join(' ').toLocaleLowerCase()
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [category, products, query])
  const resetFilters = () => {
    setQuery('')
    setCategory('')
  }

  let content
  if (phase === 'loading') content = <CatalogState type="loading" />
  else if (phase === 'error') content = <CatalogState type="error" onReset={() => setRetry((value) => value + 1)} />
  else if (!products.length) content = <CatalogState type="empty" />
  else if (!shown.length) content = <CatalogState type="noResults" onReset={resetFilters} />
  else content = <div className="catalog-grid">{shown.map((product) => <CatalogCard key={product.id} product={product} />)}</div>

  return <main className="catalog-page" dir="rtl">
    <div className="catalog-shell">
      <header className="catalog-header">
        <a className="catalog-brand" href="/catalog" aria-label="كتالوج دانا بلس">
          <span className="brand-mark">د+</span>
          <span><strong>دانا بلس</strong><small>كتالوج المندوبات</small></span>
        </a>
        <div>
          <p>المنتجات المتاحة للمندوبات</p>
          <h1>كتالوج الجملة</h1>
        </div>
      </header>

      <section className="catalog-toolbar" aria-label="البحث والتصفية">
        <label className="catalog-search">
          <span>البحث عن منتج</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحثي بالاسم أو العلامة…" type="search" />
        </label>
        <label className="catalog-filter">
          <span>التصنيف</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">كل التصنيفات</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </section>
      {phase === 'ready' && products.length > 0 && <p className="catalog-count">{shown.length} {shown.length === 1 ? 'منتج ظاهر' : 'منتجات ظاهرة'}</p>}
      {content}
    </div>
  </main>
}
