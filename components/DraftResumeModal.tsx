import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ArticleDraft, getDaysUntilExpiration } from '@/services/draftService';

interface DraftResumeModalProps {
  visible: boolean;
  draft: ArticleDraft | null;
  onResume: () => void;
  onDiscard: () => void;
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
}: DraftResumeModalProps) {
  if (!draft) return null;

  const daysLeft = getDaysUntilExpiration(draft);
  const hasPhotos = draft.photos.length > 0;
  const previewPhoto = hasPhotos ? draft.photos[0] : null;

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
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
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="document-text" size={28} color="#F79F24" />
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
              <Image
                source={{ uri: previewPhoto }}
                style={styles.previewImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.noPhotoContainer}>
                <Ionicons name="image-outline" size={32} color="#9CA3AF" />
              </View>
            )}

            {/* Draft info */}
            <View style={styles.previewInfo}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {draft.fields?.title || 'Article sans titre'}
              </Text>

              <View style={styles.previewMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="layers-outline" size={14} color="#6B7280" />
                  <Text style={styles.metaText}>
                    Étape {draft.currentStep}/4 • {stepLabels[draft.currentStep]}
                  </Text>
                </View>

                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={14} color="#6B7280" />
                  <Text style={styles.metaText}>
                    {formatDate(draft.updatedAt)}
                  </Text>
                </View>

                {draft.photos.length > 0 && (
                  <View style={styles.metaItem}>
                    <Ionicons name="images-outline" size={14} color="#6B7280" />
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
              <Ionicons name="warning" size={16} color="#D97706" />
              <Text style={styles.expirationText}>
                Expire dans {daysLeft} jour{daysLeft > 1 ? 's' : ''}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.resumeButton}
              onPress={onResume}
              activeOpacity={0.8}
            >
              <Ionicons name="play" size={18} color="#FFFFFF" />
              <Text style={styles.resumeButtonText}>Reprendre</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.discardButton}
              onPress={onDiscard}
              activeOpacity={0.7}
            >
              <Text style={styles.discardButtonText}>Recommencer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  previewCard: {
    flexDirection: 'row',
    marginHorizontal: 20,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    gap: 12,
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  noPhotoContainer: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  previewMeta: {
    gap: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
  },
  expirationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginHorizontal: 20,
    padding: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
  },
  expirationText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#D97706',
  },
  actions: {
    padding: 20,
    gap: 10,
  },
  resumeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F79F24',
    paddingVertical: 14,
    borderRadius: 12,
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  discardButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  discardButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '500',
  },
});
