/**
 * Terms of Service (CGU)
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Conditions Générales' }} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Caption style={styles.lastUpdate}>Dernière mise à jour : Janvier 2025</Caption>

        <Text variant="h3" style={styles.sectionTitle}>1. Objet</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les présentes Conditions Générales d'Utilisation (CGU) définissent les modalités
          d'utilisation de l'application mobile Seconde (ci-après "l'Application"), éditée par
          Seconde SAS (ci-après "l'Éditeur").
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application est une plateforme de mise en relation entre particuliers permettant
          l'achat, la vente et l'échange (swap) d'articles de seconde main.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>2. Acceptation des CGU</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'utilisation de l'Application implique l'acceptation pleine et entière des présentes
          CGU. Si vous n'acceptez pas ces conditions, vous ne devez pas utiliser l'Application.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur se réserve le droit de modifier les présentes CGU à tout moment. Les
          utilisateurs seront informés de toute modification par notification dans l'Application.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>3. Inscription et compte utilisateur</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Pour utiliser pleinement les services de l'Application, vous devez créer un compte
          utilisateur. Vous vous engagez à fournir des informations exactes et à les maintenir
          à jour.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Vous êtes responsable de la confidentialité de vos identifiants de connexion et de
          toutes les activités effectuées sous votre compte.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'inscription est réservée aux personnes majeures (18 ans et plus) ou aux mineurs
          disposant de l'autorisation de leur représentant légal.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>4. Services proposés</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application permet aux utilisateurs de :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Publier des annonces d'articles à vendre ou échanger</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Rechercher et consulter des annonces</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Contacter d'autres utilisateurs via la messagerie intégrée</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Proposer et négocier des échanges (swaps)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Participer à des événements d'échange (Swap Parties)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Organiser des remises en main propre</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>5. Obligations des utilisateurs</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          En utilisant l'Application, vous vous engagez à :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Ne publier que des articles vous appartenant légalement</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Fournir des descriptions honnêtes et des photos authentiques</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Respecter les autres utilisateurs et utiliser un langage approprié</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Ne pas publier de contenus illicites, contrefaits ou dangereux</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Honorer vos engagements de vente ou d'échange</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Ne pas utiliser l'Application à des fins frauduleuses</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>6. Articles interdits</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Sont strictement interdits sur l'Application :
        </Text>
        <View style={styles.warningBox}>
          <Text variant="bodySmall" style={styles.warningListItem}>• Articles contrefaits ou portant atteinte à la propriété intellectuelle</Text>
          <Text variant="bodySmall" style={styles.warningListItem}>• Armes, drogues, médicaments sur ordonnance</Text>
          <Text variant="bodySmall" style={styles.warningListItem}>• Produits dangereux ou rappelés</Text>
          <Text variant="bodySmall" style={styles.warningListItem}>• Animaux vivants</Text>
          <Text variant="bodySmall" style={styles.warningListItem}>• Contenus pour adultes</Text>
          <Text variant="bodySmall" style={styles.warningListItem}>• Données personnelles de tiers</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>7. Transactions et responsabilités</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur agit uniquement en tant qu'intermédiaire technique et n'est pas partie aux
          transactions entre utilisateurs. Chaque utilisateur est seul responsable de ses
          transactions.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur ne garantit pas la qualité, la sécurité ou la légalité des articles publiés,
          ni la véracité des informations fournies par les utilisateurs.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>8. Remise en main propre</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Pour les remises en main propre, nous recommandons de :
        </Text>
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color={colors.success} style={styles.infoIcon} />
          <View style={styles.infoContent}>
            <Text variant="bodySmall" style={styles.infoListItem}>• Choisir un lieu public et fréquenté</Text>
            <Text variant="bodySmall" style={styles.infoListItem}>• Se rencontrer en journée</Text>
            <Text variant="bodySmall" style={styles.infoListItem}>• Informer un proche du rendez-vous</Text>
            <Text variant="bodySmall" style={styles.infoListItem}>• Vérifier l'article avant de finaliser l'échange</Text>
          </View>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>9. Propriété intellectuelle</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application, son contenu, sa structure et ses fonctionnalités sont protégés par le
          droit de la propriété intellectuelle. Toute reproduction, modification ou utilisation
          non autorisée est interdite.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          En publiant du contenu sur l'Application, vous accordez à l'Éditeur une licence non
          exclusive pour utiliser ce contenu dans le cadre de l'exploitation du service.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>10. Modération et sanctions</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur se réserve le droit de :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Supprimer tout contenu contraire aux présentes CGU</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Suspendre ou supprimer tout compte en cas de manquement</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Signaler aux autorités compétentes tout comportement illégal</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>11. Limitation de responsabilité</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur s'efforce d'assurer la disponibilité et le bon fonctionnement de
          l'Application, mais ne peut garantir une disponibilité continue et sans erreur.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Éditeur ne pourra être tenu responsable des dommages directs ou indirects résultant
          de l'utilisation de l'Application ou de l'impossibilité de l'utiliser.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>12. Données personnelles</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Le traitement de vos données personnelles est régi par notre Politique de
          Confidentialité, accessible depuis l'Application. En utilisant l'Application, vous
          consentez à ce traitement.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>13. Droit applicable et litiges</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les présentes CGU sont soumises au droit français. En cas de litige, une solution
          amiable sera recherchée avant toute action judiciaire. À défaut, les tribunaux
          français seront seuls compétents.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>14. Contact</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Pour toute question relative aux présentes CGU, vous pouvez nous contacter à l'adresse
          suivante : support@seconde.app
        </Text>

        <View style={styles.footer}>
          <Caption style={styles.footerText}>
            © 2025 Seconde SAS - Tous droits réservés
          </Caption>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  lastUpdate: {
    marginBottom: spacing.lg,
    fontStyle: 'italic',
  },
  sectionTitle: {
    color: colors.foreground,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  paragraph: {
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  listContainer: {
    marginBottom: spacing.sm,
  },
  listItem: {
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.xs,
    paddingLeft: spacing.sm,
  },
  warningBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  warningListItem: {
    color: colors.foreground,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  infoIcon: {
    marginRight: spacing.sm,
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoListItem: {
    color: colors.foreground,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  footer: {
    marginTop: spacing['2xl'],
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    alignItems: 'center',
  },
  footerText: {
    color: colors.muted,
  },
});
