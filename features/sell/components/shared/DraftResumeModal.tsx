import React from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { useFirebaseUserId } from '@/hooks/useFirebaseUserId';
import { auth } from '@/config/firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { ArticleDraft, getDaysUntilExpiration } from '@/features/sell/services/draftService';
import { APP_LOCALE } from '@/constants/locale';
import { colors, components, fonts, radius, spacing } from '@/constants/theme';

interface DraftResumeModalProps {
  visible: boolean;
  draft: ArticleDraft | null;
  onResume: () => void;
  onDiscard: () => void;
  /** Android back / dismissal: close without choosing. */
  onDismiss?: () => void;
}

const stepLabels: Record<number, string> = {
  1: 'Photos',
  2: 'Détails',
  3: 'Prix',
  4: 'Aperçu',
};

export default function DraftResumeModal({
  visible,
  draft,
  onResume,
  onDiscard,
  onDismiss,
}: DraftResumeModalProps) {
  const currentUid = useFirebaseUserId();
  if (!draft || draft.ownerUid !== currentUid) return null;
  // Native modal/button callbacks can arrive before React has committed the
  // auth-triggered clear. Never resume/delete using a previous owner's data.
  const resumeOwned = () => { if (auth.currentUser?.uid === draft.ownerUid) onResume(); };
  const discardOwned = () => { if (auth.currentUser?.uid === draft.ownerUid) onDiscard(); };

  const daysLeft = getDaysUntilExpiration(draft);
  // Prefer the uploaded Storage URL: it survives local cache purges, whereas
  // draft.photos points at on-device files that may have been cleaned up.
  const previewPhoto = draft.storageUrls?.[0] ?? draft.photos?.[0] ?? null;

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // The Android back button RESUMED the draft — entered the flow — instead
      // of closing the window.
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="document-text" size={28} color={colors.primary} />
            </View>
            <Text style={styles.title}>Brouillon trouvé</Text>
            <Text style={styles.subtitle}>
              Vous avez un article en cours de création
            </Text>
          </View>

          {/* Draft preview */}
          <View style={styles.previewCard}>
            {/* Photo preview */}
            {previewPhoto ? (
              <PrivateStorageImage
                testID="draft-private-preview"
                uri={previewPhoto}
                allowLocalSource
                localSourceOwnerUid={draft.ownerUid}
                style={styles.previewImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.noPhotoContainer}>
                <Ionicons name="image-outline" size={32} color={colors.muted} />
              </View>
            )}

            {/* Draft info */}
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {draft.fields?.title || 'Article sans titre'}
              </Text>

              <View style={styles.previewMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="layers-outline" size={14} color={colors.muted} />
                  <Text style={styles.metaText}>
                    Étape {draft.currentStep}/4 • {stepLabels[draft.currentStep]}
                  </Text>
                </View>

                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={14} color={colors.muted} />
                  {/* La date de création, pas celle de dernière modification :
                      c'est sur elle que court le décompte affiché juste en
                      dessous, et le balayage serveur efface les photos du
                      brouillon 14 jours après leur téléversement. */}
                  <Text style={styles.metaText}>
                    Créé le {formatDate(draft.createdAt)}
                  </Text>
                </View>

                {draft.photos.length > 0 && (
                  <View style={styles.metaItem}>
                    <Ionicons name="images-outline" size={14} color={colors.muted} />
                    <Text style={styles.metaText}>
                      {draft.photos.length} photo{draft.photos.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Expiration warning */}
          {daysLeft <= 3 && (
            <View style={styles.expirationWarning}>
              <Ionicons name="warning" size={16} color={colors.warning} />
              <Text style={styles.expirationText}>
                Expire dans {daysLeft} jour{daysLeft > 1 ? 's' : ''}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              testID="draft-resume-button"
              style={({ pressed }) => [styles.resumeButton, pressed && { opacity: 0.8 }]}
              onPress={resumeOwned}
            >
              <Ionicons name="play" size={18} color={colors.foreground} />
              <Text style={styles.resumeButtonText}>Reprendre</Text>
            </Pressable>

            <Pressable
              testID="draft-discard-button"
              style={({ pressed }) => [styles.discardButton, pressed && { opacity: 0.7 }]}
              onPress={() =>
                // Starting over deletes the draft and its photos: one tap did
                // it, with no way back.
                Alert.alert(
                  'Recommencer ?',
                  'Le brouillon et ses photos seront supprimés.',
                  [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Recommencer', style: 'destructive', onPress: discardOwned },
                  ],
                )
              }
            >
              <Text style={styles.discardButtonText}>Recommencer</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Aucune graisse numérique : Cormorant et Satoshi portent la leur, un
// fontWeight par-dessus déclenche une fausse graisse synthétique.
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
  },
  previewCard: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  noPhotoContainer: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  previewTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  previewMeta: {
    gap: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  expirationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
  },
  expirationText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.warning,
  },
  actions: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  resumeButton: {
    ...components.button.container,
    ...components.button.primary,
  },
  resumeButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  discardButton: {
    ...components.button.container,
    ...components.button.ghost,
  },
  discardButtonText: {
    ...components.button.label,
    ...components.button.ghostLabel,
  },
});
