/**
 * Legal Notice (Mentions Légales)
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';

interface InfoCardProps {
  title?: string;
  children: React.ReactNode;
}

const InfoCard = ({ title, children }: InfoCardProps) => (
  <View style={styles.infoCard}>
    {title && <Text variant="body" style={styles.cardTitle}>{title}</Text>}
    {children}
  </View>
);

export default function LegalNoticeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Mentions légales' }} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Caption style={styles.lastUpdate}>Dernière mise à jour : Janvier 2025</Caption>

        <Text variant="h3" style={styles.sectionTitle}>1. Éditeur de l'application</Text>
        <InfoCard title="Seconde SAS">
          <Caption>Société par Actions Simplifiée</Caption>
          <Caption>Capital social : 1 000 €</Caption>
          <Caption>RCS Paris B 123 456 789</Caption>
          <Caption>SIRET : 123 456 789 00001</Caption>
          <Caption>N° TVA : FR12 123456789</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Siège social</Label>
        <InfoCard>
          <Caption>10 rue de la Mode</Caption>
          <Caption>75003 Paris</Caption>
          <Caption>France</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Contact</Label>
        <InfoCard>
          <Caption>Email : contact@seconde.app</Caption>
          <Caption>Support : support@seconde.app</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>2. Directeur de la publication</Text>
        <InfoCard>
          <Caption>Aurélien Rouchy</Caption>
          <Caption>En qualité de : Président</Caption>
          <Caption>Email : legal@seconde.app</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>3. Hébergement</Text>
        <InfoCard title="Google Cloud Platform (Firebase)">
          <Caption>Google Ireland Limited</Caption>
          <Caption>Gordon House, Barrow Street</Caption>
          <Caption>Dublin 4, Ireland</Caption>
          <Caption>https://firebase.google.com</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>4. Propriété intellectuelle</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'ensemble du contenu de l'Application Seconde (textes, images, graphismes, logo,
          icônes, sons, logiciels, etc.) est protégé par le droit français et international
          relatif à la propriété intellectuelle.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          La marque "Seconde", le logo et l'ensemble des éléments graphiques sont la propriété
          exclusive de Seconde SAS. Toute reproduction, représentation, modification,
          publication, adaptation totale ou partielle de ces éléments est strictement interdite
          sans autorisation écrite préalable.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les contenus publiés par les utilisateurs (photos, descriptions) restent leur
          propriété. En les publiant sur l'Application, ils accordent à Seconde SAS une licence
          d'utilisation non exclusive pour les besoins du service.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>5. Données personnelles</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Le traitement des données personnelles est régi par notre Politique de Confidentialité,
          accessible depuis les paramètres de l'Application.
        </Text>

        <Label style={styles.subTitle}>Délégué à la Protection des Données (DPO)</Label>
        <InfoCard>
          <Caption>Email : dpo@seconde.app</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Autorité de contrôle</Label>
        <InfoCard title="CNIL">
          <Caption>Commission Nationale de l'Informatique et des Libertés</Caption>
          <Caption>3 Place de Fontenoy, TSA 80715</Caption>
          <Caption>75334 PARIS CEDEX 07</Caption>
          <Caption>www.cnil.fr</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>6. Cookies</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application utilise des technologies de stockage local pour son fonctionnement.
          Pour plus d'informations, consultez notre Politique de Confidentialité.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>7. Limitation de responsabilité</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Seconde SAS agit en tant qu'intermédiaire technique entre les utilisateurs. Elle ne
          peut être tenue responsable :
        </Text>
        <View style={styles.warningBox}>
          <Text variant="bodySmall" style={styles.warningItem}>• Du contenu publié par les utilisateurs</Text>
          <Text variant="bodySmall" style={styles.warningItem}>• Des transactions effectuées entre utilisateurs</Text>
          <Text variant="bodySmall" style={styles.warningItem}>• Des dommages directs ou indirects liés à l'utilisation de l'Application</Text>
          <Text variant="bodySmall" style={styles.warningItem}>• Des interruptions temporaires du service</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>8. Droit applicable</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les présentes mentions légales sont soumises au droit français. En cas de litige,
          et après échec de toute tentative de recherche d'une solution amiable, les tribunaux
          français seront seuls compétents.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>9. Médiation</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conformément à l'article L. 612-1 du Code de la consommation, en cas de litige, vous
          pouvez recourir gratuitement au service de médiation suivant :
        </Text>
        <InfoCard title="Médiateur de la consommation">
          <Caption>CM2C - Centre de Médiation de la Consommation de Conciliateurs de Justice</Caption>
          <Caption>14 rue Saint Jean, 75017 Paris</Caption>
          <Caption>https://www.cm2c.net</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>10. Plateforme de règlement en ligne des litiges</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conformément à l'article 14 du Règlement (UE) n°524/2013, la Commission Européenne
          met à disposition une plateforme de règlement en ligne des litiges :
        </Text>
        <View style={styles.linkBox}>
          <Ionicons name="link" size={18} color={colors.primary} />
          <Text variant="bodySmall" style={styles.linkText}>
            https://ec.europa.eu/consumers/odr
          </Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>11. Signalement de contenus illicites</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conformément à la loi pour la confiance dans l'économie numérique (LCEN), vous pouvez
          nous signaler tout contenu illicite via :
        </Text>
        <View style={styles.signalBox}>
          <View style={styles.signalItem}>
            <Ionicons name="flag" size={18} color={colors.warning} />
            <Caption style={styles.signalText}>La fonction "Signaler" dans l'Application</Caption>
          </View>
          <View style={styles.signalItem}>
            <Ionicons name="mail" size={18} color={colors.warning} />
            <Caption style={styles.signalText}>Par email : abuse@seconde.app</Caption>
          </View>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>12. Crédits</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conception et développement : Seconde SAS
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Icônes : Ionicons (MIT License)
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
  subTitle: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  paragraph: {
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 4,
  },
  cardTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: spacing.xs,
  },
  warningBox: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    gap: spacing.xs,
  },
  warningItem: {
    color: colors.foreground,
    lineHeight: 22,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  linkText: {
    color: colors.primary,
    flex: 1,
  },
  signalBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  signalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  signalText: {
    color: colors.foreground,
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
