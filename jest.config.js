/**
 * Jest configuration — composant / écran / hook RN (preset jest-expo).
 *
 * Périmètre Jest : tests RN qui montent des composants ou des hooks via
 * @testing-library/react-native. Fichiers `*.test.tsx` n'importe où dans le
 * repo, plus le dossier dédié `tests/jest/`.
 *
 * IMPORTANT — pas de collision avec Vitest :
 * Vitest (vitest.config.ts) possède les `*.test.ts` (logique pure, stores,
 * services, hooks data) dans utils/ lib/ store/ hooks/ services/ features/,
 * ainsi que functions/ et tests/security/. Jest ne ramasse QUE les `.test.tsx`
 * et le dossier tests/jest/, et ignore explicitement les territoires Vitest.
 */

module.exports = {
  // Preset plateforme iOS : jest-expo injecte `platform: 'ios'` dans le caller
  // babel (Platform.OS, process.env.EXPO_OS) — sinon le setup HMR du preset
  // échoue avec « Missing required parameter `platform` ». On teste la cible
  // native iOS (suffit pour des composants/hook cross-platform).
  preset: 'jest-expo/ios',

  // Jest ne prend QUE les tests composant/écran/hook RN (.test.tsx) + le
  // dossier dédié tests/jest/. Les *.test.ts restent à Vitest.
  testMatch: [
    '<rootDir>/**/*.test.tsx',
    '<rootDir>/tests/jest/**/*.test.{ts,tsx}',
  ],

  // Garde-fous anti-collision : on n'entre jamais dans les zones Vitest /
  // dépendances / natif / worktrees Claude (sinon Haste collision sur les
  // package.json dupliqués).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/functions/',
    '/tests/security/',
    '/android/',
    '/ios/',
    '/.expo/',
    '/.claude/',
    '/.agents/',
  ],

  // Évite les collisions Haste (package.json dupliqués dans les worktrees).
  modulePathIgnorePatterns: [
    '<rootDir>/.claude/',
    '<rootDir>/.agents/',
  ],
  haste: {
    // Conserve la plateforme du preset jest-expo/ios (sinon le merge écrase
    // defaultPlatform/platforms et casse la résolution *.ios.tsx).
    defaultPlatform: 'ios',
    platforms: ['ios', 'native'],
    // Pas d'erreur dure si des package.json dupliqués subsistent ailleurs.
    throwOnModuleCollision: false,
  },

  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // babel-preset-expo transpile déjà le code app ; on whiteliste les paquets
  // RN/Expo livrés en ESM/Flow pour qu'ils passent par babel. On part du
  // pattern jest-expo et on ajoute les libs spécifiques au projet.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-modules-core|expo-router|expo-font|react-native-reanimated|react-native-worklets|react-native-gesture-handler|@react-navigation/.*|@shopify/flash-list|@shopify/react-native-skia|react-native-svg|@gorhom/.*|react-native-safe-area-context|react-native-screens)/)',
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@app/(.*)$': '<rootDir>/app/$1',
  },

  // Resolver Reanimated 4 / Worklets : retire le suffixe `.native` pour
  // react-native-worklets afin de résoudre son implémentation mockée (sinon
  // « Native part of Worklets doesn't seem to be initialized » sous Jest).
  resolver: '<rootDir>/node_modules/react-native-worklets/jest/resolver.js',

  // Couverture orientée code app (jamais les tests/config/natif).
  collectCoverageFrom: [
    'components/**/*.{ts,tsx}',
    'features/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/__mocks__/**',
  ],

  clearMocks: true,
};
