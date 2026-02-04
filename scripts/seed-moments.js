/**
 * Script to create seasonal moments for Seconde
 * Each moment has an embedding for semantic matching with articles
 * Run with: node scripts/seed-moments.js
 */

const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

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

// Gemini API Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyA71o4twqvXTt18dzzCEid1z631w-olk4Y';

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============================================================
// DÉFINITION DES MOMENTS - Seconde
// Style: Mode française, élégance intemporelle, seconde main chic
// ============================================================
const MOMENTS = [
  {
    id: 'nouvel-an',
    name: 'Réveillon',
    emoji: '🥂',
    description: `Tenue de fête réveillon du Nouvel An, robe de soirée élégante sequins paillettes,
      smoking costume homme chic, talons hauts dorés argentés, pochette de soirée clutch,
      bijoux statement, velours satin soie, champagne vibes glamour parisien`,
    dateStart: '12-20',
    dateEnd: '01-07',
    priority: 1,
  },
  {
    id: 'saint-valentin',
    name: 'Saint Valentin',
    emoji: '💕',
    description: `Tenue romantique dîner en amoureux Saint Valentin, robe rouge bordeaux élégante sexy,
      lingerie fine dentelle française, nuisette satin, talons vertigineux, bijoux délicats,
      petite robe noire date night, ensemble raffiné couple chic parisien`,
    dateStart: '02-01',
    dateEnd: '02-14',
    priority: 1,
  },
  {
    id: 'fashion-week',
    name: 'Fashion Week',
    emoji: '📸',
    description: `Tenue Fashion Week street style parisien, pièces créateurs avant-garde,
      manteau oversize statement, accessoires iconiques, total look noir chic minimaliste,
      sneakers luxe boots, lunettes soleil designer, sac iconique Chanel Hermès Loewe`,
    dateStart: '02-20',
    dateEnd: '03-10',
    priority: 1,
  },
  {
    id: 'printemps-parisien',
    name: 'Printemps Parisien',
    emoji: '🌸',
    description: `Tenue printemps parisienne élégante fraîche, trench coat iconique beige camel,
      robe midi fleurie imprimé liberty, marinière breton, ballerines espadrilles,
      foulard soie Hermès, sac bandoulière cuir, couleurs pastel rose poudré bleu ciel`,
    dateStart: '03-15',
    dateEnd: '05-15',
    priority: 2,
  },
  {
    id: 'festival-season',
    name: 'Festival Season',
    emoji: '🎪',
    description: `Tenue festival musique été bohème chic, robe longue fluide, short vintage,
      kimono veste légère brodée, bottines western santiags, accessoires ethniques,
      lunettes soleil rétro, chapeau paille, sac osier, franges crochet macramé boho`,
    dateStart: '05-15',
    dateEnd: '07-15',
    priority: 2,
  },
  {
    id: 'mariage-season',
    name: 'Invitée Mariage',
    emoji: '💒',
    description: `Tenue invitée mariage cérémonie élégante, robe cocktail midi longue fluide,
      costume lin homme chic, chapeau bibi fascinator, chaussures habillées talons,
      pochette de soirée, couleurs pastel bleu marine rose poudré terracotta champêtre`,
    dateStart: '05-01',
    dateEnd: '09-30',
    priority: 2,
  },
  {
    id: 'cote-azur',
    name: 'Côte d\'Azur',
    emoji: '🏖️',
    description: `Tenue été Riviera française côte d'azur Saint Tropez, robe longue lin,
      maillot de bain une pièce élégant, caftan, espadrilles compensées, chapeau capeline,
      lunettes soleil oversize, panier osier, imprimé rayures marine blanc, style Jackie O`,
    dateStart: '06-15',
    dateEnd: '08-31',
    priority: 1,
  },
  {
    id: 'rentree-chic',
    name: 'Rentrée Chic',
    emoji: '🍂',
    description: `Tenue rentrée bureau travail smart casual chic, blazer oversize épaulé,
      pantalon taille haute, chemise soie, mocassins derbies cuir, sac cabas professionnel,
      couleurs neutres beige camel cognac noir marine, basiques luxe intemporels`,
    dateStart: '08-25',
    dateEnd: '09-30',
    priority: 1,
  },
  {
    id: 'automne-parisien',
    name: 'Automne Parisien',
    emoji: '🍁',
    description: `Tenue automne parisien élégant cocooning chic, pull cachemire col roulé,
      manteau long laine, écharpe oversize, bottines cuir talons, béret,
      couleurs chaudes camel rouille bordeaux kaki, style Left Bank intellectuel`,
    dateStart: '10-01',
    dateEnd: '11-30',
    priority: 1,
  },
  {
    id: 'soirees-fetes',
    name: 'Soirées de Fêtes',
    emoji: '✨',
    description: `Tenue fêtes Noël réveillon soirée élégante, robe velours satin noire,
      smoking femme, paillettes sequins discrets, bijoux or vintage, talons hauts,
      fourrure fausse étole, pochette strass, maquillage sophistiqué glamour parisien`,
    dateStart: '12-01',
    dateEnd: '12-31',
    priority: 1,
  },
  {
    id: 'hiver-chic',
    name: 'Grand Froid Chic',
    emoji: '❄️',
    description: `Tenue hiver grand froid élégant chaud, manteau long laine cachemire,
      pull irlandais torsades, bonnet cashmere, écharpe oversize, gants cuir,
      bottines fourrées, doudoune luxe, layering chic noir gris crème camel`,
    dateStart: '12-01',
    dateEnd: '02-28',
    priority: 2,
  },
  {
    id: 'ski-chic',
    name: 'Ski Chic',
    emoji: '⛷️',
    description: `Tenue ski montagne après-ski chic chalet, combinaison ski vintage,
      pull norvégien jacquard, moon boots, bonnet pompom, lunettes masque,
      doudoune luxe Moncler, style Courchevel Megève apres-ski glamour`,
    dateStart: '12-15',
    dateEnd: '03-15',
    priority: 3,
  },
];

