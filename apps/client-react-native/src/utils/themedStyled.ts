import React from 'react'
import { resolveThemedStyle } from '../components/ThemedElement'

type StyledProps<T extends React.ComponentType<any>> = Omit<React.ComponentProps<T>, 'style'> & {
    className?: string
    style?: React.ComponentProps<T>['style'] | Array<React.ComponentProps<T>['style']>
}

export function styled<T extends React.ComponentType<any>>(Component: T, tagName: string = 'div') {
    type Props = StyledProps<T>
    const Wrapped = React.forwardRef<React.ComponentRef<T>, Props>((props, ref) => {
        const forwardedProps = props as StyledProps<T>
        const { className, style, ...rest } = forwardedProps
        const computed = resolveThemedStyle(tagName, className)
        const mergedStyle = computed ? [computed, style] : style
        return React.createElement(Component, { ...rest as unknown as React.ComponentProps<T>, style: mergedStyle, ref })
    })
    Wrapped.displayName = `Styled(${Component.displayName || Component.name || 'Component'})`
    return Wrapped
}
