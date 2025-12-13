module.exports = {
  presets: [
    'module:@react-native/babel-preset',
    // NativeWind provides a Babel preset (not a single plugin)
    'nativewind/babel',
  ],
  plugins: [
    // Preserve dynamic imports (don't convert import() to require())
    '@babel/plugin-syntax-dynamic-import',
  ],
};
