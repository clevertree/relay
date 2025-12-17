import type { ComponentPropsWithoutRef, FC } from 'react';
import React from 'react'
import type {
  ImageProps,
  StyleProp,
  TextInputProps,
  TextProps,
  TouchableOpacityProps,
  ViewProps
} from 'react-native';
import {
  Image,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import VideoPlayer from './VideoPlayer'
import { ThemedElement, resolveThemedStyle } from './TSDiv'
import { unifiedBridge } from '@relay/shared'

type WithClassName<P> = P & { className?: string }

const TextWrapper = React.forwardRef<Text, WithClassName<TextProps>>(function TextWrapper({ className, style, ...rest }, ref) {
  return <ThemedElement component={Text} tag="span" className={className} style={style} ref={ref} {...rest} />
})

const ViewWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function ViewWrapper({ className, style, ...rest }, ref) {
  return <ThemedElement component={View} tag="div" className={className} style={style} ref={ref} {...rest} />
})

const ButtonWrapper = React.forwardRef<View, WithClassName<TouchableOpacityProps>>(function ButtonWrapper(
  { className, style, children, ...rest },
  ref,
) {
  return (
    <ThemedElement component={TouchableOpacity} tag="button" className={className} style={style} ref={ref} {...rest}>
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </ThemedElement>
  )
})

const InputWrapper = React.forwardRef<TextInput, WithClassName<TextInputProps>>(function InputWrapper({ className, style, ...rest }, ref) {
  const extraProps: Partial<TextInputProps> = {}
  // Support common input type hints via rest.type if present at runtime
  const runtimeType = (rest as any).type
  if (runtimeType === 'number' || runtimeType === 'tel') {
    extraProps.keyboardType = 'numeric'
  }
  return <ThemedElement component={TextInput} tag="input" className={className} style={style} ref={ref} {...rest} {...extraProps} />
})

const TextAreaWrapper = React.forwardRef<TextInput, WithClassName<TextInputProps>>(function TextAreaWrapper({ className, style, ...rest }, ref) {
  return <ThemedElement component={TextInput} tag="textarea" className={className} style={style} ref={ref} multiline {...rest} />
})

const ImgWrapper: FC<WithClassName<ImageProps & { src?: string; alt?: string }>> = ({ src, alt, style, className, ...rest }) => {
  return (
    <Image
      source={src ? { uri: src } : undefined}
      accessibilityLabel={alt}
      style={[resolveThemedStyle('img', className), style]}
      resizeMode="contain"
      {...rest}
    />
  )
}

const AnchorWrapper: FC<WithClassName<TextProps & { href?: string }>> = ({ className, style, children, ...rest }) => (
  <ThemedElement component={TouchableOpacity} tag="a" className={className} style={style} activeOpacity={0.7} {...rest}>
    <Text>{children}</Text>
  </ThemedElement>
)

const UnknownElement: FC<WithClassName<ViewProps> & { tagName: string }> = ({ tagName, className, style, children, ...rest }) => (
  <View
    {...rest}
    style={([
      { borderWidth: 1, borderStyle: 'dashed', borderColor: '#d97706', padding: 6, borderRadius: 6 },
      resolveThemedStyle(tagName, className) as any,
      style,
    ] as StyleProp<ViewProps>)}
  >
    <Text style={{ fontSize: 11, textTransform: 'uppercase', color: '#d97706', fontWeight: '600' }}>
      Placeholder for &lt;{tagName}&gt;
    </Text>
    <View>{children}</View>
  </View>
)

const ListItemWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function ListItemWrapper({ className, style, children, ...rest }, ref) {
  return (
    <ThemedElement component={View} tag="li" className={className} style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, style]} ref={ref} {...rest}>
      <Text style={{ marginRight: 6 }}>•</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </ThemedElement>
  )
})

const TableWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function TableWrapper({ className, style, ...rest }, ref) {
  return (
    <ThemedElement component={View} tag="table" className={className} style={[{ flexDirection: 'column', borderWidth: 1, borderColor: '#d1d5db' }, style]} ref={ref} {...rest} />
  )
})

const TableRowWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function TableRowWrapper({ className, style, children, ...rest }, ref) {
  return (
    <ThemedElement component={View} tag="tr" className={className} style={[{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e5e7eb' }, style]} ref={ref} {...rest}>
      {children}
    </ThemedElement>
  )
})

const TableCellWrapper = React.forwardRef<Text, WithClassName<TextProps>>(function TableCellWrapper({ className, style, children, ...rest }, ref) {
  return (
    <ThemedElement
      component={Text}
      tag="td"
      className={className}
      style={[{ flex: 1, padding: 8, borderRightWidth: 1, borderColor: '#e5e7eb' }, style]}
      ref={ref}
      {...rest}
    >
      {children}
    </ThemedElement>
  )
})

const TableHeaderCell = React.forwardRef<Text, WithClassName<TextProps>>(function TableHeaderCell({ style, children, ...rest }, ref) {
  return (
    <ThemedElement
      component={Text}
      tag="th"
      style={[
        { flex: 1, padding: 10, borderRightWidth: 1, borderColor: '#e5e7eb', fontWeight: '700' },
        style,
      ]}
      ref={ref}
      {...rest}
    >
      {children}
    </ThemedElement>
  )
})

const componentMap: Record<string, React.ComponentType<any>> = {
  div: ViewWrapper,
  section: ViewWrapper,
  span: TextWrapper,
  p: TextWrapper,
  strong: TextWrapper,
  em: TextWrapper,
  h1: TextWrapper,
  h2: TextWrapper,
  h3: TextWrapper,
  h4: TextWrapper,
  h5: TextWrapper,
  h6: TextWrapper,
  ul: ViewWrapper,
  ol: ViewWrapper,
  li: ListItemWrapper,
  button: ButtonWrapper,
  form: ViewWrapper,
  input: InputWrapper,
  textarea: TextAreaWrapper,
  select: ViewWrapper,
  option: TextWrapper,
  img: ImgWrapper,
  a: AnchorWrapper,
  video: ViewWrapper,
  VideoPlayer: VideoPlayer,
  table: TableWrapper,
  thead: ViewWrapper,
  tbody: ViewWrapper,
  tr: TableRowWrapper,
  th: TableHeaderCell,
  td: TableCellWrapper,
}

const unknownCache = new Map<string, React.ComponentType<any>>()

function resolveComponent(tag: string) {
  if (componentMap[tag]) {
    return componentMap[tag]
  }
  if (!unknownCache.has(tag)) {
    unknownCache.set(tag, (props: any) => <UnknownElement tagName={tag} {...props} />)
  }
  return unknownCache.get(tag)!
}

export function createHookReact(reactModule: typeof React) {
  const baseCreateElement = reactModule.createElement.bind(reactModule as any)
  function hookCreateElement(type: any, props: any, ...children: any[]) {
    if (typeof type === 'string') {
      const resolved = resolveComponent(type)
      // Convert any incoming `className` into RN `style` at runtime so
      // hook-rendered elements receive styles from the themed-styler runtime.
      if (props && props.className) {
        try {
          const themedStyle = resolveThemedStyle(props.tagName || type, props.className)
          const mergedStyle = [themedStyle, props.style]
          const nextProps = { ...props, style: mergedStyle }
          delete nextProps.className
          return baseCreateElement(resolved, nextProps, ...children)
        } catch (e) {
          // ignore conversion errors and fall back to original props
        }
      }
      return baseCreateElement(resolved, props, ...children)
    }
    return baseCreateElement(type, props, ...children)
  }

  return {
    ...reactModule,
    createElement: hookCreateElement,
  }
}
