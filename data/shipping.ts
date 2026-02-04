import { ArticleDimensions } from '@/types';

/**
 * Dimensions par défaut pour chaque catégorie (en cm)
 * Format: longueur x largeur x hauteur
 */
export const DEFAULT_DIMENSIONS: Record<string, ArticleDimensions> = {
  // Vêtements femme
  'women_tops': { length: 30, width: 25, height: 5 },
  'women_bottoms_pants': { length: 40, width: 30, height: 8 },
  'women_bottoms_skirts': { length: 35, width: 30, height: 5 },
  'women_dresses': { length: 40, width: 30, height: 8 },
  'women_coats': { length: 45, width: 35, height: 10 },
  'women_sweaters': { length: 35, width: 30, height: 8 },
  
  // Vêtements homme
  'men_tops': { length: 35, width: 30, height: 5 },
  'men_bottoms_pants': { length: 45, width: 35, height: 8 },
  'men_coats': { length: 50, width: 40, height: 10 },
  'men_tops_sweaters': { length: 40, width: 35, height: 8 },
  'men_suits': { length: 50, width: 40, height: 12 },
  
  // Chaussures
  'women_shoes': { length: 35, width: 25, height: 15 },
  'men_shoes': { length: 40, width: 30, height: 15 },
  'kids_girls_shoes': { length: 30, width: 20, height: 12 },
  'kids_boys_shoes': { length: 30, width: 20, height: 12 },
  
  // Accessoires
  'women_bags': { length: 35, width: 30, height: 15 },
  'women_bags_handbags': { length: 35, width: 30, height: 15 },
  'women_bags_backpacks': { length: 40, width: 35, height: 15 },
  
  // Enfant
  'kids_girls_clothing': { length: 30, width: 25, height: 5 },
  'kids_boys_clothing': { length: 30, width: 25, height: 5 },
  'kids_toys': { length: 30, width: 25, height: 20 },
  
  // Maison
  'home_decoration': { length: 40, width: 35, height: 25 },
  'home_textiles': { length: 35, width: 30, height: 10 },
  
  // Par défaut pour catégories non spécifiées
  'default': { length: 35, width: 30, height: 10 },
};

/**
 * Poids suggérés par catégorie (en kg)
 * Basé sur des données réelles de poids de vêtements
 * Sources: comment-economiser.fr, toutpratique.com, cockeyed.com, pologeorgis.com
 */
