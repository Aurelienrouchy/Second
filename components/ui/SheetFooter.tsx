/**
 * SheetFooter — Seconde (Editorial Design)
 *
 * Barre d'action ancrée en bas d'un bottom sheet (bouton VALIDER / Ajouter…).
 *
 * Se positionne comme DERNIER enfant d'une colonne `BottomSheetView` dont la
 * hauteur est BORNÉE au détent (cf. `useSheetHeight`). C'est ce bornage parent
 * qui garantit la visibilité du footer ; ce composant ne fait que la présentation
 * (fond surface, bordure haute) + le safe-area inset bas (home indicator).
 *
 * Design system : fond colors.surface, bordure colors.border, tokens spacing.
 * Pas de position:absolute (il se pinne par le flux flex), pas de flex:1 (hauteur
 * intrinsèque), pas d'emoji, pas de spring.
 */

import React, { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/constants/theme';

/**
 * Hauteur nominale réservée pour un footer 1 ligne (bouton + paddings).
 * À ajouter au `paddingBottom` du contentContainerStyle de la zone scrollable
 * pour que le dernier item ne soit pas masqué derrière le footer pinned.
 */
export const SHEET_FOOTER_HEIGHT = 64;

interface SheetFooterProps {
  children: ReactNode;
  /** Footer sur fond identique au contenu, sans liseré de séparation. */
  noBorder?: boolean;
  style?: StyleProp<ViewStyle>;
}

function SheetFooterBase({ children, noBorder, style }: SheetFooterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        !noBorder && styles.border,
        { paddingBottom: insets.bottom + spacing.md },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const SheetFooter = memo(SheetFooterBase);
SheetFooter.displayName = 'SheetFooter';

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  border: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
