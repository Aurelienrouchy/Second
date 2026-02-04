/**
 * Script to import brands into Firestore for Seconde
 * Run with: node scripts/import-brands.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Configuration - try multiple service account paths
const SERVICE_ACCOUNT_PATHS = [
  path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'service-account.json'),
];

// Brands file path
const BRANDS_FILE_PATH = path.join(__dirname, '..', 'vinted-brands.txt');
const BATCH_SIZE = 500;

// Find service account
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
  process.exit(1);
}

// Check brands file
if (!fs.existsSync(BRANDS_FILE_PATH)) {
  console.error('❌ Erreur: Le fichier vinted-brands.txt est manquant.');
  console.error(`Chemin attendu: ${BRANDS_FILE_PATH}`);
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Fonction pour normaliser le nom de la marque
function normalizeBrandName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Fonction pour générer la clé de recherche (lowercase)
function generateSearchKey(name) {
  return name.toLowerCase().trim();
}

// Catégoriser les marques par segment (optionnel pour Seconde)
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

async function importBrands() {
  try {
    console.log('\n✨ SECONDE - Import Brands');
    console.log('================================\n');

    console.log('📖 Lecture du fichier des marques...');
    const fileContent = fs.readFileSync(BRANDS_FILE_PATH, 'utf-8');

    // Nettoyer et dédoublonner
    const brands = new Set();
    fileContent.split('\n').forEach(line => {
      const name = normalizeBrandName(line);
      if (name && name.length > 1) {
        brands.add(name);
      }
    });

    const brandsList = Array.from(brands).sort();
    console.log(`✅ ${brandsList.length} marques uniques trouvées\n`);

    // Stats par tier
    const tiers = { luxury: 0, premium: 0, standard: 0 };
    brandsList.forEach(b => tiers[getBrandTier(b)]++);
    console.log(`   💎 Luxe: ${tiers.luxury}`);
    console.log(`   ⭐ Premium: ${tiers.premium}`);
    console.log(`   📦 Standard: ${tiers.standard}\n`);

    // Préparer les lots
    const chunks = [];
    for (let i = 0; i < brandsList.length; i += BATCH_SIZE) {
      chunks.push(brandsList.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 ${chunks.length} lots à traiter...\n`);

    let totalProcessed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const batch = db.batch();

      chunk.forEach(brandName => {
        const searchKey = generateSearchKey(brandName);
        const docId = searchKey.replace(/\//g, '_').replace(/\s/g, '-');
        const docRef = db.collection('brands').doc(docId);

        batch.set(docRef, {
          label: brandName,
          value: searchKey,
          searchKey: searchKey,
          tier: getBrandTier(brandName),
          count: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      totalProcessed += chunk.length;

      const percent = Math.round(totalProcessed / brandsList.length * 100);
      const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
      process.stdout.write(`\r   [${bar}] ${percent}% (${totalProcessed}/${brandsList.length})`);
    }

    console.log('\n\n================================');
    console.log(`✅ ${brandsList.length} marques importées avec succès!`);
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Erreur pendant l\'import:', error.message);
    process.exit(1);
  }
}

importBrands();
