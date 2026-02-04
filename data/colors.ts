/**
 * Colors Data
 *
 * IMPORTANT: These values MUST match the COLOR_REFERENCE in functions/src/productReference.ts
 * to ensure consistency between AI suggestions and the app's selectors.
 */

export interface ColorItem {
  id: string;      // ID used in Firestore and by AI
  name: string;    // Display name
  hex: string;     // Hex color for UI
}

export const colors: ColorItem[] = [
  { id: 'noir', name: 'Noir', hex: '#000000' },
  { id: 'blanc', name: 'Blanc', hex: '#FFFFFF' },
  { id: 'gris', name: 'Gris', hex: '#808080' },
  { id: 'gris-clair', name: 'Gris clair', hex: '#D3D3D3' },
  { id: 'bleu', name: 'Bleu', hex: '#0066FF' },
  { id: 'bleu-marine', name: 'Bleu marine', hex: '#000080' },
  { id: 'bleu-clair', name: 'Bleu clair', hex: '#87CEEB' },
  { id: 'turquoise', name: 'Turquoise', hex: '#40E0D0' },
  { id: 'rouge', name: 'Rouge', hex: '#FF0000' },
  { id: 'bordeaux', name: 'Bordeaux', hex: '#800020' },
  { id: 'rose', name: 'Rose', hex: '#FFC0CB' },
  { id: 'rose-pale', name: 'Rose pâle', hex: '#FFE4E1' },
  { id: 'vert', name: 'Vert', hex: '#008000' },
  { id: 'vert-fonce', name: 'Vert foncé', hex: '#006400' },
  { id: 'vert-clair', name: 'Vert clair', hex: '#90EE90' },
  { id: 'jaune', name: 'Jaune', hex: '#FFCC00' },
  { id: 'orange', name: 'Orange', hex: '#FFA500' },
  { id: 'corail', name: 'Corail', hex: '#FF7F50' },
  { id: 'violet', name: 'Violet', hex: '#800080' },
  { id: 'lavande', name: 'Lavande', hex: '#E6E6FA' },
  { id: 'marron', name: 'Marron', hex: '#8B4513' },
  { id: 'beige', name: 'Beige', hex: '#F5F5DC' },
  { id: 'camel', name: 'Camel', hex: '#C19A6B' },
  { id: 'creme', name: 'Crème', hex: '#FFFDD0' },
  { id: 'argent', name: 'Argent', hex: '#C0C0C0' },
  { id: 'or', name: 'Or', hex: '#FFD700' },
  { id: 'cuivre', name: 'Cuivre', hex: '#B87333' },
  { id: 'multicolore', name: 'Multicolore', hex: '#FF6B6B' },
];

/**
 * Get color items for SelectionBottomSheet
 * Returns items with value (ID), label (display name), and color (hex)
 */
export const getColorItems = () => colors.map(color => ({
  value: color.id,
  label: color.name,
  color: color.hex,
}));

/**
 * Find a color by ID
 */
export const findColorById = (id: string): ColorItem | undefined => {
  return colors.find(c => c.id === id);
};

/**
 * Get color display name from ID
 */
export const getColorName = (id: string): string => {
  const color = findColorById(id);
  return color?.name || id;
};
