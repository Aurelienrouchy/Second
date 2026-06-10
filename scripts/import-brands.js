/**
 * Script to import brands into Firestore for Seconde
 *
 * Usage:
 *   node scripts/import-brands.js            # write to Firestore (needs serviceAccountKey.json OR emulator)
 *   node scripts/import-brands.js --dry-run  # parse/normalize/dedup only, no write, no creds
 *
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/import-brands.js
 *   (no service account required when FIRESTORE_EMULATOR_HOST is set)
 *
 * Source: vinted-brands.txt (canonical, one brand per line, lowercase).
 *
 * Each `brands` doc satisfies BOTH consumers of the collection:
 *   - UI search  (components/search/BrandSelectionSheet.tsx): label, value, searchKey
 *   - IA matcher (functions/src/services/brands.ts):          name, aliases, popularity
 */

const fs = require('fs');
const path = require('path');

// ─── Flags ───────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

// ─── Configuration ───────────────────────────────────────
const SERVICE_ACCOUNT_PATHS = [
  path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'service-account.json'),
];

const BRANDS_FILE_PATH = path.join(__dirname, '..', 'vinted-brands.txt');
const BATCH_SIZE = 500;

// ─── Normalisation helpers ───────────────────────────────

// Proper display/name form: trimmed, internal whitespace collapsed.
// Keeps the original casing of the source ("louis vuitton" with spaces),
// NOT the hyphenated doc id.
function normalizeBrandName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Lowercase search/dedup key.
function generateSearchKey(name) {
  return name.toLowerCase().trim();
}

