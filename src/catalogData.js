const text = (value) => typeof value === 'string' ? value.trim() : ''

function safeImageUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim())
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function normalizeProduct(product) {
  const price = Number(product?.representativePrice)
  return {
    id: text(product?.id),
    name: text(product?.name),
    brand: text(product?.brand),
    category: text(product?.category),
    representativePrice: Number.isFinite(price) ? price : 0,
    images: Array.isArray(product?.images) ? product.images.map(safeImageUrl).filter(Boolean) : [],
    description: text(product?.description),
    sizes: Array.isArray(product?.sizes) ? product.sizes.map(text).filter(Boolean) : [],
  }
}

export function publicCatalogPayload(products) {
  return {
    products: (Array.isArray(products) ? products : [])
      .map(normalizeProduct)
      .filter((product) => product.id && product.name),
  }
}
