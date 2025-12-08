/**
 * Advanced Markdown Renderer for React Native
 * Converts markdown text to React Native components.
 * Supports formatting, media tags (<video>, <audio>), and custom component renderers.
 */

import React from 'react';
import {Image, Linking, StyleSheet, Text, TouchableOpacity, View,} from 'react-native';

interface MarkdownViewProps {
    content: string;
    baseUrl?: string;
    branch?: string;
    onLinkPress?: (url: string) => void;
    customRenderers?: Record<string, (props: any) => React.ReactNode>;
}

type MarkdownNode =
    | { type: 'text'; content: string }
    | { type: 'heading'; level: number; content: string }
    | { type: 'paragraph'; children: MarkdownNode[] }
    | { type: 'bold'; content: string }
    | { type: 'italic'; content: string }
    | { type: 'code'; content: string; inline?: boolean }
    | { type: 'codeblock'; content: string; language?: string }
    | { type: 'link'; href: string; content: string }
    | { type: 'image'; src: string; alt?: string }
    | { type: 'video'; url: string; title?: string }
    | { type: 'audio'; url: string; title?: string }
    | { type: 'custom'; tagName: string; attrs: Record<string, string>; content?: string }
    | { type: 'list'; ordered: boolean; items: MarkdownNode[][] }
    | { type: 'listitem'; children: MarkdownNode[] }
    | { type: 'blockquote'; children: MarkdownNode[] }
    | { type: 'hr' };

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
 * Render a single markdown node
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
                        <RenderNode key={i} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress}/>
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
            return (
                <View style={styles.mediaContainer}>
                    <View style={styles.videoPlaceholder}>
                        <Text style={styles.videoText}>🎬</Text>
                        <Text style={styles.mediaTitle}>{node.title || 'Video'}</Text>
                    </View>
                    <Text style={styles.mediaUrl} numberOfLines={1}>
                        {resolveUrl(node.url)}
                    </Text>
                </View>
            );

        case 'audio':
            return (
                <View style={styles.mediaContainer}>
                    <View style={styles.audioPlaceholder}>
                        <Text style={styles.audioText}>🎵</Text>
                        <Text style={styles.mediaTitle}>{node.title || 'Audio'}</Text>
                    </View>
                    <Text style={styles.mediaUrl} numberOfLines={1}>
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
                <View style={styles.customTag}>
                    <Text style={styles.customTagName}>&lt;{node.tagName}&gt;</Text>
                    {Object.entries(node.attrs).length > 0 && (
                        <Text style={styles.customTagAttrs}>
                            {Object.entries(node.attrs)
                                .map(([k, v]) => `${k}="${v}"`)
                                .join(' ')}
                        </Text>
                    )}
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
                                    <RenderNode key={j} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress}/>
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
                        <RenderNode key={i} node={child} baseUrl={baseUrl} onLinkPress={onLinkPress}/>
                    ))}
                </View>
            );

        case 'hr':
            return <View style={styles.hr}/>;

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
        <View style={styles.container}>
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
    mediaContainer: {
        backgroundColor: '#f8f9fa',
        padding: 12,
        borderRadius: 6,
        marginVertical: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    videoPlaceholder: {
        backgroundColor: '#e3f2fd',
        padding: 16,
        borderRadius: 6,
        alignItems: 'center',
        marginBottom: 8,
    },
    videoText: {
        fontSize: 32,
        marginBottom: 4,
    },
    audioPlaceholder: {
        backgroundColor: '#f3e5f5',
        padding: 16,
        borderRadius: 6,
        alignItems: 'center',
        marginBottom: 8,
    },
    audioText: {
        fontSize: 32,
        marginBottom: 4,
    },
    mediaTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    mediaUrl: {
        fontSize: 12,
        color: '#666',
        fontFamily: 'monospace',
    },
    customTag: {
        backgroundColor: '#fff3e0',
        padding: 12,
        borderRadius: 6,
        marginVertical: 8,
        borderWidth: 1,
        borderColor: '#ffe0b2',
    },
    customTagName: {
        fontSize: 12,
        fontWeight: '600',
        color: '#e65100',
        marginBottom: 4,
    },
    customTagAttrs: {
        fontSize: 11,
        color: '#bf360c',
        fontFamily: 'monospace',
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
