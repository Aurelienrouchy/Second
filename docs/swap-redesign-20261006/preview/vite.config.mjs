// Review-only renderer. Production Expo/web entry points are never changed.
import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
const repo = path.resolve(import.meta.dirname, '../../..');
const root = process.env.SWAP_PREVIEW_ROOT || repo;
const here = import.meta.dirname;
const adapter = (file) => path.join(here, 'adapters', file);
const exact = (find, replacement) => ({ find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement });
export default defineConfig({
  root: here,
  plugins: [{name:'review-type-only-category-exports',enforce:'pre',transform(code,id){
    // Rolldown does not infer type-only reexports across TS modules like Metro.
    if(id.endsWith('/data/categories-v2.ts')) return code.replace(/^\s*(CategoryNode|FlatCategory|CategoryInfo),\s*$/gm,'');
  }},{name:'local-review-fonts', configureServer(server) {
    server.middlewares.use('/fonts', (request,response,next) => {
      const name = path.basename(request.url || '');
      const filename = name === 'Ionicons.ttf' ? path.join(repo, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') : path.join(root,'assets/fonts',name);
      if (!fs.existsSync(filename)) return next();
      response.setHeader('Content-Type','font/ttf'); fs.createReadStream(filename).pipe(response);
    });
  }}],
  resolve: { alias: [
    exact('react-native',path.join(repo,'node_modules/react-native-web')),
    exact('react',path.join(repo,'node_modules/react')),
    exact('react-dom/client',path.join(repo,'node_modules/react-dom/client.js')),
    exact('@tanstack/react-query',path.join(repo,'node_modules/@tanstack/react-query')),
    exact('expo-router',adapter('router.jsx')),
    exact('react-native-safe-area-context',adapter('safe-area.jsx')),
    exact('react-native-reanimated',adapter('animation.jsx')),
    exact('@expo/vector-icons',adapter('icons.jsx')),
    exact('expo-image',adapter('image.jsx')),
    exact('expo-linear-gradient',adapter('gradient.jsx')),
    exact('@shopify/flash-list',adapter('list.jsx')),
    exact('@gorhom/bottom-sheet',adapter('sheet.jsx')),
    ...['expo-haptics','expo-status-bar','expo-image-picker','expo-crypto','firebase/storage','firebase/functions'].map(name=>exact(name,adapter('native.mjs'))),
    ...['@/hooks/useAuth','@/hooks/useAuthRequired'].map(name=>exact(name,adapter('auth.jsx'))),
    exact('@/store/authSheetStore',adapter('auth.jsx')),
    exact('@/services/chatService',adapter('services.mjs')),
    ...['@/services/swapService','@/services/articlesService','@/services/moderationService','@/config/firebaseConfig','@/lib/analytics','@/utils/imageUtils','@/utils/privateMedia'].map(name=>exact(name,adapter('services.mjs'))),
    exact('@/components/StripePayment',adapter('payment.jsx')),
    exact('@/components/ui',adapter('ui.mjs')),
    exact('@/features/search',adapter('search.mjs')),
    ...['@/components/CategoryBottomSheet','@/components/SelectionBottomSheet','@/components/SizeSelectionSheet','@/components/search/BrandSelectionSheet'].map(name=>exact(name,adapter('filter-sheet.jsx'))),
    { find: /^@\//, replacement: root + '/' },
  ], dedupe:['react','react-dom'] },
  server: {host:'127.0.0.1', port:Number(process.env.SWAP_PREVIEW_PORT || 4173), strictPort:true, fs:{allow:[repo,root,here]}},
  optimizeDeps:{include:['react','react-dom/client','react-native-web','@tanstack/react-query']},
});
