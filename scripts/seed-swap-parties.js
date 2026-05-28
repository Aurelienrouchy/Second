/**
 * Script to (re)create the single permanent generalist Swap Zone for Seconde.
 * Run with: node scripts/seed-swap-parties.js
 *
 * Modèle actuel : UNE seule Swap Zone généraliste, toujours active, SANS fenêtre
 * de temps (pas d'endDate). On repart à zéro : suppression de toutes les
 * swapParties existantes puis création d'UN SEUL document zone permanente.
 *
 * ⚠️  DESTRUCTIF : supprime TOUTES les swapParties existantes avant de recréer.
 * ⚠️  Cible le projet pointé par le service account (prod seconde-b47a6 si la clé prod est utilisée).
 * Place ta clé service account dans functions/serviceAccountKey.json (non commitée).
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Configuration - try multiple service account paths
const SERVICE_ACCOUNT_PATHS = [
  path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'service-account.json'),
];

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

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ============================================================
// SWAP ZONE - Seconde
// Modèle: UNE seule zone généraliste permanente, toujours active,
// SANS fenêtre de temps (pas d'endDate). On repart à zéro.
// ============================================================
const GENERALIST_SWAP_ZONE = {
  name: 'Swap Zone',
  emoji: '🔄',
  description: 'La zone d\'échange permanente, ouverte à tous. Tous les styles, toutes les tailles, toute l\'année.',
  theme: null,
  isGeneralist: true,
  status: 'active',
  // Permanente : pas d'endDate. startDate = now (informatif uniquement).
  startDate: new Date(),
  endDate: null,
  minValue: null,
  featuredBrands: [],
};

async function seedSwapZone() {
  console.log('\n🎉 SECONDE - Seed Swap Zone (zone unique permanente)');
  console.log('================================\n');

  // 1. Repartir à zéro : supprimer TOUTES les swapParties existantes.
  console.log('Nettoyage des swapParties existantes...');
  const existingParties = await db.collection('swapParties').get();
  const batch = db.batch();
  existingParties.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log(`✅ ${existingParties.size} document(s) supprimé(s).\n`);

  // 2. Créer l'UNIQUE zone généraliste permanente.
  console.log('Création de la Swap Zone généraliste permanente...\n');

  const zoneData = {
    ...GENERALIST_SWAP_ZONE,
    id: '', // sera défini après création
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('swapParties').add(zoneData);
  await docRef.update({ id: docRef.id });

  console.log(`🟢 ${GENERALIST_SWAP_ZONE.emoji} ${GENERALIST_SWAP_ZONE.name} (id: ${docRef.id})`);
  console.log(`   ${GENERALIST_SWAP_ZONE.description}`);
  console.log('   ♾️  Zone permanente — toujours active, sans date de fin.\n');

  console.log('================================');
  console.log('✅ Swap Zone unique créée!');
}

seedSwapZone()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur fatale:', error);
    process.exit(1);
  });
