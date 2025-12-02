/**
 * Plugins index - exports all plugin components and registry
 */

export * from './registry';
export {default as DefaultNativePlugin} from './DefaultNative';
export {default as DeclarativePlugin} from './DeclarativeNative';
export {default as WebViewPlugin} from './WebViewPlugin';
export {default as PluginSwitcher} from './PluginSwitcher';