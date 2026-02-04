const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add support for React Native Firebase
config.resolver.sourceExts.push('cjs');

// Fix React Native Firebase ES modules issue
config.resolver.unstable_enablePackageExports = false;

module.exports = config;