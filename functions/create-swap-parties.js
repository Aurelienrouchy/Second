/**
 * Script to create swap parties for the rest of 2026
 * Run from /functions directory: node create-swap-parties.js
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// NOTE: `theme` is stored as a plain string (e.g. 'printemps', 'eco', 'capsule'),
// NOT as a SwapPartyTheme object. The client-side hook (useSwapZone.ts) must handle
// both formats: string from this script, or object { name, ... } if future scripts
// use the TypeScript SwapPartyTheme type.
const swapParties = [
  {
    name: 'Printemps Parisien',
    emoji: '🌸',
    theme: 'printemps',
    description: 'Renouvelez votre garde-robe pour le printemps : robes légères, vestes pastel, accessoires fleuris.',
    isGeneralist: false,
    status: 'active',
    startDate: new Date('2026-03-10'),
    endDate: new Date('2026-03-31'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Earth Day Swap',
    emoji: '🌍',
    theme: 'eco',
    description: 'Spéciale Jour de la Terre — échangez responsable, prolongez la vie de vos pièces préférées.',
    isGeneralist: true,
    status: 'upcoming',
    startDate: new Date('2026-04-18'),
    endDate: new Date('2026-04-30'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Capsule Printemps',
    emoji: '🌿',
    theme: 'capsule',
    description: 'Construisez votre capsule printanière idéale : pièces versatiles, basiques élevés, looks minimalistes.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-05-09'),
    endDate: new Date('2026-05-24'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Été Bohème',
    emoji: '☀️',
    theme: 'ete',
    description: 'Maxis, broderies, robes bohèmes, mules… Préparez votre été avec style.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-06-06'),
    endDate: new Date('2026-06-28'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Festival Season',
    emoji: '🎪',
    theme: 'festival',
    description: 'Looks festivals, pièces colorées, layering créatif — habillez vos étés musicaux.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-07-04'),
    endDate: new Date('2026-07-26'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Vacances & Plage',
    emoji: '🌊',
    theme: 'vacances',
    description: 'Maillots, paréos, robes de plage, sandales — tout pour des vacances parfaites.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-23'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Rentrée Style',
    emoji: '🍂',
    theme: 'rentree',
    description: 'Nouvelle saison, nouveau vestiaire. Blazers, denim, sneakers, sacs — la rentrée en beauté.',
    isGeneralist: true,
    status: 'upcoming',
    startDate: new Date('2026-09-05'),
    endDate: new Date('2026-09-27'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Automne Doré',
    emoji: '🍁',
    theme: 'automne',
    description: 'Manteaux, pulls cachemire, bottines, couleurs terre — entrez dans la saison avec élégance.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-10-10'),
    endDate: new Date('2026-10-31'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Luxe & Vintage',
    emoji: '✨',
    theme: 'luxe',
    description: 'Pièces de créateurs, vintage premium, sacs iconiques — la swap des pièces d\'exception.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-11-07'),
    endDate: new Date('2026-11-22'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
  {
    name: 'Fêtes & Paillettes',
    emoji: '🎄',
    theme: 'fetes',
    description: 'Robes de soirée, smoking, velours, sequins — brillez pendant les fêtes de fin d\'année.',
    isGeneralist: false,
    status: 'upcoming',
    startDate: new Date('2026-12-05'),
    endDate: new Date('2026-12-28'),
    participantsCount: 0,
    itemsCount: 0,
    swapsCount: 0,
  },
];

async function createSwapParties() {
  console.log('Creating ' + swapParties.length + ' swap parties...\n');

  const batch = db.batch();

  for (const party of swapParties) {
    const ref = db.collection('swapParties').doc();
    batch.set(ref, {
      ...party,
      startDate: admin.firestore.Timestamp.fromDate(party.startDate),
      endDate: admin.firestore.Timestamp.fromDate(party.endDate),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('  Queued: ' + party.emoji + ' ' + party.name + ' (' + party.status + ') — ' +
      party.startDate.toLocaleDateString('fr-FR') + ' → ' + party.endDate.toLocaleDateString('fr-FR'));
  }

  await batch.commit();
  console.log('\n✅ All ' + swapParties.length + ' swap parties created successfully!');
}

createSwapParties()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
