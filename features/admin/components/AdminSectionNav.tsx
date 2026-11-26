/**
 * Navigation entre les trois écrans d'administration.
 *
 * Ils sont frères sous `app/admin/_layout.tsx`, mais rien ne permettait de
 * passer de l'un à l'autre : le seul lien de l'application, dans Réglages,
 * ouvre `/admin/shops`, et de là on ne pouvait qu'entrer dans le détail d'une
 * boutique. `/admin/reports` et `/admin/disputes` — dont la file des
 * signalements d'absence, seul recours du parcours d'achat actif — n'étaient
 * atteignables que par lien profond.
 *
 * Le composant se place SOUS l'en-tête de chaque écran : il ne remplace pas le
 * titre ni le retour, il ajoute le déplacement latéral qui manquait.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';

const SECTIONS = [
  { href: '/admin/shops', label: 'Boutiques', icon: 'storefront-outline' },
  { href: '/admin/reports', label: 'Signalements', icon: 'flag-outline' },
  { href: '/admin/eligibility', label: 'Admissibilité', icon: 'person-circle-outline' },
  { href: '/admin/disputes', label: 'Litiges', icon: 'alert-circle-outline' },
  { href: '/admin/privacy-incidents', label: 'Confidentialité', icon: 'shield-checkmark-outline' },
  { href: '/admin/support', label: 'Support', icon: 'chatbubble-ellipses-outline' },
  { href: '/admin/account-access', label: 'Aide à la connexion', icon: 'log-in-outline' },
  { href: '/admin/tax', label: 'Dossiers fiscaux', icon: 'document-text-outline' },
  { href: '/admin/transport-reviews', label: 'Enquêtes de transport', icon: 'trail-sign-outline' },
  { href: '/admin/fraud-reviews', label: 'Paiements à examiner', icon: 'shield-outline' },
  { href: '/admin/product-reviews', label: 'Examen des produits', icon: 'shirt-outline' },
  { href: '/admin/label-lifecycle', label: 'Étiquettes', icon: 'pricetag-outline' },
] as const;

export function AdminSectionNav() {
  const pathname = usePathname();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.nav}>
    <View style={styles.items} accessibilityRole="tablist">
      {SECTIONS.map((section) => {
        const isActive = pathname === section.href;
        return (
          <Pressable
            key={section.href}
            testID={`admin-nav-${section.label.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={section.label}
            style={[styles.item, isActive && styles.itemActive]}
            // `replace` et non `push` : trois vues sœurs, pas une profondeur.
            // Avec `push`, quatre allers-retours empilent quatre écrans et le
            // bouton retour devient un labyrinthe.
            onPress={() => {
              if (!isActive) router.replace(section.href as Href);
            }}
          >
            <Ionicons
              name={section.icon}
              size={16}
              color={isActive ? colors.white : colors.muted}
            />
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  nav: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.white,
  },
  items: { flexDirection: 'row', gap: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    // 44 pt : cible tactile minimale du design system.
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
  },
  itemActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
  },
  labelActive: {
    color: colors.white,
  },
});
