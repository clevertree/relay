/**
 * Simple Markdown Renderer for React Native
 * Converts markdown text to React Native components.
 * Supports basic formatting and custom tags like <video url="..."/>
 */

import React from 'react';
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface MarkdownViewProps {
  content: string;
  baseUrl?: string;
  onLinkPress?: (url: string) => void;
}

type MarkdownNode = 
  | {type: 'text'; content: string}
  | {type: 'heading'; level: number; content: string}
  | {type: 'paragraph'; children: MarkdownNode[]}
  | {type: 'bold'; content: string}
  | {type: 'italic'; content: string}
  | {type: 'code'; content: string; inline?: boolean}
  | {type: 'codeblock'; content: string; language?: string}
  | {type: 'link'; href: string; content: string}
  | {type: 'image'; src: string; alt?: string}
  | {type: 'video'; url: string}
  | {type: 'list'; ordered: boolean; items: MarkdownNode[][]}
  | {type: 'listitem'; children: MarkdownNode[]}
  | {type: 'blockquote'; children: MarkdownNode[]}
  | {type: 'hr'};

/**
 * Parse markdown text into an AST-like structure
 */
function parseMarkdown(content: string): MarkdownNode[] {
  const lines = content.split('\n');
  const nodes: MarkdownNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    
    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)/.test(line.trim())) {
      nodes.push({type: 'hr'});
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push({
        type: 'codeblock',
        content: codeLines.join('\n'),
        language,
      });
      i++; // Skip closing ```
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('>') || (lines[i].trim() && !lines[i].match(/^[#\-\*\d]/)))) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({
        type: 'blockquote',
        children: parseInline(quoteLines.join('\n')),
      });
      continue;
    }

    // Unordered list
    if (/^[\-\*]\s/.test(line)) {
      const items: MarkdownNode[][] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[\-\*]\s/, '')));
        i++;
      }
      nodes.push({type: 'list', ordered: false, items});
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: MarkdownNode[][] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\d+\.\s/, '')));
        i++;
      }
      nodes.push({type: 'list', ordered: true, items});
      continue;
    }

    // Custom video tag
    const videoMatch = line.match(/<video\s+url="([^"]+)"[^>]*\/>/i);
    if (videoMatch) {
      nodes.push({type: 'video', url: videoMatch[1]});
      i++;
      continue;
    }

    // Image (standalone)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      nodes.push({type: 'image', alt: imgMatch[1], src: imgMatch[2]});
      i++;
      continue;
    }

    // Regular paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^[\-\*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/<video/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      nodes.push({
        type: 'paragraph',
        children: parseInline(paragraphLines.join(' ')),
      });
    }
  }

  return nodes;
}

/**
 * Parse inline markdown elements
 */
