const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;

const config = {
  projectRoot,
  watchFolders: [
    path.resolve(__dirname, '../shared'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
    ],
    extraNodeModules: {
      '@relay/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
