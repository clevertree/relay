// Lightweight, dependency-free JSX → JS transformer for our runtime loader use-cases
// NOTE: This is a pragmatic transformer that supports a common subset used by template hooks.
// Supported:
// - Element and Component tags: <div>, <Layout>, <UI.Button>
// - Self-closing and paired tags
// - Props: key="str", key={expr}, boolean shorthand (key), spread {...obj}
// - Children: nested elements, text nodes, and {expr} blocks
// - Basic whitespace trimming for text children
// - Very light TS erasure (strips type-only constructs heuristically)

function escapeStringLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "$$").replace(/\n/g, "\\n")
}

function stripTypeScript(source: string): string {
  let code = source
  // Remove import type/export type lines
  code = code.replace(/^(\s*)import\s+type\s+[^;]+;?/gm, '$1')
  code = code.replace(/^(\s*)export\s+type\s+[^;]+;?/gm, '$1')
  // Remove standalone interface/type declarations (safer)
  code = code.replace(/^(\s*)(?:export\s+)?interface\s+[A-Za-z_$][\w$]*\s*{[\s\S]*?}\s*$/gm, '$1')
  code = code.replace(/^(\s*)(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*[\s\S]*?;\s*$/gm, '$1')
  // IMPORTANT: do NOT strip generic/annotation patterns like `: T` globally.
  // Global regex removal can corrupt valid JS object literals (e.g., `key: value`).
  return code
}

function parseProps(attrSrc: string): string {
  // Build object expression as string
  const props: string[] = []
  let s = attrSrc.trim()
  while (s.length) {
    // Spread {...obj}
    let m = s.match(/^\{\s*\.\.\.([^}]+)\}\s*/)
    if (m) {
      props.push(`...(${m[1].trim()})`)
      s = s.slice(m[0].length)
      continue
    }
    // key={expr}
    m = s.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*\{([^}]*)\}\s*/)
    if (m) {
      props.push(`${m[1]}: (${m[2].trim()})`)
      s = s.slice(m[0].length)
      continue
    }
    // key="str" or key='str'
    m = s.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(["'])(.*?)\2\s*/)
    if (m) {
      props.push(`${m[1]}: ${JSON.stringify(m[3])}`)
      s = s.slice(m[0].length)
      continue
    }
    // boolean shorthand: key
    m = s.match(/^([A-Za-z_][A-Za-z0-9_-]*)\b\s*/)
    if (m) {
      props.push(`${m[1]}: true`)
      s = s.slice(m[0].length)
      continue
    }
    // If nothing matched, break to avoid infinite loop
    break
  }
  if (props.length === 0) return 'null'
  // Merge spreads using Object.assign if present
  const hasSpread = props.some(p => p.startsWith('...'))
  if (!hasSpread) return `{ ${props.join(', ')} }`
  // Convert to Object.assign({}, ...spread, keyed)
  const parts = props.map(p => p.startsWith('...') ? p.slice(3) : `{ ${p} }`)
  return `Object.assign({}, ${parts.join(', ')})`
}

function trimText(t: string): string {
  // Collapse whitespace and trim
  const collapsed = t.replace(/\s+/g, ' ')
  return collapsed.trim()
}

function transformOnce(input: string): { code: string; changed: boolean } {
  let code = input
  let changed = false

  // Self-closing tags first: <Tag a={1} />
  code = code.replace(/<([A-Za-z_][\w\.]*)\s*([^>]*)\/>/g, (_m, tag: string, attrs: string) => {
    changed = true
    const props = parseProps(attrs || '')
    const tagExpr = /^[a-z]/.test(tag) ? `'${tag}'` : tag
    return `_jsx_(${tagExpr}, ${props})`
  })

  // Paired tags without nesting (handled iteratively): <Tag ...>children</Tag>
  // Use a tempered dot to avoid crossing nested pairs; run repeatedly by outer loop.
  code = code.replace(/<([A-Za-z_][\w\.]*)\s*([^>]*)>([\s\S]*?)<\/\1>/g, (_m, tag: string, attrs: string, body: string) => {
    changed = true
    const props = parseProps(attrs || '')
    // Split children by braces to preserve expressions
    const children: string[] = []
    let rest = body
    while (rest.length) {
      const expr = rest.match(/^\s*\{([^}]*)\}\s*/)
      if (expr) {
        const v = expr[1].trim()
        if (v) children.push(`(${v})`)
        rest = rest.slice(expr[0].length)
        continue
      }
      // Next literal until next brace or end
      const nextBrace = rest.indexOf('{')
      const lit = nextBrace === -1 ? rest : rest.slice(0, nextBrace)
      const t = trimText(lit)
      if (t) children.push(JSON.stringify(t))
      rest = nextBrace === -1 ? '' : rest.slice(nextBrace)
    }
    const tagExpr = /^[a-z]/.test(tag) ? `'${tag}'` : tag
    if (children.length) {
      return `_jsx_(${tagExpr}, ${props}, ${children.join(', ')})`
    }
    return `_jsx_(${tagExpr}, ${props})`
  })

  return { code, changed }
}

export function transformJsxToJs(sourceCode: string, filename = 'module.jsx'): string {
  const raw = stripTypeScript(sourceCode)
  let code = raw
  let guard = 0
  try {
    // Repeatedly apply until no JSX-looking patterns remain or guard trips
    while (guard++ < 50) {
      const res = transformOnce(code)
      code = res.code
      if (!res.changed) break
    }
    if (guard >= 50) {
      throw new Error('JSX transform hit iteration limit; possible deeply nested or malformed JSX')
    }
    return code + `\n//# sourceURL=${filename}`
  } catch (err: any) {
    const e: any = new Error(`TranspileError: ${filename}: ${err?.message || String(err)}`)
    e.name = 'TranspileError'
    throw e
  }
}

export default transformJsxToJs
