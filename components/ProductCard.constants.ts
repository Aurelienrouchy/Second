/**
 * ProductCard layout constants.
 * Extracted to a dedicated file so ProductCard.tsx only exports
 * React components — required for Fast Refresh to work correctly.
 */

import { Dimensions } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');
const CONTAINER_PADDING = 0;
const GRID_GAP = 1;

export const CARD_WIDTH = (screenWidth - CONTAINER_PADDING * 2 - GRID_GAP) / 2;
export const COMPACT_CARD_WIDTH = 180;
