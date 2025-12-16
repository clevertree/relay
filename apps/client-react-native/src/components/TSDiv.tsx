import React from 'react'
import { View, type ViewProps } from 'react-native'
import { ThemedElement } from './ThemedElement'

type TSDivProps = ViewProps & { className?: string; tag?: string }

export const TSDiv = React.forwardRef<View, TSDivProps>(({ tag = 'div', className, style, ...rest }, ref) => (
    <ThemedElement component={View} tag={tag} className={className} style={style} ref={ref} {...rest} />
))
