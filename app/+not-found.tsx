import { Ionicons } from '@expo/vector-icons';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Introuvable', headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="compass-outline" size={56} color={colors.primary} />
          </View>
          <Text style={styles.title}>Page introuvable</Text>
          <Text style={styles.subtitle}>
            Le lien que vous avez suivi est cassé ou cette page n'existe plus.
          </Text>
          <Link href="/" asChild style={styles.link}>
            <Text style={styles.linkText}>Retourner à l'accueil</Text>
          </Link>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.serifBold ?? fonts.sans,
    fontSize: 24,
    color: colors.foreground,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
  link: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 14,
  },
  linkText: {
    fontFamily: fonts.sansMedium ?? fonts.sans,
    fontSize: 15,
    color: colors.surface,
    letterSpacing: 0.5,
  },
});
