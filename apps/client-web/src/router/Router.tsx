import { useState, useEffect } from 'react'
import { useFetchContent } from '../plugins'
import { MarkdownRenderer } from '../components/MarkdownRenderer'

interface RouterProps {
  path: string
  navigate: (path: string) => void
}

export function Router({ path, navigate }: RouterProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchContent = useFetchContent()

  useEffect(() => {
    let cancelled = false

    async function loadContent() {
      setLoading(true)
      setError(null)

      try {
        // Determine the file to fetch
        let filePath = path
        
        // If path ends with /, look for index.md
        if (filePath.endsWith('/')) {
          filePath = `${filePath}index.md`
        }
        
        // If path doesn't have an extension, try .md
        if (!filePath.includes('.') || filePath.endsWith('/')) {
          filePath = `${filePath}.md`
        }
        
        // Normalize path
        filePath = filePath.replace(/\/+/g, '/')
        if (!filePath.startsWith('/')) {
          filePath = `/${filePath}`
        }

        const text = await fetchContent(filePath)
        
        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load content')
          setLoading(false)
        }
      }
    }

    loadContent()

    return () => {
      cancelled = true
    }
  }, [path, fetchContent])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (error) {
    return (
      <div className="error">
        <h2>Error Loading Content</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Go Home</button>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="error">
        <h2>No Content</h2>
        <p>No content found for this path.</p>
        <button onClick={() => navigate('/')}>Go Home</button>
      </div>
    )
  }

  return (
    <MarkdownRenderer 
      content={content} 
      navigate={navigate}
    />
  )
}
