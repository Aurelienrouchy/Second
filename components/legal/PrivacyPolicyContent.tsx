/**
 * PrivacyPolicyContent — body of the Privacy Policy (Loi 25 / LPRPDE),
 * presentational only.
 *
 * Factored out of app/settings/privacy-policy.tsx so the EXACT SAME legal copy
 * is reused by both:
 *  - the authenticated settings route (app/settings/privacy-policy.tsx)
 *  - the PUBLIC route reachable at consent time (app/legal/privacy-policy.tsx)
 *
 * Loi 25 (art. 12): the privacy policy must be accessible and readable at the
 * moment of consent, before any box is checked. Since app/settings/* is guarded
 * (redirects unauthenticated users), the consent links must point to the public
 * route, which renders this same component — no copy is duplicated.
 *
 * Renders the scrollable body only (no header): each route owns its own
 * ScreenHeader so the back affordance fits its navigation context.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Caption, Label, Text } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';

interface RightBoxProps {
  title: string;
  description: string;
}

const RightBox = ({ title, description }: RightBoxProps) => (
  <View style={styles.rightBox}>
    <View style={styles.rightHeader}>
      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
      <Text variant="body" style={styles.rightTitle}>{title}</Text>
    </View>
    <Caption style={styles.rightText}>{description}</Caption>
  </View>
);

function PrivacyPolicyContentComponent() {
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
      <Caption style={styles.lastUpdate}>Dernière mise à jour : 31 mai 2026</Caption>

      <View style={styles.introBox}>
        <Text variant="bodySmall" style={styles.introText}>
          Chez Seconde, nous accordons une importance primordiale à la protection de vos données
          personnelles. Cette Politique de Confidentialité explique comment nous collectons,
          utilisons et protégeons vos informations conformément à la Loi 25 sur la protection
          des renseignements personnels du Québec et à la LPRPDE (PIPEDA).
        </Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>1. Responsable de la protection des renseignements personnels</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Seconde a désigné un responsable de la protection des renseignements personnels,
        conformément à l'article 3.1 de la Loi 25. Pour toute question relative à vos
        renseignements personnels ou pour exercer vos droits : contact@seconde.ca.
      </Text>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Seconde Inc.</Text>
        <Caption>Montréal, Québec, Canada</Caption>
        <Caption>Email : contact@seconde.ca</Caption>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>2. Renseignements que nous recueillons</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Nous recueillons les catégories de renseignements suivantes :
      </Text>

      <Label style={styles.subTitle}>Identité et compte</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Nom d'affichage, courriel, date de naissance, photo de profil</Text>
      </View>

      <Label style={styles.subTitle}>Annonces et contenus</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Photos d'articles, descriptions, tailles, marques</Text>
      </View>

      <Label style={styles.subTitle}>Transactions</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Historique d'achats et de ventes, montants</Text>
      </View>

      <Label style={styles.subTitle}>Paiement et versement</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Traités par Stripe : nom légal, date de naissance, adresse, coordonnées bancaires</Text>
      </View>

      <Label style={styles.subTitle}>Expédition</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Adresses complètes, téléphone, traitées par ShipEngine</Text>
      </View>

      <Label style={styles.subTitle}>Communications</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Messages échangés dans la messagerie</Text>
      </View>

      <Label style={styles.subTitle}>Données d'utilisation et préférences</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Recherches, articles consultés, favoris et préférences</Text>
      </View>

      <Label style={styles.subTitle}>Localisation</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Données de localisation ou de quartier, si vous les fournissez</Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>3. Finalités de l'utilisation</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Nous utilisons vos renseignements pour :
      </Text>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Fournir le service de place de marché</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Traiter les paiements et les expéditions</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Assurer la sécurité et prévenir la fraude</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Communiquer avec vous</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Uniquement si vous y consentez : vous offrir des recommandations personnalisées par IA et des communications marketing</Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>4. Destinataires et communications hors Québec (art. 8 et 17)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Pour fournir le service, nous communiquons certains renseignements à des prestataires
        situés à l'extérieur du Québec et du Canada, principalement aux États-Unis. Nous avons
        évalué les facteurs relatifs à la vie privée applicables et encadrons ces communications
        par des ententes écrites.
      </Text>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Stripe, Inc. (États-Unis)</Text>
        <Caption>Paiements et conformité (KYC) : nom, date de naissance, adresse, coordonnées bancaires</Caption>
        <Caption>https://stripe.com/fr-ca/privacy</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>ShipEngine / Auctane (États-Unis)</Text>
        <Caption>Expédition : adresses, téléphone, courriel</Caption>
        <Caption>https://www.shipengine.com/privacy-policy/</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Google Cloud — Vertex AI et Gemini (États-Unis)</Text>
        <Caption>Analyse d'images et recommandations (uniquement si vous activez les recommandations IA) : photos d'articles, métadonnées</Caption>
        <Caption>https://policies.google.com/privacy</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Google Firebase (Google LLC)</Text>
        <Caption>Hébergement, authentification, base de données, notifications</Caption>
        <Caption>Nos fonctions infonuagiques sont hébergées dans la région de Montréal (northamerica-northeast1)</Caption>
      </View>

      <View style={styles.highlightBox}>
        <Ionicons name="shield" size={20} color={colors.primary} />
        <Text variant="bodySmall" style={styles.highlightText}>
          Nous ne vendons jamais vos données personnelles à des tiers.
        </Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>5. Profilage et technologies (art. 8.1)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Seconde peut utiliser une technologie d'analyse par intelligence artificielle pour vous
        proposer des recommandations personnalisées (profilage). Cette fonction est désactivée
        par défaut. Vous pouvez l'activer ou la désactiver à tout moment dans Réglages {'>'} Confidentialité.
        Nous n'utilisons pas votre localisation à des fins de profilage sans votre consentement.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>6. Durée de conservation et destruction (art. 23)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Nous conservons vos renseignements seulement le temps nécessaire aux finalités décrites,
        puis les détruisons ou les anonymisons. Les renseignements liés aux transactions sont
        conservés jusqu'à 7 ans pour respecter nos obligations comptables et fiscales. Les données
        de navigation et les préférences sont conservées au plus 12 mois. Les notifications sont
        conservées au plus 6 mois (180 jours). Les données des visiteurs non inscrits sont
        supprimées après 90 jours d'inactivité.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>7. Vos droits (art. 27, 28.1, 30)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Vous avez le droit d'accéder à vos renseignements, de les faire rectifier, d'en obtenir
        une copie dans un format technologique structuré et couramment utilisé (portabilité),
        d'en demander la suppression, et de retirer votre consentement à tout moment. Vous pouvez
        exporter vos données (Réglages {'>'} Exporter mes données) ou supprimer votre compte
        (Réglages {'>'} Supprimer mon compte). Nous répondons à toute demande dans un délai maximal
        de 30 jours.
      </Text>

      <RightBox
        title="Droit d'accès"
        description="Accéder à vos renseignements personnels."
      />
      <RightBox
        title="Droit de rectification"
        description="Faire rectifier vos renseignements inexacts ou incomplets."
      />
      <RightBox
        title="Droit à la portabilité"
        description="Obtenir une copie de vos renseignements dans un format technologique structuré et couramment utilisé."
      />
      <RightBox
        title="Droit à la suppression"
        description="Demander la suppression de vos renseignements personnels."
      />
      <RightBox
        title="Droit de retrait du consentement"
        description="Retirer votre consentement à tout moment."
      />

      <Text variant="h3" style={styles.sectionTitle}>8. Consentement et retrait</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        En créant un compte, vous consentez à la collecte et à l'utilisation de vos
        renseignements aux fins décrites. Vous pouvez retirer votre consentement aux finalités
        facultatives (marketing, recommandations IA) à tout moment dans les Réglages.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>9. Incidents de confidentialité (art. 3.5-3.8)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        En cas d'incident de confidentialité présentant un risque de préjudice sérieux, nous
        prendrons les mesures nécessaires, tiendrons un registre de l'incident et aviserons les
        personnes concernées ainsi que la Commission d'accès à l'information (CAI) comme l'exige
        la loi.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>10. Nous joindre et plainte</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Pour exercer vos droits ou porter plainte : contact@seconde.ca. Vous pouvez aussi
        déposer une plainte auprès de la Commission d'accès à l'information du Québec
        (www.cai.gouv.qc.ca).
      </Text>
      <View style={styles.infoCard}>
        <Caption>Email : contact@seconde.ca</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Commission d'accès à l'information du Québec (CAI)</Text>
        <Caption>525, boul. René-Lévesque Est, bureau 2.36</Caption>
        <Caption>Québec (Québec) G1R 5S9</Caption>
        <Caption>www.cai.gouv.qc.ca</Caption>
      </View>

      <View style={styles.footer}>
        <Caption style={styles.footerText}>
          © 2026 Seconde Inc. - Tous droits réservés
        </Caption>
      </View>
    </ScrollView>
  );
}

export const PrivacyPolicyContent = React.memo(PrivacyPolicyContentComponent);

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  lastUpdate: {
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  introBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  introText: {
    color: colors.foreground,
    lineHeight: 22,
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
  listContainer: {
    marginBottom: spacing.sm,
  },
  listItem: {
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.xs,
    paddingLeft: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 4,
  },
  companyName: {
    fontFamily: fonts.sansMedium,
    marginBottom: spacing.xs,
  },
  rightBox: {
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  rightTitle: {
    fontFamily: fonts.sansMedium,
  },
  rightText: {
    color: colors.foregroundSecondary,
    lineHeight: 20,
    paddingLeft: 26,
  },
  highlightBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
    gap: spacing.sm,
  },
  highlightText: {
    flex: 1,
    color: colors.foreground,
    fontFamily: fonts.sansMedium,
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
