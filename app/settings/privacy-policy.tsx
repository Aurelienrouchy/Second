/**
 * Privacy Policy (RGPD)
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';

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

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Confidentialité' }} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Caption style={styles.lastUpdate}>Dernière mise à jour : Janvier 2025</Caption>

        <View style={styles.introBox}>
          <Text variant="bodySmall" style={styles.introText}>
            Chez Seconde, nous accordons une importance primordiale à la protection de vos données
            personnelles. Cette Politique de Confidentialité explique comment nous collectons,
            utilisons et protégeons vos informations conformément au Règlement Général sur la
            Protection des Données (RGPD).
          </Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>1. Responsable du traitement</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Le responsable du traitement de vos données personnelles est :
        </Text>
        <View style={styles.infoCard}>
          <Text variant="body" style={styles.companyName}>Seconde SAS</Text>
          <Caption>10 rue de la Mode, 75003 Paris</Caption>
          <Caption>Email : privacy@seconde.app</Caption>
          <Caption>DPO : dpo@seconde.app</Caption>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>2. Données collectées</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Nous collectons les catégories de données suivantes :
        </Text>

        <Label style={styles.subTitle}>2.1 Données que vous nous fournissez</Label>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Données d'identification : nom, prénom, email, photo de profil</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Coordonnées : adresse, numéro de téléphone</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Contenu : photos et descriptions d'articles, messages</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Préférences : tailles, marques favorites, localisation préférée</Text>
        </View>

        <Label style={styles.subTitle}>2.2 Données collectées automatiquement</Label>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Données techniques : type d'appareil, système d'exploitation, identifiants</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Données d'utilisation : pages visitées, fonctionnalités utilisées</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Données de localisation : si vous l'autorisez, pour les fonctionnalités de proximité</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>3. Finalités du traitement</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Vos données sont utilisées pour :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Fournir et améliorer nos services</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Gérer votre compte utilisateur</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Permettre les transactions entre utilisateurs</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Envoyer des notifications (si vous l'autorisez)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Personnaliser votre expérience (recommandations)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Assurer la sécurité et prévenir la fraude</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Respecter nos obligations légales</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>4. Base légale du traitement</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Le traitement de vos données repose sur :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• L'exécution du contrat (utilisation du service)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Votre consentement (notifications, localisation, marketing)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Notre intérêt légitime (sécurité, amélioration du service)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Nos obligations légales (conservation légale)</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>5. Destinataires des données</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Vos données peuvent être partagées avec :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Les autres utilisateurs (profil public, annonces)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Nos prestataires techniques (hébergement, analytics)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Les autorités compétentes (obligation légale)</Text>
        </View>

        <View style={styles.highlightBox}>
          <Ionicons name="shield" size={20} color={colors.primary} />
          <Text variant="bodySmall" style={styles.highlightText}>
            Nous ne vendons jamais vos données personnelles à des tiers.
          </Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>6. Transferts hors UE</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Certains de nos prestataires (Firebase/Google) peuvent traiter des données hors de
          l'Union Européenne. Ces transferts sont encadrés par des garanties appropriées
          (clauses contractuelles types de la Commission Européenne).
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>7. Durée de conservation</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Nous conservons vos données selon les durées suivantes :
        </Text>
        <View style={styles.listContainer}>
          <Text variant="bodySmall" style={styles.listItem}>• Compte actif : durée de vie du compte + 3 ans</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Compte supprimé : suppression immédiate (sauf obligations légales)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Données de transaction : 10 ans (obligation comptable)</Text>
          <Text variant="bodySmall" style={styles.listItem}>• Logs de connexion : 1 an</Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>8. Vos droits (RGPD)</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conformément au RGPD, vous disposez des droits suivants :
        </Text>

        <RightBox
          title="Droit d'accès (Art. 15)"
          description="Obtenir une copie de vos données personnelles."
        />
        <RightBox
          title="Droit de rectification (Art. 16)"
          description="Corriger vos données inexactes ou incomplètes."
        />
        <RightBox
          title="Droit à l'effacement (Art. 17)"
          description={"Demander la suppression de vos données (\"droit à l'oubli\")."}
        />
        <RightBox
          title="Droit à la portabilité (Art. 20)"
          description="Récupérer vos données dans un format structuré et lisible."
        />
        <RightBox
          title="Droit d'opposition (Art. 21)"
          description="Vous opposer au traitement de vos données pour des motifs légitimes."
        />
        <RightBox
          title="Droit de retrait du consentement"
          description="Retirer votre consentement à tout moment (sans affecter la licéité du traitement antérieur)."
        />

        <Text variant="bodySmall" style={styles.paragraph}>
          Pour exercer ces droits, rendez-vous dans Paramètres → Confidentialité ou contactez-nous
          à privacy@seconde.app.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>9. Sécurité des données</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour
          protéger vos données :
        </Text>
        <View style={styles.securityBox}>
          <View style={styles.securityItem}>
            <Ionicons name="lock-closed" size={16} color={colors.success} />
            <Caption style={styles.securityText}>Chiffrement des données en transit (HTTPS/TLS)</Caption>
          </View>
          <View style={styles.securityItem}>
            <Ionicons name="lock-closed" size={16} color={colors.success} />
            <Caption style={styles.securityText}>Chiffrement des données au repos</Caption>
          </View>
          <View style={styles.securityItem}>
            <Ionicons name="key" size={16} color={colors.success} />
            <Caption style={styles.securityText}>Contrôles d'accès stricts</Caption>
          </View>
          <View style={styles.securityItem}>
            <Ionicons name="eye" size={16} color={colors.success} />
            <Caption style={styles.securityText}>Surveillance et détection des intrusions</Caption>
          </View>
          <View style={styles.securityItem}>
            <Ionicons name="people" size={16} color={colors.success} />
            <Caption style={styles.securityText}>Formation de nos équipes</Caption>
          </View>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>10. Cookies et traceurs</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application utilise des technologies similaires aux cookies pour son fonctionnement.
          Pour plus d'informations, consultez notre Politique Cookies accessible depuis les
          paramètres.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>11. Mineurs</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L'Application n'est pas destinée aux personnes de moins de 16 ans. Nous ne collectons
          pas sciemment de données concernant des mineurs de moins de 16 ans.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>12. Réclamation</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une
          réclamation auprès de la CNIL :
        </Text>
        <View style={styles.infoCard}>
          <Text variant="body" style={styles.companyName}>CNIL</Text>
          <Caption>Commission Nationale de l'Informatique et des Libertés</Caption>
          <Caption>3 Place de Fontenoy, TSA 80715</Caption>
          <Caption>75334 PARIS CEDEX 07</Caption>
          <Caption>www.cnil.fr</Caption>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>13. Modifications</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Nous pouvons modifier cette politique à tout moment. Vous serez informé de tout
          changement significatif par notification dans l'Application.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>14. Contact</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Pour toute question relative à cette politique ou à vos données personnelles :
        </Text>
        <View style={styles.infoCard}>
          <Caption>Email : privacy@seconde.app</Caption>
          <Caption>DPO : dpo@seconde.app</Caption>
        </View>

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
  securityBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  securityText: {
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
