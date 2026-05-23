/**
 * Profile feature — shared types.
 */

import type { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  action: () => void;
}

export interface StatItemData {
  value: string | number;
  label: string;
  delay?: number;
}
