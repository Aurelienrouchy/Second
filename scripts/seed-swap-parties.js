/**
 * Script to create swap parties for Seconde
 * Run with: node scripts/seed-swap-parties.js
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
// Style: Mode française, seconde main chic, éco-responsable
// ============================================================
const SWAP_PARTY_CALENDAR = [
  // Active party (starts now, ends in 2 days)
  {
    name: 'Capsule Hivernale',
    emoji: '🧥',
    description: 'Manteaux iconiques, cachemire, laine vierge. Les pièces maîtresses de votre garde-robe d\'hiver.',
    theme: 'hiver',
    isGeneralist: false,
    status: 'active',
    startDate: addHours(new Date(), -12),
    endDate: addHours(new Date(), 36),
    minValue: 30,
    featuredBrands: ['Sandro', 'Maje', 'Isabel Marant', 'Acne Studios'],
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
    minValue: 100,
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
    name: 'Printemps des Créateurs',
    emoji: '🌷',
    description: 'Pièces légères, imprimés floraux, couleurs pastels. Préparez les beaux jours.',
    theme: 'printemps',
    isGeneralist: false,
    status: 'upcoming',
    startDate: addDays(new Date(), 33),
    endDate: addDays(new Date(), 35),
    minValue: null,
    featuredBrands: ['Rouje', 'Sézane', 'Jacquemus', 'Ganni'],
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
    minValue: 50,
    featuredBrands: ['Hermès', 'Longchamp', 'Polène', 'A.P.C.'],
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
    featuredBrands: ['Levi\'s Vintage', 'Closed', 'Agolde', 'Citizens of Humanity'],
  },
];

async function seedSwapParties() {
  console.log('\n🎉 SECONDE - Seed Swap Parties');
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
      console.log(`   📅 ${party.startDate.toLocaleDateString('fr-FR')} → ${party.endDate.toLocaleDateString('fr-FR')}`);
      if (party.minValue) {
        console.log(`   💰 Valeur min: ${party.minValue}€`);
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