function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      nodes.push({type: 'bold', content: boldMatch[1]});
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^[*_]([^*_]+)[*_]/);
    if (italicMatch) {
      nodes.push({type: 'italic', content: italicMatch[1]});
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      nodes.push({type: 'code', content: codeMatch[1], inline: true});
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      nodes.push({type: 'link', content: linkMatch[1], href: linkMatch[2]});
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Image ![alt](src)
    const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      nodes.push({type: 'image', alt: imgMatch[1], src: imgMatch[2]});
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // Plain text until next special character
    const textMatch = remaining.match(/^[^*_`\[!]+/);
    if (textMatch) {
      nodes.push({type: 'text', content: textMatch[0]});
      remaining = remaining.slice(textMatch[0].length);
      continue;
    }

    // Single special character
    nodes.push({type: 'text', content: remaining[0]});
    remaining = remaining.slice(1);
  }

  return nodes;
}

/**
 * Render a single markdown node
 */
const RenderNode: React.FC<{
  node: MarkdownNode;
  baseUrl?: string;
  onLinkPress?: (url: string) => void;
}> = ({node, baseUrl, onLinkPress}) => {
  const resolveUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (baseUrl) {
      return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
    }
    return url;
  };

  const handleLinkPress = (href: string) => {
    const resolved = resolveUrl(href);
    if (onLinkPress) {
      onLinkPress(resolved);
    } else {
      Linking.openURL(resolved);
    }
  };

  switch (node.type) {
    case 'text':
      return <Text>{node.content}</Text>;

    case 'heading':
      const headingStyle = [
        styles.heading,
        node.level === 1 && styles.h1,
        node.level === 2 && styles.h2,
        node.level === 3 && styles.h3,
        node.level >= 4 && styles.h4,
      ];
      return <Text style={headingStyle}>{node.content}</Text>;

    case 'paragraph':
      return (
        <Text style={styles.paragraph}>
          {node.children.map((child, i) => (
            <RenderNode key={i} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress} />
          ))}
        </Text>
      );

    case 'bold':
      return <Text style={styles.bold}>{node.content}</Text>;

    case 'italic':
      return <Text style={styles.italic}>{node.content}</Text>;

    case 'code':
      return <Text style={styles.inlineCode}>{node.content}</Text>;

    case 'codeblock':
      return (
        <View style={styles.codeBlock}>
          {node.language && <Text style={styles.codeLanguage}>{node.language}</Text>}
          <Text style={styles.codeBlockText}>{node.content}</Text>
        </View>
      );

    case 'link':
      return (
        <TouchableOpacity onPress={() => handleLinkPress(node.href)}>
          <Text style={styles.link}>{node.content}</Text>
        </TouchableOpacity>
      );

    case 'image':
      return (
        <Image
          source={{uri: resolveUrl(node.src)}}
          style={styles.image}
          resizeMode="contain"
        />
      );

    case 'video':
      // Placeholder for video - would use react-native-video in real implementation
      return (
        <View style={styles.videoPlaceholder}>
          <Text style={styles.videoText}>🎬 Video: {node.url}</Text>
        </View>
      );

    case 'list':
      return (
        <View style={styles.list}>
          {node.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.listBullet}>
                {node.ordered ? `${i + 1}.` : '•'}
              </Text>
              <Text style={styles.listItemText}>
                {item.map((child, j) => (
                  <RenderNode key={j} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress} />
                ))}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'blockquote':
      return (
        <View style={styles.blockquote}>
          {node.children.map((child, i) => (
            <RenderNode key={i} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress} />
          ))}
        </View>
      );

    case 'hr':
      return <View style={styles.hr} />;

    default:
      return null;
  }
};

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  baseUrl,
  onLinkPress,
}) => {
  const nodes = parseMarkdown(content);

  return (
    <View style={styles.container}>
      {nodes.map((node, i) => (
        <RenderNode key={i} node={node} baseUrl={baseUrl} onLinkPress={onLinkPress} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  heading: {
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  h1: {
    fontSize: 28,
  },
  h2: {
    fontSize: 24,
  },
  h3: {
    fontSize: 20,
  },
  h4: {
    fontSize: 16,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
    color: '#333',
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: 'monospace',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    fontSize: 14,
  },
  codeBlock: {
    backgroundColor: '#1e1e1e',
    padding: 12,
    borderRadius: 6,
    marginVertical: 8,
  },
  codeLanguage: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  codeBlockText: {
    fontFamily: 'monospace',
    color: '#d4d4d4',
    fontSize: 13,
    lineHeight: 20,
  },
  link: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  image: {
    width: '100%',
    height: 200,
    marginVertical: 8,
    borderRadius: 6,
  },
  videoPlaceholder: {
    backgroundColor: '#f0f0f0',
    padding: 20,
    borderRadius: 6,
    marginVertical: 8,
    alignItems: 'center',
  },
  videoText: {
    color: '#666',
  },
  list: {
    marginVertical: 8,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listBullet: {
    width: 24,
    fontSize: 16,
    color: '#666',
  },
  listItemText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: '#ddd',
    paddingLeft: 16,
    marginVertical: 8,
  },
  hr: {
    height: 1,
    backgroundColor: '#ddd',
    marginVertical: 16,
  },
});

export default MarkdownView;
