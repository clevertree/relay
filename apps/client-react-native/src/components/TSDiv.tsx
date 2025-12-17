import React, { useContext, useMemo, useEffect } from 'react'
import { StyleProp, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
            const hierarchySummary = hierarchy
                .map((n) => `${n.tag}${n.classes.length ? `.${n.classes.join('.')}` : ''}`)
                .join(' > ')
            console.log('[TSDiv] registerUsage', { tag, className, hierarchy: hierarchySummary })
        } catch (e) {
            console.warn('[TSDiv] registerUsage failed', e)
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

const overflowClassRegex = /\boverflow(?:-[xy])?-[a-z0-9-]+\b/i
const buttonComponent = TouchableOpacity ?? View
const tagComponentMap: Record<string, React.ComponentType<any>> = {
    span: Text,
    button: buttonComponent,
    main: SafeAreaView,
    'safe-area': SafeAreaView,
    'safe-area-view': SafeAreaView,
    scroll: ScrollView,
}

type TSDivProps = {
    component?: React.ComponentType<any>
    tag?: string
    className?: string
    style?: StyleProp<any>
    children?: React.ReactNode
} & Record<string, any>

function hasOverflowClass(className?: string) {
    return Boolean(className && overflowClassRegex.test(className))
}

function prefersScrollView(rest: Record<string, any>, className?: string) {
    if (hasOverflowClass(className)) return true
    const scrollProps = [
        'horizontal',
        'contentContainerStyle',
        'showsHorizontalScrollIndicator',
        'showsVerticalScrollIndicator',
        'onScroll',
        'refreshControl',
        'nestedScrollEnabled',
        'scrollEnabled',
    ]
    return scrollProps.some((prop) => Object.prototype.hasOwnProperty.call(rest, prop))
}

export const TSDiv = React.forwardRef<any, TSDivProps>(
    ({ component, tag = 'div', className, style, children, ...rest }, ref) => {
        const normalizedTag = tag?.toLowerCase?.() ?? 'div'
        const ResolvedComponent =
            component ||
            tagComponentMap[normalizedTag] ||
            (prefersScrollView(rest, className) ? ScrollView : View)

        return (
            <ThemedElement component={ResolvedComponent} tag={tag} className={className} style={style} ref={ref} {...rest}>
                {children}
            </ThemedElement>
        )
    },
)