// ============================================================
// FONCTIONS
// ============================================================

async function generateEmbedding(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('❌ Erreur génération embedding:', error.message);
    return null;
  }
}

async function createMoment(moment) {
  console.log(`\n🔄 "${moment.emoji} ${moment.name}"...`);

  // 1. Nettoyer la description
  const cleanDescription = moment.description.replace(/\s+/g, ' ').trim();

  // 2. Générer l'embedding
  process.stdout.write('   📊 Embedding...');
  const embedding = await generateEmbedding(cleanDescription);

  if (!embedding) {
    console.log(' ❌ Échec');
    return false;
  }

  console.log(` ✅ (${embedding.length}d)`);

  // 3. Sauvegarder dans Firestore
  const momentData = {
    id: moment.id,
    name: moment.name,
    emoji: moment.emoji,
    description: cleanDescription,
    embedding: embedding,
    dateRange: {
      start: moment.dateStart,
      end: moment.dateEnd,
    },
    priority: moment.priority,
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('moments').doc(moment.id).set(momentData);
  console.log(`   💾 Sauvegardé: ${moment.dateStart} → ${moment.dateEnd}`);

  return true;
}

async function previewMomentMatches(momentId, limit = 5) {
  console.log(`\n🔍 Preview articles pour "${momentId}"...`);

  const momentDoc = await db.collection('moments').doc(momentId).get();
  if (!momentDoc.exists) {
    console.log('   ❌ Moment non trouvé');
    return;
  }

  const momentEmbedding = momentDoc.data().embedding;

  const embeddingsSnapshot = await db.collection('embeddings')
    .where('isActive', '==', true)
    .where('isSold', '==', false)
    .limit(100)
    .get();

  if (embeddingsSnapshot.empty) {
    console.log('   ⚠️ Aucun article avec embedding trouvé');
    return;
  }

  const similarities = [];
  embeddingsSnapshot.docs.forEach(doc => {
    const articleEmbedding = doc.data().embedding;
    const score = cosineSimilarity(momentEmbedding, articleEmbedding);
    similarities.push({ articleId: doc.id, score });
  });

  similarities.sort((a, b) => b.score - a.score);
  const topMatches = similarities.slice(0, limit);

  console.log(`   📋 Top ${limit} articles:`);
  for (const match of topMatches) {
    const articleDoc = await db.collection('articles').doc(match.articleId).get();
    const article = articleDoc.data();
    console.log(`      - ${article?.title || 'Sans titre'} (${(match.score * 100).toFixed(1)}%)`);
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n✨ SECONDE - Seed Moments');
  console.log('================================');
  console.log(`📅 ${MOMENTS.length} moments à créer\n`);

  let success = 0;
  let failed = 0;

  for (const moment of MOMENTS) {
    const result = await createMoment(moment);
    if (result) {
      success++;
    } else {
      failed++;
    }

    // Délai pour éviter le rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n================================');
  console.log(`✅ Succès: ${success}/${MOMENTS.length}`);
  if (failed > 0) {
    console.log(`❌ Échecs: ${failed}/${MOMENTS.length}`);
  }

  // Preview pour un moment actuel
  if (success > 0) {
    const now = new Date();
    const month = now.getMonth() + 1;

    let previewMoment = 'rentree-chic';
    if (month >= 12 || month <= 2) previewMoment = 'hiver-chic';
    else if (month >= 3 && month <= 5) previewMoment = 'printemps-parisien';
    else if (month >= 6 && month <= 8) previewMoment = 'cote-azur';

    await previewMomentMatches(previewMoment, 5);
  }

  console.log('\n🎉 Terminé!');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
