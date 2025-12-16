import { useEffect } from 'react'
import { unifiedBridge } from '@relay/shared'

// A lightweight DOM observer that registers class usage for elements that
// may not be wrapped by our TSDiv (e.g. third-party libs or raw markup).
export default function StyleObserver() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return

    const registerElement = (el: Element) => {
      try {
        if (!(el instanceof HTMLElement)) return
        const tag = el.tagName.toLowerCase()
        const props: any = { className: (el.getAttribute('class') || '') }
        unifiedBridge.registerUsage(tag, props)
      } catch (e) {}
    }

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target && m.target instanceof Element) {
          registerElement(m.target)
        }
        if (m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach((n) => {
            if (n instanceof Element) {
              registerElement(n)
              // also register children
              n.querySelectorAll && n.querySelectorAll('*').forEach((c: Element) => registerElement(c))
            }
          })
        }
      }
    })

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

    // initial sweep
    document.querySelectorAll('*').forEach((el) => registerElement(el))

    return () => obs.disconnect()
  }, [])

  return null
}
