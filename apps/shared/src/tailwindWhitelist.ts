// Minimal Tailwind whitelist and CSS mappings used as a JS fallback when the
// Rust/wasm renderer isn't available. Kept intentionally small to mirror
// entries in `crates/themed-styler/theme.yaml`.

type CssMap = Record<string, string>

const spacingMap: Record<string, string> = {
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '7': '28px',
  '8': '32px',
  '9': '36px',
  '10': '40px',
  '11': '44px',
  '12': '48px',
}

export function isTailwindClassWhitelisted(cls: string) {
  if (!cls) return false
  if (cls === 'flex' || cls === 'flex-col' || cls === 'w-screen' || cls === 'h-screen' || cls === 'w-full' || cls === 'h-full') return true
  // p-N
  const p = cls.match(/^p-(\d+)$/)
  if (p && spacingMap[p[1]]) return true
  // px-N / py-N
  if (/^px-\d+$/.test(cls) || /^py-\d+$/.test(cls)) {
    const m = cls.split('-')[1]
    return !!spacingMap[m]
  }
  // pt/pr/pb/pl
  if (/^p[trbl]-\d+$/.test(cls)) {
    const m = cls.split('-')[1]
    return !!spacingMap[m]
  }
  // fallback exact matches
  return false
}

export function tailwindClassToCss(cls: string): string | null {
  if (!isTailwindClassWhitelisted(cls)) return null
  if (cls === 'flex') return 'display: flex;'
  if (cls === 'flex-col') return 'display: flex; flex-direction: column;'
  if (cls === 'w-screen') return 'width: 100vw;'
  if (cls === 'h-screen') return 'height: 100vh;'
  if (cls === 'w-full') return 'width: 100%;'
  if (cls === 'h-full') return 'height: 100%;'
  // spacing
  let m = cls.match(/^p-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding: ${spacingMap[m[1]]};`
  m = cls.match(/^px-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-left: ${spacingMap[m[1]]}; padding-right: ${spacingMap[m[1]]};`
  m = cls.match(/^py-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-top: ${spacingMap[m[1]]}; padding-bottom: ${spacingMap[m[1]]};`
  m = cls.match(/^pt-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-top: ${spacingMap[m[1]]};`
  m = cls.match(/^pr-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-right: ${spacingMap[m[1]]};`
  m = cls.match(/^pb-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-bottom: ${spacingMap[m[1]]};`
  m = cls.match(/^pl-(\d+)$/)
  if (m && spacingMap[m[1]]) return `padding-left: ${spacingMap[m[1]]};`
  return null
}

export default { isTailwindClassWhitelisted, tailwindClassToCss }
