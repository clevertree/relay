import React from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface FileRendererProps {
  content: string
  contentType: string
}

export function FileRenderer({ content, contentType }: FileRendererProps) {
  const lower = (contentType || '').toLowerCase()

  if (lower.includes('markdown') || lower.includes('md')) {
    return <MarkdownRenderer content={content} navigate={() => {}} />
  }

  if (lower.startsWith('image/')) {
    // Expect base64 data or full data URL; try to detect
    const isDataUrl = content.startsWith('data:')
    const src = isDataUrl ? content : `data:${contentType};base64,${content}`
    return (
      <div className="flex justify-center">
        <img src={src} alt="image" className="max-w-full h-auto" />
      </div>
    )
  }

  if (lower.includes('json')) {
    let pretty: string = content
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2)
    } catch {}
    return (
      <pre className="bg-gray-50 border border-gray-200 rounded p-4 overflow-auto text-sm">
        {pretty}
      </pre>
    )
  }

  if (lower.startsWith('text/') || !lower) {
    return (
      <pre className="bg-gray-50 border border-gray-200 rounded p-4 overflow-auto text-sm">
        {content}
      </pre>
    )
  }

  // Fallback: show as plain text
  return (
    <pre className="bg-gray-50 border border-gray-200 rounded p-4 overflow-auto text-sm">
      {content}
    </pre>
  )
}
