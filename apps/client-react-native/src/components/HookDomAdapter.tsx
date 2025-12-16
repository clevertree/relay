import type { ComponentPropsWithoutRef, FC } from 'react';
import React from 'react'
import type {
  ImageProps,
  StyleProp,
  TextInputProps,
  TextProps,
  TouchableOpacityProps,
  ViewProps} from 'react-native';
import {
  Image,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import VideoPlayer from './VideoPlayer'
import { tailwindToStyle } from '../tailwindRuntime'
import { unifiedBridge } from '@relay/shared'

type WithClassName<P> = P & { className?: string }

const TextWrapper = React.forwardRef<Text, WithClassName<TextProps>>(function TextWrapper({ className, style, ...rest }, ref) {
  const tw = className ? tailwindToStyle(className) : undefined
  return <Text ref={ref} style={[tw, style]} {...rest} />
})

const ViewWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function ViewWrapper({ className, style, ...rest }, ref) {
  const tw = className ? tailwindToStyle(className) : undefined
  return <View ref={ref} style={[tw, style]} {...rest} />
})

const ButtonWrapper = React.forwardRef<View, WithClassName<TouchableOpacityProps>>(function ButtonWrapper(
  { className, style, children, ...rest },
  ref,
) {
  const tw = className ? tailwindToStyle(className) : undefined
  return (
    <TouchableOpacity ref={ref} style={[tw, style]} {...rest}>
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </TouchableOpacity>
  )
})

const InputWrapper = React.forwardRef<TextInput, WithClassName<TextInputProps>>(function InputWrapper({ className, style, ...rest }, ref) {
  const extraProps: Partial<TextInputProps> = {}
  // Support common input type hints via rest.type if present at runtime
  const runtimeType = (rest as any).type
  if (runtimeType === 'number' || runtimeType === 'tel') {
    extraProps.keyboardType = 'numeric'
  }
  const tw = className ? tailwindToStyle(className) : undefined
  return <TextInput ref={ref} style={[tw, style]} {...rest} {...extraProps} />
})

const TextAreaWrapper = React.forwardRef<TextInput, WithClassName<TextInputProps>>(function TextAreaWrapper({ className, style, ...rest }, ref) {
  const tw = className ? tailwindToStyle(className) : undefined
  return <TextInput ref={ref} multiline style={[tw, style]} {...rest} />
})

const ImgWrapper: FC<WithClassName<ImageProps & { src?: string; alt?: string }>> = ({ src, alt, style, className, ...rest }) => {
  const imageProps: ComponentPropsWithoutRef<typeof Image> = {
    source: src ? { uri: src } : undefined,
    accessibilityLabel: alt,
    style: [className ? tailwindToStyle(className) : undefined, style],
    resizeMode: 'contain',
    ...rest,
  }
  return <Image {...imageProps} />
}

const AnchorWrapper: FC<WithClassName<TextProps & { href?: string }>> = ({ className, style, children, ...rest }) => (
  <TouchableOpacity {...rest} style={[className ? tailwindToStyle(className) : undefined, style]} activeOpacity={0.7}>
    <Text>{children}</Text>
  </TouchableOpacity>
)

const UnknownElement: FC<WithClassName<ViewProps> & { tagName: string }> = ({ tagName, className, style, children, ...rest }) => (
  <View
    {...rest}
    style={([
      { borderWidth: 1, borderStyle: 'dashed', borderColor: '#d97706', padding: 6, borderRadius: 6 },
      className ? (tailwindToStyle(className) as any) : undefined,
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
    <View ref={ref} style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, className ? (tailwindToStyle(className) as any) : undefined, style]} {...rest}>
      <Text style={{ marginRight: 6 }}>•</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  )
})

const TableWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function TableWrapper({ className, style, ...rest }, ref) {
  return <View ref={ref} style={[{ flexDirection: 'column', borderWidth: 1, borderColor: '#d1d5db' }, className ? (tailwindToStyle(className) as any) : undefined, style]} {...rest} />
})

const TableRowWrapper = React.forwardRef<View, WithClassName<ViewProps>>(function TableRowWrapper({ className, style, children, ...rest }, ref) {
  return (
    <View ref={ref} style={[{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e5e7eb' }, className ? (tailwindToStyle(className) as any) : undefined, style]} {...rest}>
      {children}
    </View>
  )
})

const TableCellWrapper = React.forwardRef<Text, WithClassName<TextProps>>(function TableCellWrapper({ className, style, children, ...rest }, ref) {
  return (
    <Text
      ref={ref}
      style={[{ flex: 1, padding: 8, borderRightWidth: 1, borderColor: '#e5e7eb' }, className ? (tailwindToStyle(className) as any) : undefined, style]}
      {...rest}
    >
      {children}
    </Text>
  )
})

const TableHeaderCell = React.forwardRef<Text, WithClassName<TextProps>>(function TableHeaderCell({ style, children, ...rest }, ref) {
  return (
    <Text
      ref={ref}
      style={[
        { flex: 1, padding: 10, borderRightWidth: 1, borderColor: '#e5e7eb', fontWeight: '700' },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
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
      // hook-rendered elements receive styles from our tailwind runtime.
      if (props && props.className) {
        try {
          const tw = tailwindToStyle(props.className)
          // Query bridge for any runtime RN styles for this element
          const bridgeStyles = unifiedBridge.getRnStyles(props.tagName || type, (props.className || '').split(/\s+/).filter(Boolean))
          const mergedStyle = [tw, bridgeStyles || {}, props.style]
          const nextProps = { ...props, style: mergedStyle }
          // remove className to avoid cluttering downstream components
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
