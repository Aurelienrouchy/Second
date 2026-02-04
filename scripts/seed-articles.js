/**
 * Seed script: Populate Firestore with 100 realistic clothing articles
 * Articles look like real user listings (casual descriptions, varied quality)
 *
 * Usage: node scripts/seed-articles.js
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
// =============================================================================
// FIREBASE INIT
// =============================================================================

const SERVICE_ACCOUNT_PATHS = [
  path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'service-account.json'),
];

let serviceAccount = null;
for (const p of SERVICE_ACCOUNT_PATHS) {
  if (fs.existsSync(p)) {
    serviceAccount = require(p);
    console.log(`✅ Service account found: ${p}`);
    break;
  }
}

if (!serviceAccount) {
  console.error('❌ No service account key found. Checked:', SERVICE_ACCOUNT_PATHS);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// =============================================================================
// FAKE SELLERS (15 realistic French profiles)
// =============================================================================

const SELLERS = [
  { id: 'seller_marie_01', name: 'Marie L.', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_lucas_02', name: 'Lucas D.', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_camille_03', name: 'Camille R.', image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_thomas_04', name: 'Thomas B.', image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_lea_05', name: 'Léa M.', image: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_hugo_06', name: 'Hugo P.', image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_chloe_07', name: 'Chloé V.', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_antoine_08', name: 'Antoine G.', image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_emma_09', name: 'Emma S.', image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_jules_10', name: 'Jules F.', image: 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_ines_11', name: 'Inès K.', image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_nathan_12', name: 'Nathan C.', image: 'https://images.unsplash.com/photo-1463453091185-61582044d556?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_sarah_13', name: 'Sarah A.', image: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_maxime_14', name: 'Maxime T.', image: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&h=150&fit=crop&crop=face' },
  { id: 'seller_manon_15', name: 'Manon J.', image: 'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=150&h=150&fit=crop&crop=face' },
];

// =============================================================================
// CLOTHING IMAGES (curated Unsplash — real user-style photos)
// =============================================================================

const IMAGES = {
  // Women's clothing
  women_dress: [
    'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1612336307429-8a898d10e223?w=600&h=800&fit=crop',
  ],
  women_top: [
    'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1562572159-4efc207f5aff?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=600&h=800&fit=crop',
  ],
  women_jeans: [
    'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1582418702059-97ebafb35d09?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1604176354204-9268737828e4?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1475178626620-a4d074967571?w=600&h=800&fit=crop',
  ],
  women_jacket: [
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1548624313-0396c75e4b1a?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1520012218364-3dbe62c99bee?w=600&h=800&fit=crop',
  ],
  women_skirt: [
    'https://images.unsplash.com/photo-1583496661160-fb5886a0afe0?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1577900232427-18219b9166a0?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1592301933927-35b597393c0a?w=600&h=800&fit=crop',
  ],
  women_shoes: [
    'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1518049362265-d5b2a6467637?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1603808033192-082d6919d3e1?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=600&h=800&fit=crop',
  ],
  women_bag: [
    'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&h=800&fit=crop',
  ],
  women_sweater: [
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1434389677669-e08b4cda3a27?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=600&h=800&fit=crop',
  ],
  // Men's clothing
  men_shirt: [
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1589310243389-96a5483213a8?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1603252109303-2751441dd157?w=600&h=800&fit=crop',
  ],
  men_tshirt: [
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=600&h=800&fit=crop',
  ],
  men_jeans: [
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1555689502-c4b22d76c56f?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1604176354204-9268737828e4?w=600&h=800&fit=crop',
  ],
  men_jacket: [
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1495105787522-5334e3ffa0ef?w=600&h=800&fit=crop',
  ],
  men_shoes: [
    'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&h=800&fit=crop',
  ],
  men_hoodie: [
    'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1578768079470-0a4536cc5fa9?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1620799140188-3b2a02fd9a77?w=600&h=800&fit=crop',
  ],
  // Kids
  kids: [
    'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1543854589-fdd4d3a0d181?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600&h=800&fit=crop',
  ],
  // Accessories
  accessories: [
    'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1509941943102-10c232fc06c4?w=600&h=800&fit=crop',
    'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=600&h=800&fit=crop',
  ],
};

// =============================================================================
// BRANDS
// =============================================================================

const BRANDS = {
  women_premium: ['Sézane', 'Maje', 'Sandro', 'Isabel Marant', 'Zadig & Voltaire', 'Ba&sh', 'Claudie Pierlot'],
  women_mid: ['Zara', 'Mango', 'H&M', 'Monki', 'COS', '& Other Stories', 'Arket'],
  women_fast: ['Shein', 'Pull & Bear', 'Bershka', 'Stradivarius', 'Primark'],
  men_premium: ['APC', 'Ami Paris', 'Maison Kitsuné', 'Acne Studios', 'Norse Projects'],
  men_mid: ['Zara', 'COS', 'Uniqlo', 'Carhartt WIP', 'Dickies'],
  men_street: ['Nike', 'Adidas', 'New Balance', 'Stüssy', 'Supreme', 'The North Face'],
  kids: ['Petit Bateau', 'Jacadi', 'Du Pareil au Même', 'Kiabi', 'Zara Kids', 'H&M Kids'],
};

// =============================================================================
// CONDITIONS & SIZES
// =============================================================================

const CONDITIONS = ['neuf', 'très bon état', 'bon état', 'satisfaisant'];
const CONDITION_WEIGHTS = [0.1, 0.35, 0.4, 0.15]; // probability weights

const SIZES = {
  women_clothing: ['XS', 'S', 'M', 'L', 'XL'],
  women_shoes: ['36', '37', '38', '39', '40', '41'],
  men_clothing: ['S', 'M', 'L', 'XL', 'XXL'],
  men_shoes: ['40', '41', '42', '43', '44', '45'],
  kids: ['2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans', '10 ans', '12 ans'],
};

const COLORS = ['Noir', 'Blanc', 'Bleu', 'Rouge', 'Vert', 'Beige', 'Gris', 'Rose', 'Marron', 'Bleu marine', 'Bordeaux', 'Camel', 'Kaki'];
const MATERIALS = ['Coton', 'Polyester', 'Lin', 'Laine', 'Soie', 'Denim', 'Cuir', 'Synthétique', 'Viscose', 'Cachemire'];

// =============================================================================
// ARTICLE DEFINITIONS (100 articles)
// =============================================================================

const ARTICLES = [
  // ---- WOMEN'S DRESSES (10) ----
  {
    title: 'Robe fleurie été',
    description: 'Jolie robe à fleurs portée 2-3 fois cet été. Taille bien, tissu léger et agréable. Je la vends car je fais du tri dans mon dressing !',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_dress', price: [15, 35], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Rose', 'Blanc'],
  },
  {
    title: 'Robe noire Sézane',
    description: 'Petite robe noire Sézane modèle Éléonore. Portée quelques fois pour des soirées. Parfait état, je m\'en sépare à regret mais elle ne me va plus.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_mini'],
    imageKey: 'women_dress', price: [45, 80], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Noir'],
  },
  {
    title: 'Robe longue bohème',
    description: 'Robe longue style bohème, super pour l\'été ou un festival. Tissu fluide qui tombe bien. Vendue car j\'ai trop de robes 😅',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_long'],
    imageKey: 'women_dress', price: [18, 30], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Beige', 'Blanc'],
  },
  {
    title: 'Robe pull hiver',
    description: 'Robe pull bien chaude pour l\'hiver, col roulé. Laine douce, pas du tout qui gratte. Couleur camel qui va avec tout.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_sweater', price: [20, 40], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Camel', 'Beige'],
  },
  {
    title: 'Petite robe Mango',
    description: 'Robe Mango de la collection printemps. Coupe droite, tissu un peu épais donc niquel pour la mi-saison. Portée 1 fois.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_mini'],
    imageKey: 'women_dress', price: [12, 25], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu', 'Vert'],
  },
  {
    title: 'Robe de soirée satinée',
    description: 'Robe satinée parfaite pour une soirée ou un mariage. Achetée pour un événement, pas eu l\'occasion de la remettre depuis.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_dress', price: [25, 55], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Bordeaux', 'Noir'],
  },
  {
    title: 'Robe chemise rayée',
    description: 'Robe chemise à rayures, style casual chic. Se porte ceinturée ou loose. Coton très agréable. Petit accroc réparé au niveau de l\'ourlet (quasi invisible).',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_dress', price: [10, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Blanc', 'Bleu'],
  },
  {
    title: 'Robe en jean Levi\'s',
    description: 'Robe en denim Levi\'s, modèle classique avec boutons devant. Style vintage qui va avec tout. Taille normalement.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_jeans', price: [30, 50], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu'],
    brandOverride: "Levi's",
  },
  {
    title: 'Robe moulante côtelée',
    description: 'Petite robe moulante en maille côtelée. Hyper confortable, je la mettais tout le temps. Couleur grise passe-partout.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_mini'],
    imageKey: 'women_dress', price: [8, 15], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Gris'],
  },
  {
    title: 'Robe Sandro imprimée',
    description: 'Magnifique robe Sandro avec imprimé graphique. Doublée, fermeture éclair dos. Portée 3 fois max. Prix neuf 250€.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_dress', price: [60, 95], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Noir', 'Blanc'],
    brandOverride: 'Sandro',
  },

  // ---- WOMEN'S TOPS (10) ----
  {
    title: 'T-shirt blanc basique',
    description: 'Bon basique blanc en coton bio. Coupe droite, ni trop large ni trop serré. Je le vends car j\'en ai acheté un autre depuis.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    imageKey: 'women_top', price: [5, 12], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Blanc'],
  },
  {
    title: 'Blouse Sézane fleurie',
    description: 'Blouse Sézane modèle Boris à fleurs. Col V, manches longues. Sublime mais ne me va plus depuis ma grossesse. État impeccable.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_blouses'],
    imageKey: 'women_top', price: [35, 60], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Rose', 'Blanc'],
    brandOverride: 'Sézane',
  },
  {
    title: 'Crop top noir',
    description: 'Crop top noir tout simple, parfait pour l\'été avec un jean taille haute. Taille un peu petit, je mets du S normalement et là c\'est juste.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    imageKey: 'women_top', price: [5, 10], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Noir'],
  },
  {
    title: 'Chemise en lin',
    description: 'Chemise oversize en lin, parfaite pour la plage ou en ville. Tissu qui se froisse un peu (c\'est le lin...) mais c\'est le charme. Couleur beige clair.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_blouses'],
    imageKey: 'women_top', price: [15, 30], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Beige'],
    material: 'Lin',
  },
  {
    title: 'Top à bretelles COS',
    description: 'Top COS à fines bretelles, matière fluide. Parfait pour les soirées d\'été. Aucun défaut.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    imageKey: 'women_top', price: [15, 25], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir', 'Blanc'],
    brandOverride: 'COS',
  },
  {
    title: 'Marinière Saint James',
    description: 'La vraie marinière Saint James ! Coton épais, rayures bleu marine/blanc. Indémodable. Je l\'ai depuis 3 ans mais elle est encore en super état.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    imageKey: 'women_top', price: [25, 45], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu marine', 'Blanc'],
    brandOverride: 'Saint James',
  },
  {
    title: 'Body dentelle Zara',
    description: 'Body en dentelle Zara, hyper joli sous une veste. Couleur noire. La dentelle est en bon état, pas de fils tirés.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_bodysuits'],
    imageKey: 'women_top', price: [8, 18], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Zara',
  },
  {
    title: 'Pull col V cachemire',
    description: 'Pull 100% cachemire, col V. Doux et chaud. Petite bouloche sous les bras mais sinon très bien. Couleur gris chiné.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters'],
    imageKey: 'women_sweater', price: [30, 60], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Gris'],
    material: 'Cachemire',
  },
  {
    title: 'Sweat à capuche Nike',
    description: 'Hoodie Nike oversize, très confortable pour le sport ou en mode chill. Logo brodé. Couleur grise.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters'],
    imageKey: 'men_hoodie', price: [18, 35], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Gris'],
    brandOverride: 'Nike',
  },
  {
    title: 'Gilet en maille &OS',
    description: 'Gilet & Other Stories en grosse maille torsadée. Couleur crème, taille M mais se porte oversized. Boutons dorés.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters'],
    imageKey: 'women_sweater', price: [20, 38], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Blanc', 'Beige'],
    brandOverride: '& Other Stories',
  },

  // ---- WOMEN'S PANTS (8) ----
  {
    title: 'Jean Levi\'s 501 vintage',
    description: 'Jean Levi\'s 501 vintage des années 90, taille haute. Couleur medium wash. Un peu usé aux genoux mais c\'est le style ! Taille W27.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_jeans'],
    imageKey: 'women_jeans', price: [25, 50], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu'],
    brandOverride: "Levi's",
  },
  {
    title: 'Pantalon large beige',
    description: 'Pantalon palazzo beige, taille élastiquée derrière. Hyper confortable et tendance. Se porte avec un crop top ou un body.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_wide'],
    imageKey: 'women_jeans', price: [12, 25], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Beige'],
  },
  {
    title: 'Jean skinny noir',
    description: 'Jean skinny noir Zara, basique indispensable. Stretch confortable. Un peu délavé au niveau des cuisses à force de lavages.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_jeans'],
    imageKey: 'women_jeans', price: [8, 15], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Zara',
  },
  {
    title: 'Pantalon cargo kaki',
    description: 'Pantalon cargo avec poches sur les côtés. Style streetwear, tissu épais. Taille bien, je le vendais à regret mais il me va plus.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_cargo'],
    imageKey: 'women_jeans', price: [15, 28], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Kaki'],
  },
  {
    title: 'Pantalon cigarette Mango',
    description: 'Pantalon cigarette Mango, coupe parfaite pour le bureau. Plis devant, tissu fluide. Noir classique.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_straight'],
    imageKey: 'women_jeans', price: [12, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Mango',
  },
  {
    title: 'Short en jean',
    description: 'Short en jean taille haute, bords effilochés. Idéal pour l\'été ! Quelques taches de javel volontaires pour le style.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_shorts'],
    imageKey: 'women_jeans', price: [8, 16], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Bleu'],
  },
  {
    title: 'Legging sport Adidas',
    description: 'Legging de sport Adidas, matière technique qui sèche vite. Bande logo sur le côté. Taille haute, maintien top.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_leggings'],
    imageKey: 'women_jeans', price: [12, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Adidas',
  },
  {
    title: 'Jogging velours côtelé',
    description: 'Pantalon jogging en velours côtelé, coupe droite. Ultra doux et confortable. Parfait pour traîner ou sortir en mode casual.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_pants', 'women_clothing_pants_joggers'],
    imageKey: 'women_jeans', price: [10, 20], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Marron', 'Beige'],
  },

  // ---- WOMEN'S JACKETS (6) ----
  {
    title: 'Veste en jean oversize',
    description: 'Veste en jean oversize, lavage clair. J\'ai customisé avec des pins mais je les enlèverai avant envoi si vous voulez. Taille L mais se porte sur tout.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_denim'],
    imageKey: 'women_jacket', price: [18, 35], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu'],
  },
  {
    title: 'Blazer noir Maje',
    description: 'Blazer Maje coupe ajustée, tissu grain de poudre. Doublé, 2 poches devant. Intemporel. Acheté 350€, porté une dizaine de fois.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_blazers'],
    imageKey: 'women_jacket', price: [55, 100], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Maje',
  },
  {
    title: 'Perfecto cuir Ba&sh',
    description: 'Perfecto en vrai cuir d\'agneau Ba&sh. Souple, pas rigide du tout. Quelques marques d\'usure sur les coudes qui lui donnent du cachet.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_leather'],
    imageKey: 'women_jacket', price: [80, 150], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Ba&sh', material: 'Cuir',
  },
  {
    title: 'Doudoune légère',
    description: 'Doudoune fine et légère, se plie facilement dans un sac. Parfaite pour la mi-saison. Couleur bleu marine.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_puffer'],
    imageKey: 'women_jacket', price: [15, 30], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu marine'],
  },
  {
    title: 'Trench beige classique',
    description: 'Trench coat beige, coupe classique ceinturée. Le genre de pièce qui va avec tout. Petit défaut : une tache minuscule à l\'intérieur de la manche.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_trench'],
    imageKey: 'women_jacket', price: [25, 50], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Beige'],
  },
  {
    title: 'Manteau laine Sandro',
    description: 'Manteau droit en laine mélangée Sandro. Couleur gris, coupe droite qui arrive aux genoux. Très classe.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_coats', 'women_clothing_coats_wool'],
    imageKey: 'women_jacket', price: [70, 120], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Gris'],
    brandOverride: 'Sandro', material: 'Laine',
  },

  // ---- WOMEN'S SKIRTS (4) ----
  {
    title: 'Jupe plissée midi',
    description: 'Jupe plissée longueur midi, tissu satiné. Taille élastiquée donc assez flexible. Couleur vert bouteille magnifique.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_skirts', 'women_clothing_skirts_midi'],
    imageKey: 'women_skirt', price: [12, 25], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Vert'],
  },
  {
    title: 'Mini jupe en cuir',
    description: 'Mini jupe en similicuir noir. Style rock. Fermeture éclair sur le côté. Comme neuve, portée 2 fois.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_skirts', 'women_clothing_skirts_mini'],
    imageKey: 'women_skirt', price: [10, 20], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Noir'],
  },
  {
    title: 'Jupe en jean A-line',
    description: 'Jupe en jean coupe trapèze (A-line), longueur genou. Classique indémodable. Légère décoloration au niveau de la taille.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_skirts', 'women_clothing_skirts_midi'],
    imageKey: 'women_skirt', price: [10, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Bleu'],
  },
  {
    title: 'Jupe longue fleurie',
    description: 'Jupe longue fleurie, tissu léger qui bouge bien. Top avec un t-shirt blanc et des sandales. Ceinture pas incluse.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_skirts', 'women_clothing_skirts_long'],
    imageKey: 'women_skirt', price: [12, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Rose', 'Blanc'],
  },

  // ---- WOMEN'S SHOES (6) ----
  {
    title: 'Baskets Nike Air Force 1',
    description: 'Nike AF1 blanches, portées quelques mois. Semelles un peu sales mais un coup de nettoyant et c\'est bon. Taille 38.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_sneakers'],
    imageKey: 'women_shoes', price: [35, 60], brandPool: 'women_mid', sizePool: 'women_shoes', colors: ['Blanc'],
    brandOverride: 'Nike',
  },
  {
    title: 'Bottines chelsea cuir',
    description: 'Bottines chelsea en cuir noir, semelle épaisse. Style un peu Dr. Martens mais en moins cher. Portées un hiver, encore en bon état.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_boots'],
    imageKey: 'women_shoes', price: [25, 45], brandPool: 'women_mid', sizePool: 'women_shoes', colors: ['Noir'],
    material: 'Cuir',
  },
  {
    title: 'Escarpins Sandro noirs',
    description: 'Escarpins Sandro en daim noir, talon 7cm. Élégants et pas trop hauts. Semelle intérieure un peu usée mais extérieur impeccable.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_heels'],
    imageKey: 'women_shoes', price: [30, 55], brandPool: 'women_premium', sizePool: 'women_shoes', colors: ['Noir'],
    brandOverride: 'Sandro',
  },
  {
    title: 'Sandales été dorées',
    description: 'Sandales plates dorées, style gladiateur. Parfaites pour l\'été. Quelques rayures sur les lanières mais rien de grave.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_sandals'],
    imageKey: 'women_shoes', price: [8, 18], brandPool: 'women_fast', sizePool: 'women_shoes', colors: ['Beige'],
  },
  {
    title: 'Mocassins Jonak',
    description: 'Mocassins Jonak en cuir lisse noir. Confortables dès le premier jour. Portés au bureau pendant 6 mois.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_flats'],
    imageKey: 'women_shoes', price: [25, 45], brandPool: 'women_mid', sizePool: 'women_shoes', colors: ['Noir'],
    brandOverride: 'Jonak', material: 'Cuir',
  },
  {
    title: 'New Balance 550 blanc/vert',
    description: 'NB 550 coloris blanc et vert. Portées mais bien entretenues. Lacets d\'origine. Taille 39 mais taillent un peu grand.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_sneakers'],
    imageKey: 'women_shoes', price: [45, 75], brandPool: 'women_mid', sizePool: 'women_shoes', colors: ['Blanc', 'Vert'],
    brandOverride: 'New Balance',
  },

  // ---- WOMEN'S BAGS (4) ----
  {
    title: 'Sac à main Mango',
    description: 'Sac Mango en simili cuir noir, bandoulière amovible. Format moyen, parfait pour la journée. Intérieur propre.',
    categoryIds: ['women', 'women_bags', 'women_bags_handbags'],
    imageKey: 'women_bag', price: [12, 25], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Mango',
  },
  {
    title: 'Tote bag en toile',
    description: 'Grand tote bag en toile épaisse, parfait pour les cours ou le shopping. Poches intérieures. Lavable en machine.',
    categoryIds: ['women', 'women_bags', 'women_bags_tote'],
    imageKey: 'women_bag', price: [8, 15], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Beige'],
  },
  {
    title: 'Sac bandoulière cuir',
    description: 'Petit sac bandoulière en vrai cuir, format compact mais contient l\'essentiel (tel + portefeuille + clés). Couleur camel.',
    categoryIds: ['women', 'women_bags', 'women_bags_crossbody'],
    imageKey: 'women_bag', price: [20, 40], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Camel'],
    material: 'Cuir',
  },
  {
    title: 'Sac à dos Eastpak',
    description: 'Sac à dos Eastpak noir classique. Utilisé pour la fac, il est solide. Fermeture éclair fonctionne nickel.',
    categoryIds: ['women', 'women_bags', 'women_bags_backpacks'],
    imageKey: 'women_bag', price: [15, 30], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Eastpak',
  },

  // ---- WOMEN'S ACCESSORIES (4) ----
  {
    title: 'Écharpe en laine',
    description: 'Grande écharpe en laine grise, bien chaude pour l\'hiver. Pas de trous ni de bouloches. Je la vends car j\'en ai reçu une nouvelle.',
    categoryIds: ['women', 'women_accessories', 'women_accessories_scarves'],
    imageKey: 'accessories', price: [8, 18], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Gris'],
    material: 'Laine',
  },
  {
    title: 'Ceinture cuir marron',
    description: 'Ceinture en cuir véritable, boucle dorée. Largeur 3cm. Quelques marques d\'usure normales sur le cuir.',
    categoryIds: ['women', 'women_accessories', 'women_accessories_belts'],
    imageKey: 'accessories', price: [8, 15], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Marron'],
    material: 'Cuir',
  },
  {
    title: 'Montre Daniel Wellington',
    description: 'Montre DW bracelet cuir marron, cadran blanc. Pile à changer mais sinon en parfait état. Boîte d\'origine incluse.',
    categoryIds: ['women', 'women_accessories', 'women_accessories_jewelry'],
    imageKey: 'accessories', price: [30, 55], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Marron'],
    brandOverride: 'Daniel Wellington',
  },
  {
    title: 'Casquette New Era',
    description: 'Casquette New Era noire, modèle 59FIFTY. Taille ajustable. Portée quelques fois, pas de taches.',
    categoryIds: ['women', 'women_accessories', 'women_accessories_hats'],
    imageKey: 'accessories', price: [10, 22], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'New Era',
  },

  // ---- MEN'S T-SHIRTS & TOPS (8) ----
  {
    title: 'T-shirt Stüssy logo',
    description: 'Tee Stüssy blanc avec le logo classique. Coton épais, coupe regular. Pas de jaunissement au col. Taille M.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_tshirts'],
    imageKey: 'men_tshirt', price: [15, 30], brandPool: 'men_street', sizePool: 'men_clothing', colors: ['Blanc'],
    brandOverride: 'Stüssy',
  },
  {
    title: 'Polo Ralph Lauren',
    description: 'Polo Ralph Lauren bleu marine, petit logo brodé. Coupe slim fit. Porté pour le taf, en bon état. Quelques lavages mais couleur toujours bien.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_tshirts'],
    imageKey: 'men_shirt', price: [18, 35], brandPool: 'men_premium', sizePool: 'men_clothing', colors: ['Bleu marine'],
    brandOverride: 'Ralph Lauren',
  },
  {
    title: 'T-shirt graphique',
    description: 'T-shirt avec print graphique vintage. Acheté dans une friperie, il a ce style un peu washed qui est cool. Coton léger.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_tshirts'],
    imageKey: 'men_tshirt', price: [8, 15], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Noir', 'Gris'],
  },
  {
    title: 'Chemise oxford bleue',
    description: 'Chemise oxford Uniqlo bleu clair, coton brossé. Le basique parfait pour le bureau ou le weekend. Col boutonné.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_shirts'],
    imageKey: 'men_shirt', price: [10, 20], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu'],
    brandOverride: 'Uniqlo',
  },
  {
    title: 'Chemise à carreaux',
    description: 'Chemise flanelle à carreaux rouge/noir. Bien épaisse pour l\'hiver. Style bucheron assumé. Taille L mais coupe ample.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_shirts'],
    imageKey: 'men_shirt', price: [12, 22], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Rouge', 'Noir'],
  },
  {
    title: 'Hoodie Nike Tech Fleece',
    description: 'Hoodie Nike Tech Fleece gris, avec la fermeture asymétrique. Ultra confortable, tissu tech. Porté 1 saison.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_sweaters'],
    imageKey: 'men_hoodie', price: [35, 55], brandPool: 'men_street', sizePool: 'men_clothing', colors: ['Gris'],
    brandOverride: 'Nike',
  },
  {
    title: 'Pull col roulé COS',
    description: 'Pull col roulé COS en laine mérinos, noir. Coupe ajustée. Quelques bouloches mais rien de visible de loin.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_sweaters'],
    imageKey: 'men_shirt', price: [20, 40], brandPool: 'men_premium', sizePool: 'men_clothing', colors: ['Noir'],
    brandOverride: 'COS', material: 'Laine',
  },
  {
    title: 'Sweat Carhartt WIP',
    description: 'Sweat Carhartt WIP Chase, le classique. Coton brossé à l\'intérieur. Logo brodé poitrine. Couleur bordeaux.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_sweaters'],
    imageKey: 'men_hoodie', price: [25, 45], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bordeaux'],
    brandOverride: 'Carhartt WIP',
  },

  // ---- MEN'S PANTS (6) ----
  {
    title: 'Jean slim noir',
    description: 'Jean noir slim Zara Man. Basique indispensable. Stretch confortable. Petite usure entre les cuisses mais sinon nickel.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_jeans'],
    imageKey: 'men_jeans', price: [10, 20], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Noir'],
    brandOverride: 'Zara',
  },
  {
    title: 'Chino beige Dockers',
    description: 'Chino Dockers beige, coupe droite classique. Pli central. Parfait pour le bureau ou un style smart casual.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_chinos'],
    imageKey: 'men_jeans', price: [15, 30], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Beige'],
    brandOverride: 'Dockers',
  },
  {
    title: 'Jogging Adidas 3 bandes',
    description: 'Pantalon de jogging Adidas, les 3 bandes sur les côtés. Noir, taille élastique + cordon. Confort ++.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_joggers'],
    imageKey: 'men_jeans', price: [12, 25], brandPool: 'men_street', sizePool: 'men_clothing', colors: ['Noir'],
    brandOverride: 'Adidas',
  },
  {
    title: 'Jean droit Levi\'s 505',
    description: 'Jean Levi\'s 505 coupe droite, lavage medium. Le classique. W32/L32. Bien tenu malgré les années.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_jeans'],
    imageKey: 'men_jeans', price: [20, 40], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu'],
    brandOverride: "Levi's",
  },
  {
    title: 'Pantalon cargo Dickies',
    description: 'Cargo Dickies 874, coupe droite. Workwear vibes. Tissu épais et résistant. Couleur kaki. Taille un peu grand.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_cargo'],
    imageKey: 'men_jeans', price: [20, 35], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Kaki'],
    brandOverride: 'Dickies',
  },
  {
    title: 'Short en lin',
    description: 'Short en lin bleu marine, taille élastique. Léger et respirant pour l\'été. Quelques faux plis (c\'est du lin !).',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_shorts'],
    imageKey: 'men_jeans', price: [10, 20], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu marine'],
    material: 'Lin',
  },

  // ---- MEN'S JACKETS (6) ----
  {
    title: 'Bomber kaki',
    description: 'Bomber réversible kaki/noir. Style MA-1. Tissu satiné d\'un côté, mat de l\'autre. Porté 2 hivers, encore en forme.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_bomber'],
    imageKey: 'men_jacket', price: [20, 40], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Kaki'],
  },
  {
    title: 'Veste en jean Levi\'s',
    description: 'Veste en jean Levi\'s Trucker Jacket, le classique. Lavage medium, coupe ajustée. Taille M. En très bon état.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_denim'],
    imageKey: 'men_jacket', price: [30, 50], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu'],
    brandOverride: "Levi's",
  },
  {
    title: 'Doudoune The North Face',
    description: 'Doudoune TNF Nuptse noire, modèle 700. La doudoune la plus chaude que j\'ai eue. Quelques micro-trous mais pas de plumes qui sortent.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_puffer'],
    imageKey: 'men_jacket', price: [80, 140], brandPool: 'men_street', sizePool: 'men_clothing', colors: ['Noir'],
    brandOverride: 'The North Face',
  },
  {
    title: 'Blazer APC navy',
    description: 'Blazer A.P.C. bleu marine en laine. Coupe semi-ajustée, 2 boutons. Doublure intérieure en bon état. Classy.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_blazers'],
    imageKey: 'men_jacket', price: [60, 100], brandPool: 'men_premium', sizePool: 'men_clothing', colors: ['Bleu marine'],
    brandOverride: 'APC', material: 'Laine',
  },
  {
    title: 'Veste surchemise Carhartt',
    description: 'Surchemise Carhartt WIP Michigan, coton lourd. Le genre de veste de mi-saison qu\'on met par-dessus tout. Couleur hamilton brown.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_shirt_jacket'],
    imageKey: 'men_jacket', price: [40, 65], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Marron'],
    brandOverride: 'Carhartt WIP',
  },
  {
    title: 'Parka longue imperméable',
    description: 'Parka longue avec capuche, imperméable. Pratique pour les jours de pluie. Doublure polaire amovible. Taille un peu grand.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_parka'],
    imageKey: 'men_jacket', price: [25, 45], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Noir', 'Bleu marine'],
  },

  // ---- MEN'S SHOES (6) ----
  {
    title: 'Nike Air Max 90',
    description: 'Air Max 90 infrared, coloris classique. Portées régulièrement mais bien entretenues. Semelle encore bonne. Pointure 43.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_sneakers'],
    imageKey: 'men_shoes', price: [40, 70], brandPool: 'men_street', sizePool: 'men_shoes', colors: ['Blanc', 'Rouge'],
    brandOverride: 'Nike',
  },
  {
    title: 'Adidas Samba OG',
    description: 'Adidas Samba OG noir/blanc. Le retour en force de la Samba ! Portées 3 mois, encore en super état. Taille 42.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_sneakers'],
    imageKey: 'men_shoes', price: [50, 80], brandPool: 'men_street', sizePool: 'men_shoes', colors: ['Noir', 'Blanc'],
    brandOverride: 'Adidas',
  },
  {
    title: 'Boots Dr. Martens 1460',
    description: 'Dr. Martens 1460 noires, 8 œillets. Cuir déjà assoupli (plus besoin de les casser !). Semelle qui a encore de la vie.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_boots'],
    imageKey: 'men_shoes', price: [50, 85], brandPool: 'men_mid', sizePool: 'men_shoes', colors: ['Noir'],
    brandOverride: 'Dr. Martens', material: 'Cuir',
  },
  {
    title: 'Mocassins cuir Sebago',
    description: 'Mocassins Sebago, cuir marron. Style preppy, parfaits sans chaussettes l\'été. Semelle en bon état.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_loafers'],
    imageKey: 'men_shoes', price: [30, 50], brandPool: 'men_mid', sizePool: 'men_shoes', colors: ['Marron'],
    brandOverride: 'Sebago', material: 'Cuir',
  },
  {
    title: 'New Balance 990v5',
    description: 'NB 990v5 gris, le modèle dad shoes par excellence. Made in USA. Confort de dingue. Taille 44, taillent normalement.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_sneakers'],
    imageKey: 'men_shoes', price: [70, 110], brandPool: 'men_street', sizePool: 'men_shoes', colors: ['Gris'],
    brandOverride: 'New Balance',
  },
  {
    title: 'Vans Old Skool',
    description: 'Vans Old Skool noires classiques. Un peu usées au bout des pieds (le skate...) mais restent stylées. Taille 42.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_sneakers'],
    imageKey: 'men_shoes', price: [15, 30], brandPool: 'men_street', sizePool: 'men_shoes', colors: ['Noir'],
    brandOverride: 'Vans',
  },

  // ---- KIDS (12) ----
  {
    title: 'Ensemble body bébé',
    description: 'Lot de 3 bodys bébé Petit Bateau. Coton doux, boutons pression. Taille 12 mois. Bon état, quelques taches de lait lavées.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_clothing'],
    imageKey: 'kids', price: [8, 15], brandPool: 'kids', sizePool: 'kids', colors: ['Blanc', 'Rose'],
    brandOverride: 'Petit Bateau',
  },
  {
    title: 'Doudoune enfant Zara',
    description: 'Doudoune Zara Kids, couleur bleu marine. Bien chaude, capuche amovible. Taille 4 ans. Mon fils a grandi trop vite !',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [12, 22], brandPool: 'kids', sizePool: 'kids', colors: ['Bleu marine'],
    brandOverride: 'Zara Kids',
  },
  {
    title: 'Robe fleurie fille',
    description: 'Petite robe à fleurs pour fille, taille 6 ans. Tissu coton, doublée. Portée pour un anniversaire et c\'est tout. Comme neuve.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_clothing'],
    imageKey: 'kids', price: [8, 15], brandPool: 'kids', sizePool: 'kids', colors: ['Rose', 'Blanc'],
  },
  {
    title: 'Jean enfant slim',
    description: 'Jean slim pour garçon, taille 8 ans. Coupe ajustée avec taille élastique. Genoux un peu usés (normal pour un enfant !).',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [5, 12], brandPool: 'kids', sizePool: 'kids', colors: ['Bleu'],
  },
  {
    title: 'T-shirt dinosaure',
    description: 'T-shirt avec un tyrannosaure en paillettes réversibles ! Mon fils adorait. Taille 5 ans, coton. Couleur verte.',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [4, 8], brandPool: 'kids', sizePool: 'kids', colors: ['Vert'],
  },
  {
    title: 'Baskets enfant Nike',
    description: 'Nike enfant taille 30, à scratch (facile à mettre). Blanches et roses. Portées quelques mois, propres.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_shoes'],
    imageKey: 'kids', price: [10, 20], brandPool: 'kids', sizePool: 'kids', colors: ['Blanc', 'Rose'],
    brandOverride: 'Nike',
  },
  {
    title: 'Manteau laine fille',
    description: 'Joli manteau en laine mélangée pour fille, taille 10 ans. Couleur camel avec boutons dorés. Style chic. Jacadi.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_clothing'],
    imageKey: 'kids', price: [20, 35], brandPool: 'kids', sizePool: 'kids', colors: ['Camel'],
    brandOverride: 'Jacadi',
  },
  {
    title: 'Pyjama coton bio',
    description: 'Pyjama 2 pièces en coton bio, imprimé étoiles. Taille 3 ans. Doux et confortable. Petit accroc cousu à la manche.',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [5, 10], brandPool: 'kids', sizePool: 'kids', colors: ['Bleu', 'Blanc'],
  },
  {
    title: 'Combinaison bébé hiver',
    description: 'Combinaison pilote bébé, taille 6 mois. Bien chaude, doublée polaire. Idéale pour la poussette. Utilisée 1 hiver.',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [10, 18], brandPool: 'kids', sizePool: 'kids', colors: ['Gris', 'Bleu'],
  },
  {
    title: 'Lot t-shirts fille',
    description: 'Lot de 4 t-shirts pour fille, taille 8 ans. Couleurs variées (rose, blanc, jaune, vert). Coton basique H&M Kids.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_clothing'],
    imageKey: 'kids', price: [6, 12], brandPool: 'kids', sizePool: 'kids', colors: ['Rose', 'Blanc'],
    brandOverride: 'H&M Kids',
  },
  {
    title: 'Salopette en jean fille',
    description: 'Salopette en jean pour fille, taille 5 ans. Coupe droite, boutons à clipser. Style trop mignon. Bershka Kids.',
    categoryIds: ['kids', 'kids_girls', 'kids_girls_clothing'],
    imageKey: 'kids', price: [8, 15], brandPool: 'kids', sizePool: 'kids', colors: ['Bleu'],
  },
  {
    title: 'Pull marin Petit Bateau',
    description: 'Pull marinière Petit Bateau, taille 4 ans. Le classique avec les rayures bleu/blanc. Coton épais, dure longtemps.',
    categoryIds: ['kids', 'kids_boys', 'kids_boys_clothing'],
    imageKey: 'kids', price: [8, 16], brandPool: 'kids', sizePool: 'kids', colors: ['Bleu marine', 'Blanc'],
    brandOverride: 'Petit Bateau',
  },

  // ---- EXTRA (10 more to reach 100) ----
  {
    title: 'Combinaison pantalon noire',
    description: 'Combi pantalon noire, col en V, manches courtes. Hyper pratique : une seule pièce et t\'es habillée ! Taille S/M.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_jumpsuits'],
    imageKey: 'women_dress', price: [15, 28], brandPool: 'women_mid', sizePool: 'women_clothing', colors: ['Noir'],
  },
  {
    title: 'Veste teddy vintage',
    description: 'Teddy jacket style américain, manches en simili cuir. Trouvé en friperie, look 90s garanti. Taille L oversize.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_coats', 'men_clothing_coats_bomber'],
    imageKey: 'men_jacket', price: [25, 45], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Noir', 'Blanc'],
  },
  {
    title: 'Robe Zadig & Voltaire',
    description: 'Robe Z&V en soie imprimée. Modèle Ristyl. Fluide, se porte jour comme nuit. Prix neuf 395€. État quasi neuf.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_dresses', 'women_clothing_dresses_midi'],
    imageKey: 'women_dress', price: [85, 140], brandPool: 'women_premium', sizePool: 'women_clothing', colors: ['Noir'],
    brandOverride: 'Zadig & Voltaire', material: 'Soie',
  },
  {
    title: 'Bermuda chino',
    description: 'Bermuda chino bleu clair, longueur genou. COS. Coton léger, parfait pour l\'été. Ceinture pas incluse.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_pants', 'men_clothing_pants_shorts'],
    imageKey: 'men_jeans', price: [10, 20], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu'],
    brandOverride: 'COS',
  },
  {
    title: 'Débardeur sport femme',
    description: 'Débardeur de sport brassière intégrée. Maintien léger, parfait pour le yoga ou la course. Couleur vieux rose.',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    imageKey: 'women_top', price: [8, 15], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Rose'],
  },
  {
    title: 'Chemise hawaïenne',
    description: 'Chemise hawaïenne motif tropical. Achetée pour une soirée à thème, portée 2 fois. Coupe relaxed. Tissu léger et fluide.',
    categoryIds: ['men', 'men_clothing', 'men_clothing_shirts'],
    imageKey: 'men_shirt', price: [8, 18], brandPool: 'men_mid', sizePool: 'men_clothing', colors: ['Bleu', 'Vert'],
  },
  {
    title: 'Chapeau de paille',
    description: 'Chapeau de paille style fedora. Parfait pour la plage ou la ville en été. Tour de tête ~57cm. Quelques fils qui dépassent.',
    categoryIds: ['women', 'women_accessories', 'women_accessories_hats'],
    imageKey: 'accessories', price: [5, 12], brandPool: 'women_fast', sizePool: 'women_clothing', colors: ['Beige'],
  },
  {
    title: 'Sneakers Converse Chuck 70',
    description: 'Converse Chuck 70 hautes, noires. Semelle vintage épaisse. Plus confortables que les classiques. Taille 41. Portées 2 mois.',
    categoryIds: ['men', 'men_shoes', 'men_shoes_sneakers'],
    imageKey: 'men_shoes', price: [30, 50], brandPool: 'men_street', sizePool: 'men_shoes', colors: ['Noir'],
    brandOverride: 'Converse',
  },
  {
    title: 'Sac banane Nike',
    description: 'Sac banane Nike Heritage, format compact. Se porte en bandoulière ou à la taille. Nylon résistant. Noir avec logo blanc.',
    categoryIds: ['men', 'men_accessories', 'men_accessories_bags'],
    imageKey: 'accessories', price: [10, 20], brandPool: 'men_street', sizePool: 'men_clothing', colors: ['Noir'],
    brandOverride: 'Nike',
  },
  {
    title: 'Bottes de pluie Aigle',
    description: 'Bottes de pluie Aigle, modèle Parcours 2. Caoutchouc naturel, fabriquées en France. Kaki. Pointure 39. Parfait état.',
    categoryIds: ['women', 'women_shoes', 'women_shoes_boots'],
    imageKey: 'women_shoes', price: [30, 55], brandPool: 'women_mid', sizePool: 'women_shoes', colors: ['Kaki'],
    brandOverride: 'Aigle',
  },
];

// =============================================================================
// HELPERS
// =============================================================================

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInRange(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomDate(daysBack = 90) {
  const now = Date.now();
  const past = now - daysBack * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

function generateArticle(def, index) {
  const seller = randomItem(SELLERS);
  const condition = weightedRandom(CONDITIONS, CONDITION_WEIGHTS);
  const price = randomInRange(def.price[0], def.price[1]);
  const brand = def.brandOverride || randomItem(BRANDS[def.brandPool] || BRANDS.women_mid);
  const sizeArr = SIZES[def.sizePool] || SIZES.women_clothing;
  const size = randomItem(sizeArr);
  const color = def.colors ? randomItem(def.colors) : randomItem(COLORS);
  const material = def.material || randomItem(MATERIALS);
  const images = IMAGES[def.imageKey] || IMAGES.women_dress;
  const imageUrl = images[index % images.length];
  const createdAt = randomDate();

  return {
    title: def.title,
    description: def.description,
    price,
    images: [{ url: imageUrl }],
    category: def.categoryIds[def.categoryIds.length - 1],
    categoryIds: def.categoryIds,
    size,
    brand,
    color,
    material,
    condition,
    sellerId: seller.id,
    sellerName: seller.name,
    sellerImage: seller.image,
    createdAt: admin.firestore.Timestamp.fromDate(createdAt),
    updatedAt: admin.firestore.Timestamp.fromDate(createdAt),
    isActive: true,
    isSold: false,
    likes: randomInRange(0, 25),
    views: randomInRange(5, 200),
    isHandDelivery: Math.random() > 0.5,
    isShipping: Math.random() > 0.3,
    packageSize: randomItem(['small', 'medium', 'large']),
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function seedArticles() {
  console.log('🌱 Starting article seeding...\n');

  const batch = db.batch();
  let count = 0;

  for (let i = 0; i < ARTICLES.length; i++) {
    const article = generateArticle(ARTICLES[i], i);
    const docRef = db.collection('articles').doc();
    batch.set(docRef, article);
    count++;

    console.log(`  📦 ${count}. ${article.title} — ${article.price}€ — ${article.brand} — ${article.condition}`);
  }

  console.log(`\n📤 Writing ${count} articles to Firestore...`);
  await batch.commit();
  console.log(`✅ Successfully seeded ${count} articles!\n`);
}

seedArticles()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error seeding articles:', err);
    process.exit(1);
  });
