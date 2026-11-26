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
      <Caption style={styles.lastUpdate}>Dernière mise à jour : 25 novembre 2026</Caption>

      <View style={styles.introBox}>
        <Text variant="bodySmall" style={styles.introText}>
          Chez Seconde, nous accordons une importance primordiale à la protection de vos données
          personnelles. Cette Politique de Confidentialité explique comment nous collectons,
          utilisons et protégeons vos informations. Les renseignements officiels et les
          évaluations encore à confirmer sont indiqués dans les sections concernées.
        </Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>1. Responsable de la protection des renseignements personnels</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        La personne ayant la plus haute autorité au sein de Seconde Technologies inc. exerce
        la fonction de responsable de la protection des renseignements personnels, tant que
        cette fonction n’est pas déléguée par écrit. Pour toute question relative à vos
        renseignements personnels ou pour exercer vos droits : privacy@seconde.app.
      </Text>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Seconde Technologies inc.</Text>
        <Caption>Responsable de la protection des renseignements personnels — Direction de Seconde</Caption>
        <Caption>Adresse professionnelle publique : à communiquer</Caption>
        <Caption>Contact confidentialité : privacy@seconde.app</Caption>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>2. Renseignements que nous recueillons</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Nous recueillons les catégories de renseignements suivantes :
      </Text>

      <Label style={styles.subTitle}>Identité et compte</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Nom d&apos;affichage, courriel, date de naissance, photo de profil</Text>
      </View>

      <Label style={styles.subTitle}>Annonces et contenus</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Photos d&apos;articles, descriptions, tailles, marques</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Caractéristiques visuelles extraites de la photo principale des annonces pour rechercher des articles similaires</Text>
      </View>

      <Label style={styles.subTitle}>Recherche par photo</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Photo que vous choisissez pour une recherche et caractéristiques visuelles utilisées pour la comparaison</Text>
      </View>

      <Label style={styles.subTitle}>Transactions</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Historique d&apos;achats et de ventes, montants</Text>
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

      <Label style={styles.subTitle}>Données d&apos;utilisation et préférences</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Recherches, articles consultés, favoris et préférences</Text>
      </View>

      <Label style={styles.subTitle}>Localisation</Label>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Données de localisation ou de quartier, si vous les fournissez</Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>3. Finalités de l&apos;utilisation</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Nous utilisons vos renseignements pour :
      </Text>
      <View style={styles.listContainer}>
        <Text variant="bodySmall" style={styles.listItem}>• Fournir le service de place de marché</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Vous proposer des champs d&apos;annonce à partir de vos photos, que vous pouvez modifier avant publication</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Rechercher des articles à partir d&apos;une photo que vous choisissez</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Analyser la photo principale des annonces pour retrouver des articles visuellement similaires</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Traiter les paiements et les expéditions</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Assurer la sécurité et prévenir la fraude</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Communiquer avec vous</Text>
        <Text variant="bodySmall" style={styles.listItem}>• Uniquement si vous y consentez : vous offrir des recommandations personnalisées par IA et des communications marketing</Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>4. Destinataires et communications hors Québec (art. 8 et 17)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Pour fournir le service, nous communiquons certains renseignements à des prestataires
        situés à l&apos;extérieur du Québec et du Canada, principalement aux États-Unis. Les
        évaluations des facteurs relatifs à la vie privée et les accords applicables à ces
        communications restent à confirmer.
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
        <Text variant="body" style={styles.companyName}>Google — Gemini</Text>
        <Caption>Photos envoyées pendant la création de votre annonce pour proposer sa description, sa catégorie, sa marque et d&apos;autres caractéristiques.</Caption>
        <Caption>Cette aide démarre lorsque vous choisissez « Préremplir avec l’IA ». Vous pouvez aussi remplir les champs manuellement.</Caption>
        <Caption>https://policies.google.com/privacy</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Google Cloud — Vertex AI</Text>
        <Caption>Photo choisie pour une recherche et photo principale des annonces : extraction de caractéristiques visuelles pour la recherche par photo et les articles similaires.</Caption>
        <Caption>Le traitement de ces images par Vertex AI est configuré aux États-Unis.</Caption>
        <Caption>https://policies.google.com/privacy</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Google Firebase (Google LLC)</Text>
        <Caption>Hébergement, authentification, base de données, notifications</Caption>
        <Caption>Nos fonctions infonuagiques sont hébergées dans la région de Montréal (northamerica-northeast1)</Caption>
      </View>

      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>PostHog (analyse d&apos;utilisation)</Text>
        <Caption>Statistiques d&apos;usage, identifiant de compte pseudonyme et pseudo public si disponible. Le traitement a lieu aux États-Unis par défaut. Ces données ne sont pas anonymes.</Caption>
        <Caption>La collecte PostHog est désactivée dans la version de production de cette phase.</Caption>
      </View>

      <View style={styles.highlightBox}>
        <Ionicons name="shield" size={20} color={colors.primary} />
        <Text variant="bodySmall" style={styles.highlightText}>
          Nous ne vendons jamais vos données personnelles à des tiers.
        </Text>
      </View>

      <Text variant="h3" style={styles.sectionTitle}>5. Profilage et technologies (art. 8.1)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Seconde peut utiliser une technologie d&apos;analyse par intelligence artificielle pour vous
        proposer des recommandations personnalisées (profilage). Cette fonction est désactivée
        par défaut. Vous pouvez l&apos;activer ou la désactiver à tout moment dans Réglages {'>'} Confidentialité.
        Nous n&apos;utilisons pas votre localisation à des fins de profilage sans votre consentement.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Ce choix concerne seulement les recommandations personnalisées. L&apos;aide IA à la création
        d&apos;annonce, la recherche par photo et l&apos;analyse visuelle des annonces pour retrouver des
        articles similaires fonctionnent indépendamment de ce réglage.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>6. Durée de conservation et destruction (art. 23)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Vous pouvez demander la suppression du compte et suivre son traitement dans l’application.
        Les données ordinaires du profil, contacts, adresses, préférences, favoris, recherches,
        brouillons et contenus personnels sans obligation identifiée sont effacées pendant ce
        traitement, y compris les copies applicatives et médias attribuables. La fermeture de
        l’accès au compte ne signifie pas à elle seule que tous les effacements sont terminés.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Pour un accord local réellement conclu et terminé, l’identité publique est retirée et
        seule une preuve privée minimale de l’accord, de son résultat et des parties
        pseudonymisées peut être conservée au plus trois ans après son résultat terminal,
        pour la défense de droits. Pour une proposition non conclue ou un dossier support ou
        modération clos sans litige ouvert, le contenu personnel est effacé ; un reçu minimal
        peut être conservé au plus 90 jours après la clôture si une finalité précise le justifie.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Lorsqu’un litige ou une obligation est réellement ouvert, seuls les éléments utiles à
        ce dossier sont conservés. Leur prochaine revue a lieu sous 30 jours ; toute
        prolongation doit être motivée et réexaminée. Une véritable pièce comptable nécessaire
        est généralement conservée six ans après la fin de l’année fiscale pertinente, sous
        réserve d’une obligation ou d’un ordre identifié. Un prix de vente en espèces ou un
        troc ne crée pas à lui seul une pièce comptable de la plateforme.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Les preuves techniques minimales d’une demande, du consentement pertinent, de son
        exécution et des verrous de sécurité pseudonymes sont conservées au plus trois ans
        après achèvement, sans courriel, jeton ou contenu utilisateur. Le suivi sécurisé sur
        l’appareil reste disponible pendant le traitement puis 30 jours après achèvement.
        L’usage d’un autre compte sur cet appareil ferme l’accès invité à ce suivi.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Les copies chez les prestataires sont traitées et leur résultat vérifié séparément.
        Des journaux de sécurité Google peuvent rester conservés 30 jours ou 400 jours selon
        leur catégorie ; les données concernées par la surveillance des abus Gemini peuvent
        être conservées 55 jours selon la politique du prestataire. Ces exceptions bornées
        ne sont pas décrites comme un effacement externe immédiat.
      </Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Une réponse ou un point d’avancement est fourni dans les 30 jours suivant la demande.
        Ce délai de suivi ne promet pas la fin d’un dossier ayant une obligation encore
        ouverte. Le suivi distingue données effacées, conservations minimales et étapes
        restantes. Pour exercer vos droits ou signaler une difficulté : privacy@seconde.app.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>7. Vos droits (art. 27, 28.1, 30)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Vous avez le droit d&apos;accéder à vos renseignements, de les faire rectifier, d&apos;en obtenir
        une copie dans un format technologique structuré et couramment utilisé (portabilité),
        d&apos;en demander la suppression, et de retirer votre consentement à tout moment. Vous pouvez
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
        En créant un compte, vous consentez à la collecte et à l&apos;utilisation de vos
        renseignements aux fins décrites. Vous pouvez retirer votre consentement aux finalités
        facultatives (marketing, recommandations IA) à tout moment dans les Réglages.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>9. Incidents de confidentialité (art. 3.5-3.8)</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        En cas d&apos;incident de confidentialité présentant un risque de préjudice sérieux, nous
        prendrons les mesures nécessaires, tiendrons un registre de l&apos;incident et aviserons les
        personnes concernées ainsi que la Commission d&apos;accès à l&apos;information (CAI) comme l&apos;exige
        la loi.
      </Text>

      <Text variant="h3" style={styles.sectionTitle}>10. Nous joindre et plainte</Text>
      <Text variant="bodySmall" style={styles.paragraph}>
        Pour exercer vos droits ou porter plainte au sujet de vos renseignements personnels :
        privacy@seconde.app. Vous pouvez aussi
        déposer une plainte auprès de la Commission d&apos;accès à l&apos;information du Québec
        (www.cai.gouv.qc.ca).
      </Text>
      <View style={styles.infoCard}>
        <Caption>Contact confidentialité : privacy@seconde.app</Caption>
      </View>
      <View style={styles.infoCard}>
        <Text variant="body" style={styles.companyName}>Commission d&apos;accès à l&apos;information du Québec (CAI)</Text>
        <Caption>525, boul. René-Lévesque Est, bureau 2.36</Caption>
        <Caption>Québec (Québec) G1R 5S9</Caption>
        <Caption>www.cai.gouv.qc.ca</Caption>
      </View>

      <View style={styles.footer}>
        <Caption style={styles.footerText}>
          © 2026 Seconde Technologies inc. - Tous droits réservés
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
