/**
 * ProductCard layout constants.
 * Extracted to a dedicated file so ProductCard.tsx only exports
 * React components — required for Fast Refresh to work correctly.
 */

import { Dimensions } from 'react-native';

// NOTE: screenWidth is read once at module load, so CARD_WIDTH is frozen.
// The app is portrait-only, but this value will NOT track runtime width
// changes (Android split-screen, iPad multitasking, foldables). For
// width-reactive sizing use useWindowDimensions() inside ProductCard.tsx;
// this constant remains the static fallback for the standard grid.
const { width: screenWidth } = Dimensions.get('window');
const CONTAINER_PADDING = 0;
const GRID_GAP = 1;

export const CARD_WIDTH = (screenWidth - CONTAINER_PADDING * 2 - GRID_GAP) / 2;
export const COMPACT_CARD_WIDTH = 180;
