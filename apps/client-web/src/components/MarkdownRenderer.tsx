import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { usePlugin } from '../plugins'
import { isAllowedComponent } from '../plugins/types'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  navigate: (path: string) => void
}

/**
 * Markdown Renderer
 * 
 * Renders markdown content with plugin components.
 * Only allows whitelisted components from the plugin.
 */
export function MarkdownRenderer({ content, navigate }: MarkdownRendererProps) {
  const { components } = usePlugin()

  // Build component mapping for react-markdown
  // Only map allowed components
  const markdownComponents: Components = {
    // Override link handling for internal navigation
    a: ({ href, children, ...props }: any) => {
      if (!href) return <span {...props}>{children}</span>
      
      const isInternal = href.startsWith('/') || href.startsWith('.') ||
        (!href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:'))

      if (isInternal) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              
              // Resolve relative paths
              let resolvedPath = href
              if (href.startsWith('.')) {
                const currentPath = window.location.pathname
                const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'))
                resolvedPath = new URL(href, `http://localhost${basePath}/`).pathname
              }
              
              navigate(resolvedPath)
            }}
            {...props}
          >
            {children}
          </a>
        )
      }

      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      )
    },

    // Override img for plugin Image component
    img: ({ src, alt, ...props }: any) => {
      if (!src) return null
      const ImageComponent = components.Image
      return <ImageComponent src={src} alt={alt || ''} {...props} />
    },

    // Override code blocks for plugin CodeBlock component
    code: ({ className, children, ...props }: any) => {
      // Check if this is a code block (has language class) or inline code
      const match = /language-(\w+)/.exec(className || '')
      
      if (match) {
        const CodeBlockComponent = components.CodeBlock
        return (
          <CodeBlockComponent language={match[1]} {...props}>
            {String(children).replace(/\n$/, '')}
          </CodeBlockComponent>
        )
      }
      
      // Inline code
      return <code className={className} {...props}>{children}</code>
    },
  }

  // Process custom components in markdown
  // Look for patterns like <Video src="..." /> in the content
  const processedContent = processCustomComponents(content)

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {processedContent.markdown}
      </ReactMarkdown>
      
      {/* Render extracted custom components */}
      {processedContent.customComponents.map((comp, index) => (
        <CustomComponent
          key={index}
          name={comp.name}
          props={comp.props}
          components={components}
        />
      ))}
    </div>
  )
}

interface ParsedComponent {
  name: string
  props: Record<string, string>
}

interface ProcessedContent {
  markdown: string
  customComponents: ParsedComponent[]
}

/**
 * Process custom components from markdown content
 * Extracts components like <Video src="..." /> and replaces them with placeholders
 */
function processCustomComponents(content: string): ProcessedContent {
  const customComponents: ParsedComponent[] = []
  
  // Match self-closing tags like <Video src="..." />
  const selfClosingPattern = /<(\w+)\s+([^>]*?)\/>/g
  // Match paired tags like <Video src="...">...</Video>
  const pairedPattern = /<(\w+)\s+([^>]*)>([^<]*)<\/\1>/g
  
  let markdown = content

  // Process self-closing tags
  markdown = markdown.replace(selfClosingPattern, (_match, tagName, propsString) => {
    if (isAllowedComponent(tagName)) {
      const props = parseProps(propsString)
      customComponents.push({ name: tagName, props })
      return `<!-- CUSTOM_COMPONENT_${customComponents.length - 1} -->`
    }
    // Strip disallowed components
    return ''
  })

  // Process paired tags
  markdown = markdown.replace(pairedPattern, (_match, tagName, propsString, _children) => {
    if (isAllowedComponent(tagName)) {
      const props = parseProps(propsString)
      customComponents.push({ name: tagName, props })
      return `<!-- CUSTOM_COMPONENT_${customComponents.length - 1} -->`
    }
    // Strip disallowed components
    return ''
  })

  return { markdown, customComponents }
}

/**
 * Parse props from a string like 'src="video.mp4" autoplay loop'
 */
function parseProps(propsString: string): Record<string, string> {
  const props: Record<string, string> = {}
  
  // Match quoted attributes: name="value" or name='value'
  const quotedPattern = /(\w+)=["']([^"']*)["']/g
  let match
  while ((match = quotedPattern.exec(propsString)) !== null) {
    props[match[1]] = match[2]
  }
  
  // Match boolean attributes (just the name)
  const booleanPattern = /\b(\w+)(?=[^=]|$)/g
  while ((match = booleanPattern.exec(propsString)) !== null) {
    const name = match[1]
    if (!props[name]) {
      props[name] = 'true'
    }
  }
  
  return props
}

interface CustomComponentProps {
  name: string
  props: Record<string, string>
  components: ReturnType<typeof usePlugin>['components']
}

/**
 * Render a custom component by name
 */
function CustomComponent({ name, props, components }: CustomComponentProps) {
  if (!isAllowedComponent(name)) {
    return null
  }

  const Component = components[name]
  if (!Component) {
    return null
  }

  // Convert string props to appropriate types
  const processedProps = Object.entries(props).reduce((acc, [key, value]) => {
    // Convert boolean strings
    if (value === 'true') {
      acc[key] = true
    } else if (value === 'false') {
      acc[key] = false
    // Convert number strings
    } else if (!isNaN(Number(value)) && value !== '') {
      acc[key] = Number(value)
    } else {
      acc[key] = value
    }
    return acc
  }, {} as Record<string, unknown>)

  // Type assertion - we know the component matches because we checked isAllowedComponent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Component {...(processedProps as any)} />
}
