/**
 * Materials Data
 *
 * IMPORTANT: These values MUST match the MATERIAL_REFERENCE in functions/src/productReference.ts
 * to ensure consistency between AI suggestions and the app's selectors.
 */

export interface MaterialItem {
  id: string;      // ID used in Firestore and by AI
  name: string;    // Display name
}

export const materials: MaterialItem[] = [
  // Fibres naturelles
  { id: 'coton', name: 'Coton' },
  { id: 'laine', name: 'Laine' },
  { id: 'soie', name: 'Soie' },
  { id: 'lin', name: 'Lin' },
  { id: 'cachemire', name: 'Cachemire' },
  { id: 'mohair', name: 'Mohair' },
  { id: 'angora', name: 'Angora' },
  { id: 'alpaga', name: 'Alpaga' },
  { id: 'chanvre', name: 'Chanvre' },
  { id: 'bambou', name: 'Bambou' },
  // Fibres synthétiques
  { id: 'polyester', name: 'Polyester' },
  { id: 'viscose', name: 'Viscose' },
  { id: 'elasthanne', name: 'Élasthanne' },
  { id: 'nylon', name: 'Nylon' },
  { id: 'acrylique', name: 'Acrylique' },
  // Cuirs et similaires
  { id: 'cuir', name: 'Cuir' },
  { id: 'cuir-synthetique', name: 'Cuir synthétique' },
  { id: 'daim', name: 'Daim' },
  // Textiles spéciaux
  { id: 'denim', name: 'Jean/Denim' },
  { id: 'velours', name: 'Velours' },
  { id: 'dentelle', name: 'Dentelle' },
  { id: 'satin', name: 'Satin' },
  { id: 'tweed', name: 'Tweed' },
  { id: 'maille', name: 'Maille' },
  { id: 'mousseline', name: 'Mousseline' },
  // Fourrures
  { id: 'fourrure', name: 'Fourrure' },
  { id: 'fourrure-synthetique', name: 'Fourrure synthétique' },
  // Matériaux rigides
  { id: 'bois', name: 'Bois' },
  { id: 'metal', name: 'Métal' },
  { id: 'plastique', name: 'Plastique' },
  { id: 'verre', name: 'Verre' },
  { id: 'ceramique', name: 'Céramique' },
  // Accessoires
  { id: 'paillettes', name: 'Paillettes' },
  { id: 'perles', name: 'Perles' },
  { id: 'raphia', name: 'Raphia' },
];

/**
 * Get material items for SelectionBottomSheet
 * Returns items with value (ID) and label (display name)
 */
export const getMaterialItems = () => materials.map(material => ({
  value: material.id,
  label: material.name,
}));

/**
 * Find a material by ID
 */
export const findMaterialById = (id: string): MaterialItem | undefined => {
  return materials.find(m => m.id === id);
};

/**
 * Get material display name from ID
 */
export const getMaterialName = (id: string): string => {
  const material = findMaterialById(id);
  return material?.name || id;
};
