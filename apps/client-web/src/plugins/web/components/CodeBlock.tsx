import type { CodeBlockProps } from '../../types'
import './CodeBlock.css'

/**
 * Web CodeBlock Component
 * 
 * Renders code with syntax highlighting placeholder.
 * Can be extended with Prism.js or highlight.js.
 */
export function CodeBlock({
  language,
  filename,
  children,
  className = '',
}: CodeBlockProps) {
  const codeContent = typeof children === 'string' ? children : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = codeContent
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }

  return (
    <div className={`code-block ${className}`}>
      <div className="code-header">
        {filename && <span className="code-filename">{filename}</span>}
        {language && <span className="code-language">{language}</span>}
        <button className="code-copy" onClick={handleCopy} aria-label="Copy code">
          📋 Copy
        </button>
      </div>
      <pre className={`language-${language || 'text'}`}>
        <code>{children}</code>
      </pre>
    </div>
  )
}
