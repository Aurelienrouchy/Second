const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add support for React Native Firebase
config.resolver.sourceExts.push('cjs');

module.exports = config;