// Doc id derived from the search key: slashes → '_', spaces → '-'.
function generateDocId(searchKey) {
  return searchKey.replace(/\//g, '_').replace(/\s/g, '-');
}

// Tier segmentation (informational only).
function getBrandTier(brandName) {
  const luxuryBrands = [
    'chanel', 'hermès', 'hermes', 'louis vuitton', 'dior', 'gucci', 'prada',
    'saint laurent', 'ysl', 'bottega veneta', 'celine', 'céline', 'loewe',
    'balenciaga', 'valentino', 'fendi', 'givenchy', 'burberry', 'versace',
    'alexander mcqueen', 'tom ford', 'the row', 'loro piana', 'brunello cucinelli'
  ];

  const premiumBrands = [
    'sandro', 'maje', 'claudie pierlot', 'isabel marant', 'acne studios',
    'a.p.c.', 'apc', 'ami paris', 'jacquemus', 'ganni', 'totême', 'toteme',
    'rouje', 'sézane', 'sezane', 'ba&sh', 'bash', 'zadig & voltaire',
    'kenzo', 'coach', 'michael kors', 'marc jacobs', 'see by chloé',
    'diesel', 'boss', 'ralph lauren', 'tommy hilfiger', 'calvin klein'
  ];

  const searchKey = brandName.toLowerCase();

  if (luxuryBrands.some(b => searchKey.includes(b))) {
    return 'luxury';
  }
  if (premiumBrands.some(b => searchKey.includes(b))) {
    return 'premium';
  }
  return 'standard';
}

// ─── Build the list of brand docs (no I/O to Firestore) ──
function buildBrandDocs() {
  if (!fs.existsSync(BRANDS_FILE_PATH)) {
    console.error('❌ Erreur: Le fichier vinted-brands.txt est manquant.');
    console.error(`Chemin attendu: ${BRANDS_FILE_PATH}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(BRANDS_FILE_PATH, 'utf-8');

  // Normalise + dedup.
  const brands = new Set();
  fileContent.split('\n').forEach(line => {
    const name = normalizeBrandName(line);
    if (name && name.length > 1) {
      brands.add(name);
    }
  });

  const brandsList = Array.from(brands).sort();

  return brandsList.map(brandName => {
    const searchKey = generateSearchKey(brandName);
    const docId = generateDocId(searchKey);
    return {
      docId,
      data: {
        // ── UI search contract ──
        label: brandName,
        value: searchKey,
        searchKey: searchKey,
        // ── IA matcher contract ──
        name: brandName, // proper spaced name (NOT the hyphenated doc id)
        aliases: [],
        popularity: 0,
        // ── metadata ──
        tier: getBrandTier(brandName),
        count: 0,
      },
    };
  });
}

function printStats(docs) {
  const tiers = { luxury: 0, premium: 0, standard: 0 };
  docs.forEach(d => tiers[d.data.tier]++);
  console.log(`✅ ${docs.length} marques uniques\n`);
  console.log(`   💎 Luxe: ${tiers.luxury}`);
  console.log(`   ⭐ Premium: ${tiers.premium}`);
  console.log(`   📦 Standard: ${tiers.standard}\n`);
}

// ─── DRY RUN ─────────────────────────────────────────────
function runDryRun() {
  console.log('\n✨ SECONDE - Import Brands (DRY RUN — aucune écriture)');
  console.log('================================\n');

  const docs = buildBrandDocs();
  printStats(docs);

  console.log('📄 5 documents d\'exemple (schéma complet):\n');
  docs.slice(0, 5).forEach(d => {
    console.log(`   doc id: ${d.docId}`);
    console.log(`   ${JSON.stringify(d.data)}\n`);
  });

  // Also show a known multi-word luxury brand to confirm `name` has spaces.
  const lv = docs.find(d => d.data.searchKey === 'louis vuitton');
  if (lv) {
    console.log('🔎 Vérification "louis vuitton":\n');
    console.log(`   doc id: ${lv.docId}`);
    console.log(`   ${JSON.stringify(lv.data)}\n`);
  }

  console.log('================================');
  console.log('✅ DRY RUN terminé. Rien n\'a été écrit.');
  process.exit(0);
}

// ─── REAL WRITE (Firestore or emulator) ──────────────────
async function runImport() {
  const admin = require('firebase-admin');

  if (USE_EMULATOR) {
    console.log(`🧪 Émulateur Firestore détecté: ${process.env.FIRESTORE_EMULATOR_HOST}`);
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'seconde-b47a6' });
  } else {
    let serviceAccount = null;
    for (const accountPath of SERVICE_ACCOUNT_PATHS) {
      if (fs.existsSync(accountPath)) {
        serviceAccount = require(accountPath);
        console.log(`✅ Service account trouvé: ${path.basename(accountPath)}`);
        break;
      }
    }

    if (!serviceAccount) {
      console.error('❌ Erreur: Aucun fichier service account trouvé.');
      console.error('Chemins recherchés:');
      SERVICE_ACCOUNT_PATHS.forEach(p => console.error(`  - ${p}`));
      console.error('\nAstuce: lancez avec --dry-run pour valider sans credentials,');
      console.error('ou définissez FIRESTORE_EMULATOR_HOST pour viser l\'émulateur.');
      process.exit(1);
    }

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();

  try {
    console.log('\n✨ SECONDE - Import Brands');
    console.log('================================\n');

    const docs = buildBrandDocs();
    printStats(docs);

    const chunks = [];
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      chunks.push(docs.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 ${chunks.length} lots à traiter...\n`);

    let totalProcessed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const batch = db.batch();

      chunk.forEach(({ docId, data }) => {
        const docRef = db.collection('brands').doc(docId);
        batch.set(
          docRef,
          { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      });

      await batch.commit();
      totalProcessed += chunk.length;

      const percent = Math.round(totalProcessed / docs.length * 100);
      const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
      process.stdout.write(`\r   [${bar}] ${percent}% (${totalProcessed}/${docs.length})`);
    }

    console.log('\n\n================================');
    console.log(`✅ ${docs.length} marques importées avec succès!`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erreur pendant l\'import:', error.message);
    process.exit(1);
  }
}

// ─── Entrypoint ──────────────────────────────────────────
if (DRY_RUN) {
  runDryRun();
} else {
  runImport();
}
