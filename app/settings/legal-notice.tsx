/**
 * Legal Notice (Mentions Légales)
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';

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
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Mentions légales" onBack={() => router.back()} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Caption style={styles.lastUpdate}>Dernière mise à jour : Mai 2026</Caption>

        <Text variant="h3" style={styles.sectionTitle}>1. Éditeur de l&apos;application</Text>
        <InfoCard title="Seconde Inc.">
          <Caption>Société par actions constituée au Québec</Caption>
          <Caption>NEQ : 1234567890</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Siège social</Label>
        <InfoCard>
          <Caption>5000 rue Saint-Denis, bureau 200</Caption>
          <Caption>Montréal, QC H2J 2L8</Caption>
          <Caption>Canada</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Contact</Label>
        <InfoCard>
          <Caption>Email : contact@seconde.ca</Caption>
          <Caption>Support : contact@seconde.ca</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>2. Directeur de la publication</Text>
        <InfoCard>
          <Caption>Aurélien Rouchy</Caption>
          <Caption>En qualité de : Président</Caption>
          <Caption>Email : contact@seconde.ca</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>3. Hébergement</Text>
        <InfoCard title="Google Cloud Platform (Firebase)">
          <Caption>Google Cloud Canada</Caption>
          <Caption>111 Richmond Street West, Suite 200</Caption>
          <Caption>Toronto, ON M5H 2G4, Canada</Caption>
          <Caption>https://firebase.google.com</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>4. Propriété intellectuelle</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L&apos;ensemble du contenu de l&apos;Application Seconde (textes, images, graphismes, logo,
          icônes, sons, logiciels, etc.) est protégé par les lois canadiennes et internationales
          relatives à la propriété intellectuelle, notamment la Loi sur le droit d&apos;auteur (L.R.C. (1985), ch. C-42).
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          La marque « Seconde », le logo et l&apos;ensemble des éléments graphiques sont la propriété
          exclusive de Seconde Inc. Toute reproduction, représentation, modification,
          publication ou adaptation totale ou partielle de ces éléments est strictement interdite
          sans autorisation écrite préalable.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les contenus publiés par les utilisateurs (photos, descriptions) restent leur
          propriété. En les publiant sur l&apos;Application, ils accordent à Seconde Inc. une licence
          d&apos;utilisation non exclusive pour les besoins du service.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>5. Données personnelles</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Le traitement des données personnelles est régi par notre Politique de Confidentialité,
          accessible depuis les paramètres de l&apos;Application. Seconde Inc. se conforme à la Loi 25
          sur la protection des renseignements personnels dans le secteur privé (Québec) ainsi
          qu&apos;à la Loi sur la protection des renseignements personnels et les documents
          électroniques (LPRPDE / PIPEDA) au niveau fédéral.
        </Text>

        <Label style={styles.subTitle}>Responsable de la protection des renseignements personnels</Label>
        <InfoCard>
          <Caption>Email : contact@seconde.ca</Caption>
        </InfoCard>

        <Label style={styles.subTitle}>Autorité de contrôle</Label>
        <InfoCard title="Commission d'accès à l'information du Québec (CAI)">
          <Caption>525, boul. René-Lévesque Est, bureau 2.36</Caption>
          <Caption>Québec, QC G1R 5S9</Caption>
          <Caption>www.cai.gouv.qc.ca</Caption>
        </InfoCard>
        <InfoCard title="Commissariat à la protection de la vie privée du Canada (CPVP)">
          <Caption>30, rue Victoria</Caption>
          <Caption>Gatineau, QC K1A 1H3</Caption>
          <Caption>www.priv.gc.ca</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>6. Stockage local</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          L&apos;Application utilise des technologies de stockage local pour son fonctionnement.
          Pour plus d&apos;informations, consultez notre Politique de Confidentialité.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>7. Limitation de responsabilité</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Seconde Inc. agit en tant qu&apos;intermédiaire technique entre les utilisateurs. Elle ne
          peut être tenue responsable :
        </Text>
        <View style={styles.warningBox}>
          <Text variant="bodySmall" style={styles.warningItem}>
            {'•'} Du contenu publié par les utilisateurs
          </Text>
          <Text variant="bodySmall" style={styles.warningItem}>
            {'•'} Des transactions effectuées entre utilisateurs
          </Text>
          <Text variant="bodySmall" style={styles.warningItem}>
            {'•'} Des dommages directs ou indirects liés à l&apos;utilisation de l&apos;Application
          </Text>
          <Text variant="bodySmall" style={styles.warningItem}>
            {'•'} Des interruptions temporaires du service
          </Text>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>8. Droit applicable</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Les présentes mentions légales sont régies par les lois en vigueur dans la province de
          Québec et les lois fédérales du Canada qui s&apos;y appliquent. En cas de litige, et après
          échec de toute tentative de recherche d&apos;une solution amiable, les tribunaux du district
          judiciaire de Montréal seront seuls compétents.
        </Text>

        <Text variant="h3" style={styles.sectionTitle}>9. Résolution des différends</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          En cas de litige, vous pouvez contacter notre service à la clientèle. Si aucune entente
          n&apos;est trouvée, vous pouvez déposer une plainte auprès de l&apos;Office de la protection du
          consommateur du Québec (OPC).
        </Text>
        <InfoCard title="Office de la protection du consommateur">
          <Caption>400, boul. Jean-Lesage, bureau 450</Caption>
          <Caption>Québec, QC G1K 8W4</Caption>
          <Caption>www.opc.gouv.qc.ca</Caption>
        </InfoCard>

        <Text variant="h3" style={styles.sectionTitle}>10. Signalement de contenus illicites</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Vous pouvez nous signaler tout contenu illicite ou contrevenant aux lois canadiennes via :
        </Text>
        <View style={styles.signalBox}>
          <View style={styles.signalItem}>
            <Ionicons name="flag" size={18} color={colors.warning} />
            <Caption style={styles.signalText}>La fonction « Signaler » dans l&apos;Application</Caption>
          </View>
          <View style={styles.signalItem}>
            <Ionicons name="mail" size={18} color={colors.warning} />
            <Caption style={styles.signalText}>Par email : contact@seconde.ca</Caption>
          </View>
        </View>

        <Text variant="h3" style={styles.sectionTitle}>11. Crédits</Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Conception et développement : Seconde Inc.
        </Text>
        <Text variant="bodySmall" style={styles.paragraph}>
          Icônes : Ionicons (MIT License)
        </Text>

        <View style={styles.footer}>
          <Caption style={styles.footerText}>
            © 2026 Seconde Inc. - Tous droits réservés
          </Caption>
        </View>
      </ScrollView>
    </View>
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
