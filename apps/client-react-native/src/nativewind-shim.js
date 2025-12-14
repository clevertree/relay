const { StyleSheet } = require('react-native');

// Minimal tailwind -> RN styles mapping for a few common classes used in the app.
const TW_SPACE = { '0': 0, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '8': 32, '12': 48 };
const TW_TEXT_SIZES = { xs: 11, sm: 12, base: 14, lg: 16, xl: 18, '2xl': 20 };

function tailwindToStyle(className) {
    if (!className) return undefined;
    const style = {};
    const classes = String(className).trim().split(/\s+/);
    for (const c of classes) {
        if (c === 'flex') style.display = 'flex';
        else if (c === 'flex-1') style.flex = 1;
        else if (c === 'flex-row') style.flexDirection = 'row';
        else if (c === 'items-center') style.alignItems = 'center';
        else if (c.startsWith('p-')) {
            const v = c.slice(2); const px = TW_SPACE[v]; if (px !== undefined) style.padding = px;
        } else if (c.startsWith('text-')) {
            const v = c.slice(5);
            if (TW_TEXT_SIZES[v] !== undefined) style.fontSize = TW_TEXT_SIZES[v];
        }
    }
    return style;
}

function createStyledWrapper(Component) {
    return function StyledWrapper(props) {
        const { className, style, children, ...rest } = props || {};
        const twStyle = tailwindToStyle(className);
        const merged = [twStyle, style];
        return require('react').createElement(Component, { ...rest, style: merged }, children);
    };
}

// Provide an explicit installer to attach the shim to a loaded `nativewind`
// module. This avoids circular requires where `nativewind` and this shim
// require each other during module initialization, which can leave
// exports incomplete.
function installInto(nw) {
    try {
        if (!nw) return false;
        if (typeof nw.styled !== 'function') {
            nw.styled = (Comp) => createStyledWrapper(Comp);
        }
        if (typeof nw.NativeWindStyleSheet === 'undefined' && typeof StyleSheet !== 'undefined') {
            nw.NativeWindStyleSheet = StyleSheet;
        }
        try {
            // eslint-disable-next-line no-console
            console.log('[nativewind-shim] installed into nativewind', !!nw.styled, !!nw.NativeWindStyleSheet);
            // console.warn is often more visible in native log pipelines
            try { console.warn('[nativewind-shim] installed into nativewind', !!nw.styled, !!nw.NativeWindStyleSheet); } catch (e) { }
        } catch (e) {
            // ignore logging failures in some runtimes
        }
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = { tailwindToStyle, createStyledWrapper, installInto };
