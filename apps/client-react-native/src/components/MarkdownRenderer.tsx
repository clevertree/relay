import React from 'react';
import type { ViewProps, TextProps} from 'react-native';
import { Text, View, Image, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { styled, tailwindToStyle } from '../tailwindRuntime';
// @ts-ignore - markdown-to-jsx types not available
import Markdown from 'markdown-to-jsx';
import { ThemeManager } from '../utils/themeManager';
import VideoPlayer from './VideoPlayer';
import { Picker } from '@react-native-picker/picker';

type Props = {
  content: string;
  onLinkPress?: (url: string) => void;
};

// Collapse multi-line HTML tags to a single line so markdown-to-jsx
// can correctly parse attributes and apply overrides. Mirrors web impl.
function preprocessHtmlForMarkdown(content: string): string {
  let processed = content
  // Remove newlines/indentation inside angle brackets
  processed = processed.replace(/<([^>]+?)>/g, (match) => {
    return match.replace(/\n\s*/g, ' ').replace(/\s+/g, ' ')
  })
  return processed
}

function mergeStyle(a?: any, b?: any) {
  if (!a) return b
  if (!b) return a
  if (Array.isArray(a)) return [...a, b]
  return [a, b]
}

// Extend component props to allow className (our mapper applies tailwind via `styled`)
interface StyledViewProps extends ViewProps {
  className?: string;
}

interface StyledTextProps extends TextProps {
  className?: string;
}

interface StyledTouchableProps extends ViewProps {
  className?: string;
  onPress?: () => void;
}

interface StyledImageProps {
  className?: string;
  source?: { uri: string };
  accessibilityLabel?: string;
  style?: any;
}

// Wrapper components that apply tailwind classes via the mapper
const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchable = styled(TouchableOpacity);
const StyledImage = styled(Image);
const StyledTextInput = styled(TextInput);
const StyledPicker = styled(Picker);

type MarkdownErrorBoundaryProps = {
  children: React.ReactNode
  content: string
}

type MarkdownErrorBoundaryState = {
  error: Error | null
  showDetails: boolean
}

class MarkdownErrorBoundary extends React.Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  state: MarkdownErrorBoundaryState = { error: null, showDetails: false }

  static getDerivedStateFromError(error: Error): MarkdownErrorBoundaryState {
    return { error, showDetails: false }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[MarkdownRenderer] Rendering error', { error, info })
  }

  componentDidUpdate(prevProps: MarkdownErrorBoundaryProps) {
    if (prevProps.content !== this.props.content && this.state.error) {
      this.setState({ error: null, showDetails: false })
    }
  }

  render() {
    if (this.state.error) {
      const colors = ThemeManager.getColors()
      return (
        <StyledView style={[styles.errorContainer, { borderColor: colors.error ?? '#ef4444' }]}>
          <Text style={[styles.errorTitle, { color: colors.error ?? '#ef4444' }]}>Failed to render markdown</Text>
          <Text style={[styles.errorMessage, { color: colors.textPrimary }]}>{this.state.error.message}</Text>
          {this.state.error.stack ? (
            <>
              <StyledTouchable onPress={() => this.setState((s) => ({ ...s, showDetails: !s.showDetails }))}>
                <Text style={[styles.toggleDetails, { color: colors.primary }]}> {this.state.showDetails ? 'Hide details' : 'Show details'} </Text>
              </StyledTouchable>
              {this.state.showDetails && (
                <StyledView style={styles.stackBox}>
                  <Text style={styles.stackText} selectable>{this.state.error.stack}</Text>
                </StyledView>
              )}
            </>
          ) : null}
        </StyledView>
      )
    }
    return this.props.children as React.ReactElement
  }
}

// Basic Native components with NativeWind className support
const P: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-base leading-6" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const Strong: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="font-bold" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const Em: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="italic" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const CodeInline: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <StyledText
      className="font-mono text-sm px-1 py-0.5 rounded"
      style={{ backgroundColor: t.colors.bgTertiary, color: t.colors.textPrimary }}
    >
      {children}
    </StyledText>
  );
};

