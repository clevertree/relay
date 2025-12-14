module.exports = {
  presets: [
    'module:@react-native/babel-preset',
  ],
  plugins: [
    // Preserve dynamic imports (don't convert import() to require())
    '@babel/plugin-syntax-dynamic-import',
  ],
};