export const SUGGESTED_WEIGHTS: Record<string, number> = {
  // Vêtements légers femme
  'women_tops': 0.2,           // T-shirt: 150-200g
  'women_tops_blouses': 0.25,  // Chemisier: 200-250g
  'women_bottoms_skirts': 0.3, // Jupe légère: 200-300g
  'women_bottoms_shorts': 0.25, // Short: 200-300g

  // Vêtements moyens femme
  'women_bottoms_pants': 0.7,  // Jeans: 700-900g, pantalon coton: 300-400g
  'women_bottoms_jeans': 0.8,  // Jeans spécifiquement: 700-1000g
  'women_dresses': 0.4,        // Robe légère: 200-400g
  'women_dresses_evening': 0.8, // Robe de soirée: 600-1000g
  'women_sweaters': 0.4,       // Pull: 300-400g
  'women_hoodies': 0.5,        // Sweat à capuche: 400-500g
  'women_cardigans': 0.35,     // Cardigan: 300-400g

  // Vêtements lourds femme
  'women_coats': 1.2,          // Manteau: 800-1500g
  'women_coats_winter': 1.5,   // Doudoune/manteau hiver: 1000-2000g
  'women_jackets': 0.8,        // Veste légère: 500-800g
  'women_jackets_leather': 1.5, // Veste cuir: 1200-2000g
  'women_jackets_denim': 0.9,  // Veste en jean: 700-1000g

  // Vêtements légers homme
  'men_tops': 0.25,            // T-shirt homme: 200-300g
  'men_tops_shirts': 0.3,      // Chemise: 250-350g
  'men_tops_polos': 0.3,       // Polo: 250-350g

  // Vêtements moyens homme
  'men_bottoms_pants': 0.8,    // Jeans homme: 800-1000g
  'men_bottoms_jeans': 0.9,    // Jeans spécifiquement: 800-1000g
  'men_bottoms_chinos': 0.5,   // Chino: 400-600g
  'men_bottoms_shorts': 0.35,  // Short: 300-400g
  'men_tops_sweaters': 0.5,    // Pull homme: 400-600g
  'men_hoodies': 0.6,          // Sweat à capuche: 500-700g

  // Vêtements lourds homme
  'men_coats': 1.5,            // Manteau homme: 1000-2000g
  'men_coats_winter': 1.8,     // Doudoune/manteau hiver: 1500-2500g
  'men_jackets': 1.0,          // Veste: 700-1200g
  'men_jackets_leather': 2.0,  // Veste cuir: 1500-2500g
  'men_jackets_denim': 1.0,    // Veste en jean: 800-1200g
  'men_suits': 1.5,            // Costume complet: 1200-1800g
  'men_blazers': 0.8,          // Blazer seul: 600-900g

  // Chaussures (poids pour une paire)
  'women_shoes': 0.9,          // Chaussures femme: 800-1100g
  'women_shoes_heels': 0.8,    // Talons: 600-900g
  'women_shoes_boots': 1.3,    // Bottes femme: 1000-1500g
  'women_shoes_sneakers': 0.8, // Baskets femme: 600-900g
  'women_shoes_sandals': 0.5,  // Sandales: 300-600g
  'men_shoes': 1.2,            // Chaussures homme: 1000-1400g
  'men_shoes_boots': 1.6,      // Bottes homme: 1300-2000g
  'men_shoes_sneakers': 1.0,   // Baskets homme: 800-1200g
  'men_shoes_dress': 1.1,      // Chaussures habillées: 900-1300g
  'kids_girls_shoes': 0.5,     // Chaussures enfant: 400-600g
  'kids_boys_shoes': 0.5,      // Chaussures enfant: 400-600g

  // Accessoires
  'women_bags': 0.7,           // Sac à main moyen: 500-900g
  'women_bags_handbags': 0.8,  // Sac à main cuir: 600-1000g
  'women_bags_backpacks': 0.6, // Sac à dos: 400-800g
  'women_bags_clutch': 0.3,    // Pochette: 200-400g
  'women_bags_tote': 0.5,      // Cabas: 400-700g
  'men_bags': 0.8,             // Sac homme: 600-1000g
  'men_bags_backpacks': 0.7,   // Sac à dos homme: 500-900g

  // Accessoires légers
  'women_accessories_scarves': 0.15, // Écharpe: 100-200g
  'women_accessories_belts': 0.2,    // Ceinture: 150-250g
  'women_accessories_hats': 0.15,    // Chapeau: 100-200g
  'men_accessories_scarves': 0.2,    // Écharpe homme: 150-250g
  'men_accessories_belts': 0.25,     // Ceinture homme: 200-300g
  'men_accessories_hats': 0.2,       // Chapeau/casquette: 100-250g

  // Enfant - vêtements plus légers
  'kids_girls_clothing': 0.15,       // T-shirt/haut enfant: 50-150g
  'kids_girls_dresses': 0.2,         // Robe enfant: 100-250g
  'kids_girls_pants': 0.25,          // Pantalon enfant: 150-300g
  'kids_girls_coats': 0.6,           // Manteau enfant: 400-800g
  'kids_boys_clothing': 0.15,        // T-shirt/haut enfant: 50-150g
  'kids_boys_pants': 0.3,            // Pantalon enfant: 200-350g
  'kids_boys_coats': 0.7,            // Manteau enfant: 500-900g
  'kids_toys': 0.5,                  // Jouet moyen: variable

  // Bébé
  'baby_clothing': 0.1,              // Vêtement bébé: 50-100g
  'baby_bodysuits': 0.08,            // Body: 50-100g
  'baby_shoes': 0.15,                // Chaussures bébé: 100-200g

  // Maison
  'home_decoration': 1.0,            // Décoration: variable
  'home_textiles': 0.6,              // Textile maison: 400-800g
  'home_textiles_bedding': 1.5,      // Linge de lit: 1000-2000g
  'home_textiles_towels': 0.5,       // Serviette: 400-600g
  'home_textiles_curtains': 1.0,     // Rideaux: 800-1500g

  // Par défaut
  'default': 0.5,
};

/**
 * Récupère les dimensions par défaut pour une catégorie (par IDs)
 */
export function getDimensionsForCategory(categoryIds: string[]): ArticleDimensions {
  if (!categoryIds || categoryIds.length === 0) {
    return DEFAULT_DIMENSIONS['default'];
  }
  
  // On teste les IDs du plus précis au plus général
  // ex: ['women', 'women_clothing', 'women_coats', 'women_coats_coats']
  // On teste 'women_coats_coats', puis 'women_coats', puis 'women_clothing', puis 'women'
  for (let i = categoryIds.length - 1; i >= 0; i--) {
    const id = categoryIds[i];
    
    // Correspondance directe
    if (DEFAULT_DIMENSIONS[id]) {
      return DEFAULT_DIMENSIONS[id];
    }
    
    // Correspondance partielle (si la clé commence par l'ID)
    const matchingKey = Object.keys(DEFAULT_DIMENSIONS).find(key => key.startsWith(id));
    if (matchingKey) {
      return DEFAULT_DIMENSIONS[matchingKey];
    }
  }
  
  return DEFAULT_DIMENSIONS['default'];
}

/**
 * Récupère le poids suggéré pour une catégorie (par IDs)
 */
export function getSuggestedWeightForCategory(categoryIds: string[]): number {
  if (!categoryIds || categoryIds.length === 0) {
    return SUGGESTED_WEIGHTS['default'];
  }
  
  // On teste les IDs du plus précis au plus général
  for (let i = categoryIds.length - 1; i >= 0; i--) {
    const id = categoryIds[i];
    
    // Correspondance directe
    if (SUGGESTED_WEIGHTS[id]) {
      return SUGGESTED_WEIGHTS[id];
    }
    
    // Correspondance partielle
    const matchingKey = Object.keys(SUGGESTED_WEIGHTS).find(key => key.startsWith(id));
    if (matchingKey) {
      return SUGGESTED_WEIGHTS[matchingKey];
    }
  }
  
  return SUGGESTED_WEIGHTS['default'];
}
