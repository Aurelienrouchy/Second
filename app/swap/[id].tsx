/**
 * Swap Detail Screen
 * Design System: Luxe Français + Street Energy
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '@/contexts/AuthContext';
import {
  getSwap,
  acceptSwap,
  declineSwap,
  cancelSwap,
  setExchangeMode,
  uploadSwapPhotos,
  confirmShipping,
  confirmReception,
  rateSwap,
  subscribeToSwap,
} from '@/services/swapService';
import { Swap, SwapStatus, SwapExchangeMode } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label } from '@/components/ui';

const STATUS_LABELS: Record<SwapStatus, string> = {
  proposed: 'En attente',
  accepted: 'Accepté',
  declined: 'Refusé',
  cancelled: 'Annulé',
  photos_pending: 'Photos en attente',
  shipping: "En cours d'envoi",
  completed: 'Terminé',
  disputed: 'Litige',
};

const STATUS_COLORS: Record<SwapStatus, string> = {
  proposed: colors.warning,
  accepted: colors.success,
  declined: colors.danger,
  cancelled: colors.muted,
  photos_pending: colors.primary,
  shipping: '#5856D6',
  completed: colors.success,
  disputed: colors.danger,
};

export default function SwapDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [swap, setSwap] = useState<Swap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!id) return;

    // Subscribe to real-time updates
    const unsubscribe = subscribeToSwap(id, (swapData) => {
      setSwap(swapData);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [id]);

  const isInitiator = swap?.initiatorId === user?.id;
  const isReceiver = swap?.receiverId === user?.id;

  const handleAccept = async () => {
    if (!id) return;

    setIsProcessing(true);
    try {
      await acceptSwap(id);
    } catch (error) {
      console.error('Error accepting swap:', error);
      Alert.alert('Erreur', "Impossible d'accepter l'échange");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    Alert.alert(
      "Refuser l'échange",
      'Êtes-vous sûr de vouloir refuser cette proposition ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            setIsProcessing(true);
            try {
              await declineSwap(id);
            } catch (error) {
              console.error('Error declining swap:', error);
              Alert.alert('Erreur', "Impossible de refuser l'échange");
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleCancel = async () => {
    Alert.alert(
      "Annuler l'échange",
      'Êtes-vous sûr de vouloir annuler cette proposition ?',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            setIsProcessing(true);
            try {
              await cancelSwap(id);
              router.back();
            } catch (error) {
              console.error('Error cancelling swap:', error);
              Alert.alert('Erreur', "Impossible d'annuler l'échange");
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleSetExchangeMode = async (mode: SwapExchangeMode) => {
    if (!id) return;

    setIsProcessing(true);
    try {
      await setExchangeMode(id, mode);
    } catch (error) {
      console.error('Error setting exchange mode:', error);
      Alert.alert('Erreur', "Impossible de définir le mode d'échange");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUploadPhotos = async () => {
    if (!id || !user) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 4,
      });

      if (result.canceled) return;

      setIsProcessing(true);

      // In a real app, upload images to Firebase Storage first
      // For now, just use the local URIs as placeholders
      const photoUrls = result.assets.map((asset) => asset.uri);

      await uploadSwapPhotos(id, user.id, photoUrls);
      Alert.alert('Photos envoyées', "Tes photos ont été ajoutées à l'échange.");
    } catch (error) {
      console.error('Error uploading photos:', error);
      Alert.alert('Erreur', "Impossible d'envoyer les photos");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmShipping = async () => {
    if (!id || !user) return;

    Alert.alert("Confirmer l'envoi", 'As-tu bien envoyé ton article ?', [
      { text: 'Non', style: 'cancel' },
      {
        text: 'Oui, envoyé !',
        onPress: async () => {
          setIsProcessing(true);
          try {
            await confirmShipping(id, user.id);
          } catch (error) {
            console.error('Error confirming shipping:', error);
            Alert.alert('Erreur', "Impossible de confirmer l'envoi");
          } finally {
            setIsProcessing(false);
          }
        },
      },
    ]);
  };

  const handleConfirmReception = async () => {
    if (!id || !user) return;

    Alert.alert('Confirmer la réception', "As-tu bien reçu l'article ?", [
      { text: 'Non', style: 'cancel' },
      {
        text: 'Oui, reçu !',
        onPress: async () => {
          setIsProcessing(true);
          try {
            await confirmReception(id, user.id);
          } catch (error) {
            console.error('Error confirming reception:', error);
            Alert.alert('Erreur', 'Impossible de confirmer la réception');
          } finally {
            setIsProcessing(false);
          }
        },
      },
    ]);
  };

  const handleRate = async (score: number) => {
    if (!id || !user) return;

    setIsProcessing(true);
    try {
      await rateSwap(id, user.id, score);
      Alert.alert('Merci !', 'Ta note a été enregistrée.');
    } catch (error) {
      console.error('Error rating swap:', error);
      Alert.alert('Erreur', "Impossible d'enregistrer la note");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Échange' }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!swap) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Échange' }} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
          <Text variant="body" style={styles.errorText}>
            Échange non trouvé
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasUploadedPhotos = isInitiator ? !!swap.initiatorPhotos : !!swap.receiverPhotos;

  const hasConfirmedShipping = isInitiator
    ? !!swap.initiatorShippedAt
    : !!swap.receiverShippedAt;

  const hasConfirmedReception = isInitiator
    ? !!swap.initiatorReceivedAt
    : !!swap.receiverReceivedAt;

  const hasRated = isInitiator ? !!swap.initiatorRating : !!swap.receiverRating;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Échange',
          headerBackTitle: 'Retour',
        }}
      />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Status Banner */}
        <View
          style={[styles.statusBanner, { backgroundColor: STATUS_COLORS[swap.status] }]}
        >
          <Ionicons
            name={
              swap.status === 'completed'
                ? 'checkmark-circle'
                : swap.status === 'declined' || swap.status === 'cancelled'
                  ? 'close-circle'
                  : 'swap-horizontal'
            }
            size={24}
            color={colors.white}
          />
          <Text variant="body" style={styles.statusText}>
            {STATUS_LABELS[swap.status]}
          </Text>
        </View>

        {/* Items Comparison */}
        <View style={styles.itemsComparison}>
          <ItemCard
            title={isInitiator ? 'Ton article' : 'Son article'}
            item={swap.initiatorItem}
            userName={swap.initiatorName}
          />

          <View style={styles.swapIcon}>
            <Ionicons name="swap-horizontal" size={20} color={colors.primary} />
          </View>

          <ItemCard
            title={isInitiator ? 'Son article' : 'Ton article'}
            item={swap.receiverItem}
            userName={swap.receiverName}
          />
        </View>

        {/* Cash Top-up */}
        {swap.cashTopUp && (
          <View style={styles.cashTopUpCard}>
            <Ionicons name="cash-outline" size={20} color={colors.success} />
            <Text variant="body" style={styles.cashTopUpText}>
              + {swap.cashTopUp.amount}€ (payé par{' '}
              {swap.cashTopUp.payerId === user?.id ? 'toi' : "l'autre"})
            </Text>
          </View>
        )}

        {/* Message */}
        {swap.message && (
          <View style={styles.messageCard}>
            <Label style={styles.messageLabel}>Message</Label>
            <Text variant="body" style={styles.messageText}>
              {swap.message}
            </Text>
          </View>
        )}

        {/* Action Buttons based on status */}
        <View style={styles.actionsSection}>
          {/* Proposed - Receiver can accept/decline */}
          {swap.status === 'proposed' && isReceiver && (
            <>
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={handleAccept}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={20} color={colors.white} />
                    <Text variant="body" style={styles.acceptButtonText}>
                      Accepter
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.declineButton}
                onPress={handleDecline}
                disabled={isProcessing}
              >
                <Ionicons name="close" size={20} color={colors.danger} />
                <Text variant="body" style={styles.declineButtonText}>
                  Refuser
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Proposed - Initiator can cancel */}
          {swap.status === 'proposed' && isInitiator && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              disabled={isProcessing}
            >
              <Text variant="body" style={styles.cancelButtonText}>
                Annuler la proposition
              </Text>
            </TouchableOpacity>
          )}

          {/* Accepted - Choose exchange mode */}
          {swap.status === 'accepted' && !swap.exchangeMode && (
            <View style={styles.modeSelection}>
              <Text variant="h3" style={styles.modeTitle}>
                Comment voulez-vous échanger ?
              </Text>

              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => handleSetExchangeMode('hand_delivery')}
                disabled={isProcessing}
              >
                <Ionicons name="hand-left-outline" size={24} color={colors.primary} />
                <View style={styles.modeContent}>
                  <Text variant="body" style={styles.modeButtonTitle}>
                    En main propre
                  </Text>
                  <Caption>Rencontrez-vous pour échanger</Caption>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => handleSetExchangeMode('shipping')}
                disabled={isProcessing}
              >
                <Ionicons name="send-outline" size={24} color={colors.primary} />
                <View style={styles.modeContent}>
                  <Text variant="body" style={styles.modeButtonTitle}>
                    Envoi postal
                  </Text>
                  <Caption>Envoyez-vous mutuellement les articles</Caption>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>
          )}

          {/* Photos Pending - Upload photos */}
          {swap.status === 'photos_pending' && !hasUploadedPhotos && (
            <View style={styles.photosSection}>
              <Text variant="h3" style={styles.sectionTitle}>
                Envoie des photos de ton article
              </Text>
              <Caption style={styles.sectionDesc}>
                Prends 2-4 photos de l'article avant de l'envoyer
              </Caption>

              <TouchableOpacity
                style={styles.uploadButton}
                onPress={handleUploadPhotos}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={20} color={colors.white} />
                    <Text variant="body" style={styles.uploadButtonText}>
                      Ajouter des photos
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Photos uploaded - waiting for other */}
          {swap.status === 'photos_pending' && hasUploadedPhotos && (
            <View style={styles.waitingCard}>
              <Ionicons name="hourglass-outline" size={24} color={colors.warning} />
              <Text variant="body" style={styles.waitingText}>
                En attente des photos de l'autre participant
              </Text>
            </View>
          )}

          {/* Shipping - Confirm shipping */}
          {swap.status === 'shipping' && !hasConfirmedShipping && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleConfirmShipping}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="send" size={20} color={colors.white} />
                  <Text variant="body" style={styles.actionButtonText}>
                    J'ai envoyé mon article
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Shipping - Confirm reception */}
          {swap.status === 'shipping' && hasConfirmedShipping && !hasConfirmedReception && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleConfirmReception}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="cube" size={20} color={colors.white} />
                  <Text variant="body" style={styles.actionButtonText}>
                    J'ai reçu l'article
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Completed - Rate */}
          {swap.status === 'completed' && !hasRated && (
            <View style={styles.ratingSection}>
              <Text variant="h3" style={styles.sectionTitle}>
                Comment s'est passé l'échange ?
              </Text>
              <View style={styles.ratingButtons}>
                {[1, 2, 3, 4, 5].map((score) => (
                  <TouchableOpacity
                    key={score}
                    style={styles.ratingButton}
                    onPress={() => handleRate(score)}
                    disabled={isProcessing}
                  >
                    <Ionicons name="star" size={32} color="#FFD700" />
                    <Caption style={styles.ratingScore}>{score}</Caption>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Contact Button */}
        {swap.status !== 'declined' && swap.status !== 'cancelled' && (
          <TouchableOpacity
            style={styles.contactButton}
            onPress={() => {
              // Navigate to chat with the other user
              const otherUserId = isInitiator ? swap.receiverId : swap.initiatorId;
              router.push(`/chat/${otherUserId}`);
            }}
          >
            <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
            <Text variant="body" style={styles.contactButtonText}>
              Contacter {isInitiator ? swap.receiverName : swap.initiatorName}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Item Card Component
 */
function ItemCard({
  title,
  item,
  userName,
}: {
  title: string;
  item: { articleId: string; title: string; price: number; imageUrl?: string };
  userName: string;
}) {
  return (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => router.push(`/article/${item.articleId}`)}
    >
      <Label style={styles.itemLabel}>{title}</Label>
      <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
      <Text variant="caption" style={styles.itemTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text variant="body" style={styles.itemPrice}>
        {item.price}€
      </Text>
      <Caption>{userName}</Caption>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    color: colors.foregroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['2xl'],
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  statusText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  itemsComparison: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  itemCard: {
    flex: 1,
    alignItems: 'center',
  },
  itemLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  itemImage: {
    width: 100,
    height: 100,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundSecondary,
    marginBottom: spacing.sm,
  },
  itemTitle: {
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: 4,
  },
  itemPrice: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: 4,
  },
  swapIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: spacing.sm,
  },
  cashTopUpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  cashTopUpText: {
    color: colors.success,
    fontFamily: fonts.sansMedium,
  },
  messageCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  messageLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  messageText: {
    color: colors.foreground,
    lineHeight: 22,
  },
  actionsSection: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  declineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  declineButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.danger,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  cancelButtonText: {
    color: colors.danger,
  },
  modeSelection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  modeTitle: {
    color: colors.foreground,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  modeContent: {
    flex: 1,
  },
  modeButtonTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  photosSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  sectionTitle: {
    color: colors.foreground,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  sectionDesc: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    gap: spacing.sm,
  },
  uploadButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  waitingText: {
    flex: 1,
    color: colors.warning,
    fontFamily: fonts.sansMedium,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  actionButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  ratingSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  ratingButton: {
    alignItems: 'center',
  },
  ratingScore: {
    marginTop: 4,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
});
