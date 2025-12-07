/**
 * Advanced Markdown Renderer for React Native / Web
 * Converts markdown text to React Native components.
 * Supports formatting, media tags (<video>, <audio>), and custom component renderers.
 * Uses Tailwind CSS via NativeWind for cross-platform styling.
 */

import React from 'react';
import {
  Image,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface MarkdownViewProps {
  content: string;
  baseUrl?: string;
  branch?: string;
  onLinkPress?: (url: string) => void;
  customRenderers?: Record<string, (props: any) => React.ReactNode>;
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
  | {type: 'video'; url: string; title?: string}
  | {type: 'audio'; url: string; title?: string}
  | {type: 'custom'; tagName: string; attrs: Record<string, string>; content?: string}
  | {type: 'list'; ordered: boolean; items: MarkdownNode[][]}
  | {type: 'listitem'; children: MarkdownNode[]}
  | {type: 'blockquote'; children: MarkdownNode[]}
  | {type: 'hr'};

/**
 * Parse HTML attributes from a string
 */
function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  
  while ((match = attrRegex.exec(attrStr))) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  
  return attrs;
}

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
    const videoMatch = line.match(/<video\s+url="([^"]+)"(?:\s+title="([^"]*)")?\s*\/>/i);
    if (videoMatch) {
      nodes.push({type: 'video', url: videoMatch[1], title: videoMatch[2]});
      i++;
      continue;
    }

    // Custom audio tag
    const audioMatch = line.match(/<audio\s+url="([^"]+)"(?:\s+title="([^"]*)")?\s*\/>/i);
    if (audioMatch) {
      nodes.push({type: 'audio', url: audioMatch[1], title: audioMatch[2]});
      i++;
      continue;
    }

    // Custom tags (generic)
    const customMatch = line.match(/<(\w+)(\s+[^>]*)\/>/);
    if (customMatch) {
      const tagName = customMatch[1];
      const attrStr = customMatch[2];
      const attrs = parseAttributes(attrStr);
      
      // Only treat as custom if not a standard HTML tag
      if (!['video', 'audio', 'image', 'img'].includes(tagName.toLowerCase())) {
        nodes.push({type: 'custom', tagName, attrs, content: ''});
        i++;
        continue;
      }
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
      !/<video/.test(lines[i]) &&
      !/<audio/.test(lines[i])
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
 * Render a single markdown node using Tailwind/NativeWind classes
 */
const RenderNode: React.FC<{
  node: MarkdownNode;
  baseUrl?: string;
  branch?: string;
  onLinkPress?: (url: string) => void;
  customRenderers?: Record<string, (props: any) => React.ReactNode>;
}> = ({node, baseUrl, branch, onLinkPress, customRenderers}) => {
  const resolveUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (baseUrl) {
      // Add branch query parameter if provided
      const resolved = `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
      if (branch) {
        const separator = resolved.includes('?') ? '&' : '?';
        return `${resolved}${separator}branch=${encodeURIComponent(branch)}`;
      }
      return resolved;
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
      return <Text className="text-primary">{node.content}</Text>;

    case 'heading':
      const headingClassName =
        node.level === 1 ? 'text-4xl font-bold mt-6 mb-2' :
        node.level === 2 ? 'text-3xl font-bold mt-5 mb-2' :
        node.level === 3 ? 'text-2xl font-bold mt-4 mb-2' :
        'text-xl font-bold mt-3 mb-2';
      return <Text className={`${headingClassName} text-textPrimary`}>{node.content}</Text>;

    case 'paragraph':
      return (
        <Text className="text-base leading-6 mb-3 text-textSecondary">
          {node.children.map((child, i) => (
            <RenderNode key={i} node={child} baseUrl={baseUrl} branch={branch} onLinkPress={onLinkPress} customRenderers={customRenderers} />
          ))}
        </Text>
      );

    case 'bold':
      return <Text className="font-bold text-textPrimary">{node.content}</Text>;

    case 'italic':
      return <Text className="italic text-textSecondary">{node.content}</Text>;

    case 'code':
      return <Text className="font-mono text-sm bg-bgTertiary text-error px-1 py-0.5 rounded">{node.content}</Text>;

    case 'codeblock':
      return (
        <View className="bg-gray-900 rounded-lg p-3 my-2 border border-gray-700">
          {node.language && <Text className="text-gray-400 text-xs mb-2">{node.language}</Text>}
          <Text className="font-mono text-gray-300 text-sm leading-5">{node.content}</Text>
        </View>
      );

    case 'link':
      return (
        <TouchableOpacity onPress={() => handleLinkPress(node.href)}>
          <Text className="text-info underline">{node.content}</Text>
        </TouchableOpacity>
      );

    case 'image':
      return (
        <Image
          source={{uri: resolveUrl(node.src)}}
          className="w-full h-52 my-2 rounded-lg"
          resizeMode="contain"
        />
      );

    case 'video':
      return (
        <View className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg my-2 border border-blue-200 dark:border-blue-800">
          <View className="bg-blue-100 dark:bg-blue-900 p-4 rounded-lg items-center mb-2">
            <Text className="text-4xl mb-1">🎬</Text>
            <Text className="text-sm font-semibold text-textPrimary">{node.title || 'Video'}</Text>
          </View>
          <Text className="text-xs text-textMuted font-mono truncate">
            {resolveUrl(node.url)}
          </Text>
        </View>
      );

    case 'audio':
      return (
        <View className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg my-2 border border-purple-200 dark:border-purple-800">
          <View className="bg-purple-100 dark:bg-purple-900 p-4 rounded-lg items-center mb-2">
            <Text className="text-4xl mb-1">🎵</Text>
            <Text className="text-sm font-semibold text-textPrimary">{node.title || 'Audio'}</Text>
          </View>
          <Text className="text-xs text-textMuted font-mono truncate">
            {resolveUrl(node.url)}
          </Text>
        </View>
      );

    case 'custom':
      // Check if custom renderer is provided
      if (customRenderers && customRenderers[node.tagName]) {
        return customRenderers[node.tagName]({
          attrs: node.attrs,
          content: node.content,
          resolveUrl,
        });
      }
      // Fallback to generic custom tag display
      return (
        <View className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg my-2 border border-amber-200 dark:border-amber-800">
          <Text className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">&lt;{node.tagName}&gt;</Text>
          {Object.entries(node.attrs).length > 0 && (
            <Text className="text-xs text-amber-700 dark:text-amber-400 font-mono">
              {Object.entries(node.attrs)
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ')}
            </Text>
          )}
        </View>
      );

    case 'list':
      return (
        <View className="my-2">
          {node.items.map((item, i) => (
            <View key={i} className="flex-row mb-1">
              <Text className="w-6 text-base text-textMuted">
                {node.ordered ? `${i + 1}.` : '•'}
              </Text>
              <Text className="flex-1 text-base leading-6 text-textSecondary">
                {item.map((child, j) => (
                  <RenderNode key={j} node={child} baseUrl={baseUrl} branch={branch} onLinkPress={onLinkPress} customRenderers={customRenderers} />
                ))}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'blockquote':
      return (
        <View className="border-l-4 border-gray-400 dark:border-gray-600 pl-4 my-2">
          {node.children.map((child, i) => (
            <RenderNode key={i} node={child} baseUrl={baseUrl} branch={branch} onLinkPress={onLinkPress} customRenderers={customRenderers} />
          ))}
        </View>
      );

    case 'hr':
      return <View className="h-px bg-gray-300 dark:bg-gray-600 my-4" />;

    default:
      return null;
  }
};

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  baseUrl,
  branch,
  onLinkPress,
  customRenderers,
}) => {
  const nodes = parseMarkdown(content);

  return (
    <View className="p-4">
      {nodes.map((node, i) => (
        <RenderNode
          key={i}
          node={node}
          baseUrl={baseUrl}
          branch={branch}
          onLinkPress={onLinkPress}
          customRenderers={customRenderers}
        />
      ))}
    </View>
  );
};

export default MarkdownView;
