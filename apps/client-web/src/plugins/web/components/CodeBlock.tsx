import type { CodeBlockProps } from '../../types'

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
    <div className={`my-4 rounded-lg overflow-hidden bg-gray-900 dark:bg-gray-950 ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 dark:bg-gray-900 text-sm">
        {filename && <span className="font-mono text-gray-300">{filename}</span>}
        {language && <span className="ml-auto text-xs text-gray-500 uppercase">{language}</span>}
        <button className="bg-none border text-gray-500 px-2 py-1 rounded text-xs cursor-pointer transition-all hover:bg-gray-700 hover:text-white" onClick={handleCopy} aria-label="Copy code">
          📋 Copy
        </button>
      </div>
      <pre className={`language-${language || 'text'} m-0 p-4 overflow-x-auto bg-transparent`}>
        <code className="font-mono text-sm leading-relaxed text-gray-300">{children}</code>
      </pre>
    </div>
  )
}
