/**
 * Help & FAQ Settings
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';
import { Button } from '@/components/ui';

const FAQ_ITEMS = [
  {
    icon: 'bag-add-outline' as const,
    question: 'Comment vendre un article ?',
    answer: 'Appuyez sur le bouton "Vendre" au centre de la barre de navigation, ajoutez des photos et une description.',
  },
  {
    icon: 'airplane-outline' as const,
    question: 'Comment fonctionnent les frais de port ?',
    answer: 'L\'acheteur paie les frais de port. Vous recevez un bordereau d\'envoi prépayé.',
  },
  {
    icon: 'cash-outline' as const,
    question: 'Quand suis-je payé ?',
    answer: 'L\'argent est disponible dans votre porte-monnaie une fois que l\'acheteur a validé la réception de l\'article.',
  },
  {
    icon: 'swap-horizontal-outline' as const,
    question: 'Comment fonctionne le Swap ?',
    answer: 'Le Swap permet d\'échanger des articles avec d\'autres utilisateurs sans utiliser d\'argent.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    question: 'Comment sécuriser mon compte ?',
    answer: 'Activez la vérification email et utilisez un mot de passe fort unique à Seconde.',
  },
];

interface FAQItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  question: string;
  answer: string;
}

const FAQItem = ({ icon, question, answer }: FAQItemProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={styles.faqItem}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.faqHeader}>
        <View style={styles.faqIconContainer}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <Text variant="body" style={styles.question}>{question}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.muted}
        />
      </View>
      {expanded && (
        <View style={styles.answerContainer}>
          <Caption style={styles.answer}>{answer}</Caption>
        </View>
      )}
    </TouchableOpacity>
  );
};

export default function HelpSettingsScreen() {
  const router = useRouter();

  const handleContact = async () => {
    const email = 'support@seconde.app';
    const subject = encodeURIComponent('Demande de support - Seconde App');
    const body = encodeURIComponent('Bonjour,\n\nJe vous contacte concernant...\n\n');
    const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        Alert.alert(
          'Email',
          'Vous pouvez nous contacter à support@seconde.app',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert(
        'Erreur',
        'Impossible d\'ouvrir l\'application email',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Aide' }} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
          <Text variant="bodySmall" style={styles.infoText}>
            Trouvez des réponses à vos questions ou contactez notre équipe de support.
          </Text>
        </View>

        {/* FAQ Section */}
        <Label style={styles.sectionHeader}>Questions fréquentes</Label>
        <View style={styles.faqList}>
          {FAQ_ITEMS.map((item, index) => (
            <FAQItem
              key={index}
              icon={item.icon}
              question={item.question}
              answer={item.answer}
            />
          ))}
        </View>

        {/* Contact Section */}
        <Label style={styles.sectionHeader}>Besoin d'aide ?</Label>
        <View style={styles.contactSection}>
          <View style={styles.contactInfo}>
            <View style={styles.contactIconContainer}>
              <Ionicons name="mail-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.contactTextContainer}>
              <Text variant="body" style={styles.contactTitle}>Contactez-nous</Text>
              <Caption>Notre équipe répond généralement sous 24h</Caption>
            </View>
          </View>
          <Button
            variant="primary"
            fullWidth
            onPress={handleContact}
            leftIcon={<Ionicons name="send-outline" size={18} color={colors.white} />}
            style={styles.contactButton}
          >
            Nous contacter
          </Button>
        </View>

        {/* Additional Resources */}
        <View style={styles.resourcesBox}>
          <Ionicons name="book-outline" size={20} color={colors.foregroundSecondary} />
          <Text variant="bodySmall" style={styles.resourcesText}>
            Pour plus d'informations, consultez nos Conditions Générales et notre Politique de Confidentialité dans la section "À propos".
          </Text>
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
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  faqList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  faqIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  question: {
    flex: 1,
    fontFamily: fonts.sansMedium,
  },
  answerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingLeft: 68, // Align with question text
  },
  answer: {
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  contactSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  contactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  contactIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  contactTextContainer: {
    flex: 1,
  },
  contactTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  contactButton: {
    marginTop: spacing.sm,
  },
  resourcesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.borderLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  resourcesText: {
    flex: 1,
    color: colors.foregroundSecondary,
  },
});