const Pre: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <StyledView className="p-3 rounded" style={{ backgroundColor: t.colors.bgTertiary }}>
      <StyledText className="font-mono text-sm" style={{ color: t.colors.textPrimary }}>
        {children}
      </StyledText>
    </StyledView>
  );
};

const H1: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-2xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const H2: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const H3: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-lg font-bold mt-3 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const HR: React.FC = () => {
  const colors = ThemeManager.getColors();
  return (
    <StyledView className="h-px my-3" style={{ backgroundColor: colors.border }} />
  );
};

const Blockquote: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledView
      className="pl-3"
      style={{ borderLeftWidth: 1, borderLeftColor: colors.border }}
    >
      <StyledText className="italic" style={{ color: colors.textSecondary }}>
        {children}
      </StyledText>
    </StyledView>
  );
};

const UL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <StyledView className="gap-1 my-2">{children}</StyledView>
);

const OL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <StyledView className="gap-1 my-2">{children}</StyledView>
);

const LI: React.FC<React.PropsWithChildren<{ ordered?: boolean; index?: number }>> = ({
  children,
}) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledView className="flex-row">
      <StyledText className="mr-2">•</StyledText>
      <StyledText className="flex-1" style={{ color: colors.textPrimary }}>{children}</StyledText>
    </StyledView>
  );
};

const A: React.FC<
  React.PropsWithChildren<{ href?: string; onPress?: (url: string) => void }>
> = ({ children, href, onPress }) => {
  const colors = ThemeManager.getColors();
  const handle = () => {
    if (href && onPress) onPress(href);
  };
  return (
    <StyledTouchable onPress={handle}>
      <StyledText style={{ color: colors.primary }}>{children}</StyledText>
    </StyledTouchable>
  );
};

const IMG: React.FC<{ src?: string; alt?: string } & any> = ({ src, alt }) => {
  // RN requires explicit width/height or flex behavior; use a sensible default
  return (
    <StyledImage
      source={{ uri: src || '' }}
      accessibilityLabel={alt}
      style={{
        width: '100%',
        height: 200,
        resizeMode: 'contain',
      }}
    />
  );
};

