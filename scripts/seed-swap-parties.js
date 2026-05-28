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

// Helper to create dates
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addHours(date, hours) {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

// ============================================================
// SWAP PARTIES CALENDAR - Seconde
// Style: Mode seconde main chic — marché canadien (CAD)
// minValue exprimé en CAD ($). Marques crédibles au Canada
// (disponibles chez Simons / Holt Renfrew / Aritzia + créateurs d'ici).
// ============================================================
const SWAP_PARTY_CALENDAR = [
  // Active party (starts now, ends in 2 days)
  {
    name: 'Capsule Hivernale',
    emoji: '🧥',
    description: 'Parkas, doudounes et laine vierge pour affronter l\'hiver canadien. Les pièces qui tiennent vraiment chaud.',
    theme: 'hiver',
    isGeneralist: false,
    status: 'active',
    startDate: addHours(new Date(), -12),
    endDate: addHours(new Date(), 36),
    minValue: 50,
    featuredBrands: ['Canada Goose', 'Mackage', 'Moose Knuckles', 'Aritzia'],
  },
  // Upcoming parties
  {
    name: 'La Grande Swap',
    emoji: '✨',
    description: 'Notre swap party signature. Tous les styles, toutes les tailles, toutes les occasions.',
    theme: null,
    isGeneralist: true,
    status: 'upcoming',
    startDate: addDays(new Date(), 5),
    endDate: addDays(new Date(), 7),
    minValue: null,
    featuredBrands: [],
  },
  {
    name: 'Luxe & Créateurs',
    emoji: '💎',
    description: 'Pièces de créateurs et maisons de luxe. Authenticité garantie, style assuré.',
    theme: 'luxe',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 12),
    endDate: addDays(new Date(), 14),
    minValue: 150,
    featuredBrands: ['Céline', 'Chanel', 'Saint Laurent', 'Loewe', 'The Row'],
  },
  {
    name: 'Vintage Années 80-90',
    emoji: '📼',
    description: 'Épaulettes, power suits, denim vintage. L\'âge d\'or de la mode revisité.',
    theme: 'vintage',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 19),
    endDate: addDays(new Date(), 21),
    minValue: null,
    featuredBrands: ['Thierry Mugler', 'Jean Paul Gaultier', 'Versace', 'Alaïa'],
  },
  {
    name: 'Seconde Chance',
    emoji: '🔄',
    description: 'La swap party mensuelle ouverte à tous. Donnez une seconde vie à vos pièces.',
    theme: null,
    isGeneralist: true,
    status: 'upcoming',
    startDate: addDays(new Date(), 26),
    endDate: addDays(new Date(), 28),
    minValue: null,
    featuredBrands: [],
  },
  {
    name: 'Mode d\'Ici',
    emoji: '🍁',
    description: 'Créateurs et marques d\'ici. Du denim québécois au cachemire éthique, le meilleur de la mode canadienne.',
    theme: 'local',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 33),
    endDate: addDays(new Date(), 35),
    minValue: null,
    featuredBrands: ['Aritzia', 'Frank And Oak', 'Roots', 'Kotn', 'Simons'],
  },
  {
    name: 'Accessoires & Sacs',
    emoji: '👜',
    description: 'Sacs iconiques, ceintures, foulards. Les détails qui font tout.',
    theme: 'accessoires',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 40),
    endDate: addDays(new Date(), 42),
    minValue: 75,
    featuredBrands: ['Hermès', 'Longchamp', 'Polène', 'Marc Jacobs'],
  },
  {
    name: 'Denim Forever',
    emoji: '👖',
    description: 'Jeans vintage, vestes en jean, chemises denim. La pièce intemporelle.',
    theme: 'denim',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 47),
    endDate: addDays(new Date(), 49),
    minValue: null,
    featuredBrands: ['Levi\'s Vintage', 'Frank And Oak', 'Citizens of Humanity', 'Agolde'],
  },
];

async function seedSwapParties() {
  console.log('\n🎉 SECONDE - Seed Swap Parties (Canada / CAD)');
  console.log('================================\n');

  // First, clear existing swap parties
  console.log('Nettoyage des swap parties existantes...');
  const existingParties = await db.collection('swapParties').get();
  const batch = db.batch();
  existingParties.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log(`✅ ${existingParties.size} parties supprimées.\n`);

  // Create new parties
  console.log('Création des nouvelles swap parties...\n');

  for (const party of SWAP_PARTY_CALENDAR) {
    try {
      const partyData = {
        ...party,
        id: '', // Will be set after creation
        participantsCount: 0,
        itemsCount: 0,
        swapsCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection('swapParties').add(partyData);
      await docRef.update({ id: docRef.id });

      const statusIcon = party.status === 'active' ? '🟢' : '🔵';
      console.log(`${statusIcon} ${party.emoji} ${party.name}`);
      console.log(`   ${party.description.substring(0, 60)}...`);
      console.log(`   📅 ${party.startDate.toLocaleDateString('fr-CA')} → ${party.endDate.toLocaleDateString('fr-CA')}`);
      if (party.minValue) {
        console.log(`   💰 Valeur min: ${party.minValue} $ CAD`);
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Échec: ${party.name}:`, error.message);
    }
  }

  console.log('================================');
  console.log(`✅ ${SWAP_PARTY_CALENDAR.length} swap parties créées!`);
}

seedSwapParties()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur fatale:', error);
    process.exit(1);
  });
