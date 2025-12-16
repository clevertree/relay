import React, { useContext, useMemo, useEffect } from 'react'
import { StyleProp } from 'react-native'
import { unifiedBridge } from '@relay/shared'

type HierNode = { tag: string; classes: string[] }
const HierarchyContext = React.createContext<HierNode[]>([])

function parseClassName(className?: string) {
    if (!className || typeof className !== 'string') return []
    return className.trim().split(/\s+/).filter(Boolean)
}

export function useThemedStyles(tag: string, className?: string) {
    const parentHierarchy = useContext(HierarchyContext)
    const classes = useMemo(() => parseClassName(className), [className])
    const node = useMemo(() => ({ tag, classes }), [tag, className])
    const hierarchy = useMemo(() => [...parentHierarchy, node], [parentHierarchy, node])

    useEffect(() => {
        try {
            unifiedBridge.registerUsage(tag, { className }, hierarchy)
        } catch (e) {
            // ignore
        }
    }, [tag, className, hierarchy])

    const style = classes.length ? (unifiedBridge.getRnStyles(tag, classes) as StyleProp<any>) : undefined
    return { style, hierarchy }
}

type ThemedElementProps = {
    component: React.ComponentType<any>
    tag?: string
    className?: string
    style?: StyleProp<any>
    children?: React.ReactNode
} & Record<string, any>

export const ThemedElement = React.forwardRef<any, ThemedElementProps>(
    ({ component: Component, tag = 'div', className, style, children, ...rest }, ref) => {
        const { style: themedStyle, hierarchy } = useThemedStyles(tag, className)
        const mergedStyle = themedStyle ? [themedStyle, style] : style
        return (
            <HierarchyContext.Provider value={hierarchy}>
                <Component ref={ref} style={mergedStyle} {...rest}>
                    {children}
                </Component>
            </HierarchyContext.Provider>
        )
    },
)

export function resolveThemedStyle(tag: string, className?: string) {
    const classes = parseClassName(className)
    try {
        unifiedBridge.registerUsage(tag, { className })
    } catch (e) {
        // ignore
    }
    return classes.length ? (unifiedBridge.getRnStyles(tag, classes) as StyleProp<any>) : undefined
}