export const MarkdownRenderer: React.FC<Props> = ({ content, onLinkPress }) => {
  // Ensure theme tokens are computed (side effect not needed, but call for consistency)
  void ThemeManager.getTokens();
  const processedContent = React.useMemo(() => preprocessHtmlForMarkdown(content), [content])
  // Temporary feature flag: disable tables on RN and show a notice
  const DISABLE_TABLES_RN = true

  const TableDisabledNotice: React.FC = () => (
    <StyledView
      className="p-3 rounded"
      style={{ backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fdba74' }}
    >
      <StyledText className="font-bold mb-1" style={{ color: '#9a3412' }}>
        Tables not yet supported on React Native
      </StyledText>
      <StyledText style={{ color: ThemeManager.getColors().textPrimary }}>
        This content contains a table. Rendering is temporarily disabled on mobile. TODO: implement a native table renderer.
      </StyledText>
    </StyledView>
  )

  // Safety net: map raw HTML tag types to RN components even if overrides miss
  const remapTag = (type: any) => {
    if (typeof type !== 'string') return type
    switch (type) {
      case 'div':
      case 'section':
      case 'article':
      case 'header':
      case 'footer':
      case 'main':
        return StyledView
      case 'span':
        return StyledText
      case 'p':
        return P
      case 'strong':
        return Strong
      case 'em':
        return Em
      case 'code':
        return CodeInline
      case 'pre':
        return Pre
      case 'h1':
        return H1
      case 'h2':
        return H2
      case 'h3':
        return H3
      case 'h4':
      case 'h5':
      case 'h6':
        return ({ children }: any) => (
          <StyledText style={{ color: ThemeManager.getColors().textPrimary }}>{children}</StyledText>
        )
      case 'hr':
        return HR
      case 'blockquote':
        return Blockquote
      case 'ul':
        return UL
      case 'ol':
        return OL
      case 'li':
        return LI as any
      case 'a':
        return (props: any) => <A {...props} onPress={onLinkPress} />
      case 'img':
        return IMG as any
      case 'input':
        return (p: any) => {
          const props = p || {}
          const { value, defaultValue, onChange, onChangeText, children, ...rest } = props
          const handleChangeText = (text: string) => {
            if (typeof onChangeText === 'function') onChangeText(text)
            if (typeof onChange === 'function') onChange({ target: { value: text } })
          }
          const v = (value ?? defaultValue) as any
          return (
            <StyledTextInput
              value={typeof v === 'string' ? v : undefined}
              defaultValue={typeof v === 'string' ? v : undefined}
              onChangeText={handleChangeText}
              className="px-2 py-1 border rounded text-sm"
              {...rest}
            />
          )
        }
      case 'select':
        return ({ children, value, defaultValue, onChange, ...rest }: any) => {
          const items = React.Children.toArray(children) as any[]
          const selectedValue = value ?? defaultValue
          const handleChange = (val: any) => {
            if (typeof onChange === 'function') onChange({ target: { value: val } })
          }
          return (
            <StyledPicker
              selectedValue={selectedValue}
              onValueChange={handleChange}
              className="border rounded text-sm"
              {...rest}
            >
              {items.map((c: any, i: number) => (
                <Picker.Item
                  key={i}
                  label={String(c?.props?.children ?? c?.props?.label ?? c?.props?.value ?? '')}
                  value={c?.props?.value ?? c?.props?.children}
                />)
              )}
            </StyledPicker>
          )
        }
      case 'option':
        return () => null
      case 'br':
        return () => <StyledText>{"\n"}</StyledText>
      case 'table':
        return DISABLE_TABLES_RN
          ? TableDisabledNotice
          : (({ children }: any) => <StyledView className="w-full my-2">{children}</StyledView>)
      case 'thead':
        return ({ children }: any) => <StyledView className="mb-1">{children}</StyledView>
      case 'tbody':
        return ({ children }: any) => <StyledView>{children}</StyledView>
      case 'tr':
        return ({ children }: any) => <StyledView className="flex-row items-center py-1">{children}</StyledView>
      case 'th':
        return ({ children }: any) => <StyledText className="font-semibold mr-3">{children}</StyledText>
      case 'td':
        return ({ children }: any) => <StyledText className="mr-3">{children}</StyledText>
      case 'video':
      case 'VideoPlayer':
        return (p: any) => <VideoPlayer {...p} />
      case 'source':
      case 'track':
        return () => null
      default:
        return type
    }
  }

  const createElement = React.useCallback((type: any, props: any, ...children: any[]) => {
    const mapped = remapTag(type)
    const { dangerouslySetInnerHTML, className, style, ...rest } = props || {}
    const twStyle = tailwindToStyle(className)
    const mergedStyle = mergeStyle(twStyle, style)
    return React.createElement(mapped as any, { ...rest, style: mergedStyle }, ...children)
  }, [onLinkPress])
  return (
    <StyledView className="p-3">
      <MarkdownErrorBoundary content={content}>
        <Markdown
          options={{
            forceBlock: true,
            createElement,
            overrides: {
              // Media and custom components
              VideoPlayer: { component: (p: any) => <VideoPlayer {...p} /> },
              video: { component: (p: any) => <VideoPlayer {...p} /> },
              source: { component: () => null },
              track: { component: () => null },
              // Form controls → native
              input: {
                component: (p: any) => {
                  const { value, defaultValue, onChange, onChangeText, children, ...rest } = p || {}
                  const handleChangeText = (text: string) => {
                    if (typeof onChangeText === 'function') onChangeText(text)
                    if (typeof onChange === 'function') onChange({ target: { value: text } })
                  }
                  const v = (p?.value ?? p?.defaultValue) as any
                  return (
                    <StyledTextInput
                      value={typeof v === 'string' ? v : undefined}
                      defaultValue={typeof v === 'string' ? v : undefined}
                      onChangeText={handleChangeText}
                      className="px-2 py-1 border rounded text-sm"
                      {...rest}
                    />
                  )
                }
              },
              select: {
                component: ({ children, value, defaultValue, onChange, ...rest }: any) => {
                  const items = React.Children.toArray(children) as any[]
                  const selectedValue = value ?? defaultValue
                  const handleChange = (val: any) => {
                    if (typeof onChange === 'function') onChange({ target: { value: val } })
                  }
                  return (
                    <StyledPicker
                      selectedValue={selectedValue}
                      onValueChange={handleChange}
                      className="border rounded text-sm"
                      {...rest}
                    >
                      {items.map((c: any, i: number) => (
                        <Picker.Item
                          key={i}
                          label={String(c?.props?.children ?? c?.props?.label ?? c?.props?.value ?? '')}
                          value={c?.props?.value ?? c?.props?.children}
                        />)
                      )}
                    </StyledPicker>
                  )
                }
              },
              option: { component: () => null },
              // Generic block containers
              div: { component: StyledView },
              section: { component: StyledView },
              article: { component: StyledView },
              header: { component: StyledView },
              footer: { component: StyledView },
              main: { component: StyledView },
              p: { component: P },
              span: { component: Text },
              strong: { component: Strong },
              em: { component: Em },
              code: { component: CodeInline },
              pre: { component: Pre },
              h1: { component: H1 },
              h2: { component: H2 },
              h3: { component: H3 },
              h4: {
                component: ({ children }: any) => (
                  <StyledText className="text-base font-semibold mt-3 mb-2" style={{ color: ThemeManager.getColors().textPrimary }}>
                    {children}
                  </StyledText>
                )
              },
              h5: {
                component: ({ children }: any) => (
                  <StyledText className="text-base font-semibold mt-2 mb-1" style={{ color: ThemeManager.getColors().textPrimary }}>
                    {children}
                  </StyledText>
                )
              },
              h6: {
                component: ({ children }: any) => (
                  <StyledText className="text-sm font-semibold mt-2 mb-1" style={{ color: ThemeManager.getColors().textPrimary }}>
                    {children}
                  </StyledText>
                )
              },
              hr: { component: HR },
              blockquote: { component: Blockquote },
              ul: { component: UL },
              ol: { component: OL },
              li: { component: LI },
              a: { component: (props: any) => <A {...props} onPress={onLinkPress} /> },
              img: { component: IMG },
              br: { component: () => <StyledText>{"\n"}</StyledText> },
              // Table support / temporary disable on RN
              table: {
                component: DISABLE_TABLES_RN ? TableDisabledNotice : (({ children }: any) => (
                  <StyledView className="w-full my-2">{children}</StyledView>
                ))
              },
              thead: {
                component: ({ children }: any) => (
                  <StyledView className="mb-1">{children}</StyledView>
                )
              },
              tbody: { component: ({ children }: any) => <StyledView>{children}</StyledView> },
              tr: {
                component: ({ children }: any) => (
                  <StyledView className="flex-row items-center py-1">{children}</StyledView>
                )
              },
              th: {
                component: ({ children }: any) => (
                  <StyledText className="font-semibold mr-3">{children}</StyledText>
                )
              },
              td: {
                component: ({ children }: any) => (
                  <StyledText className="mr-3">{children}</StyledText>
                )
              },
            },
          }}
        >
          {processedContent}
        </Markdown>
      </MarkdownErrorBoundary>
    </StyledView>
  );
};

const styles = StyleSheet.create({
  errorContainer: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorTitle: {
    fontWeight: '700',
    fontSize: 16,
  },
  errorMessage: {
    marginTop: 4,
    fontSize: 13,
  },
  toggleDetails: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  stackBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  stackText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#111827',
  },
});

export default MarkdownRenderer;
