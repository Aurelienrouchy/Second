// @ts-check
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const boundaries = require('eslint-plugin-boundaries');

module.exports = defineConfig([
  // ── Expo base config ──────────────────────────────────────────────
  ...expoConfig,

  // ── Global ignores ────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      '.expo/**',
      'dist/**',
      'functions/**',
      'tests/**',
      'scripts/**',
      '_bmad/**',
      '_bmad-output/**',
      '.claude/**',
      'babel.config.js',
      'metro.config.js',
    ],
  },

  // ── Boundaries plugin ─────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        // features MUST be listed first — the plugin matches path segments
        // bottom-up, so a nested `components/` inside features/ would
        // incorrectly match the shared `components/**` pattern otherwise.
        { type: 'features', pattern: 'features/*/**', capture: ['feature'], mode: 'full' },

        // app: Expo Router routes
        { type: 'app', pattern: 'app/**', mode: 'full' },

        // shared: importable partout
        { type: 'shared', pattern: ['lib/**', 'utils/**', 'constants/**', 'types/**', 'config/**', 'data/**'], mode: 'full' },

        // core: services, stores, hooks, contexts, components
        { type: 'core', pattern: ['services/**', 'store/**', 'hooks/**', 'contexts/**', 'components/**'], mode: 'full' },
      ],
    },
    rules: {
      'boundaries/dependencies': ['error', {
        default: 'allow',
        rules: [
          // shared -> shared only (no core, no features, no app)
          {
            from: { type: 'shared' },
            disallow: { to: [{ type: 'core' }, { type: 'features' }, { type: 'app' }] },
          },

          // core -> shared + core only (no features, no app)
          {
            from: { type: 'core' },
            disallow: { to: [{ type: 'features' }, { type: 'app' }] },
          },

          // features -> shared + core + same feature only (no app, no other feature)
          {
            from: { type: 'features' },
            disallow: { to: [{ type: 'app' }] },
          },
          // Cross-import prevention: a feature cannot import from another feature
          {
            from: { type: 'features' },
            disallow: { to: { type: 'features', captured: { feature: '!{{from.feature}}' } } },
            message: 'Cross-import between features is forbidden. Extract shared code to core/ or components/.',
          },
        ],
      }],

      // Turn off noisy rules during setup — we only care about boundaries for now
      'boundaries/entry-point': 'off',
      'boundaries/no-unknown': 'off',
      'boundaries/no-unknown-files': 'off',
      'boundaries/no-private': 'off',
      'boundaries/no-ignored': 'off',
      'boundaries/external': 'off',
    },
  },
]);
