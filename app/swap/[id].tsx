/**
 * Swap Detail Screen — Multi-Article Support
 * Design System: HTML UI Kit (Charcoal, Sage, Rust)
 * Phone 5: Demande reçue · Accepter / Refuser
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '@/contexts/AuthContext';
import {
  acceptSwap,
  declineSwap,
  cancelSwap,
  setExchangeMode,
  uploadSwapPhotos,
  confirmShipping,
  confirmReception,
  rateSwap,
  subscribeToSwap,
  getSwapItems,
} from '@/services/swapService';
import { Swap, SwapStatus, SwapExchangeMode, SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';
import SwapItemCard from '@/components/swap/SwapItemCard';
import SwapSummaryBox from '@/components/swap/SwapSummaryBox';

// Status label mappings
const STATUS_LABELS: Record<SwapStatus, string> = {
  proposed: 'Swap reçu',
  accepted: 'Accepté',
  declined: 'Refusé',
  cancelled: 'Annulé',
  photos_pending: 'Photos en attente',
  shipping: "En cours d'envoi",
  completed: 'Terminé',
  disputed: 'Litige',
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
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.sage} />
        </View>
      </SafeAreaView>
    );
  }

  if (!swap) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
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

  // Get items as arrays (support both old single-item and new multi-article)
  const senderItems = isInitiator ? getSwapItems(swap, 'receiver') : getSwapItems(swap, 'initiator');
  const myItems = isInitiator ? getSwapItems(swap, 'initiator') : getSwapItems(swap, 'receiver');
  const senderName = isInitiator ? swap.receiverName : swap.initiatorName;
  const senderImage = isInitiator ? swap.receiverImage : swap.initiatorImage;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Swap reçu</Text>
        {swap.status === 'proposed' && !isInitiator && (
          <View style={styles.badgeNew}>
            <Text style={styles.badgeNewText}>Nouveau</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* === PROPOSED STATUS: Detailed Swap Offer Layout === */}
        {swap.status === 'proposed' && !isInitiator && (
          <>
            {/* Sender Profile Row */}
            <View style={styles.senderProfile}>
              <View style={styles.avatarWrapper}>
                {senderImage ? (
                  <Image
                    source={{ uri: senderImage }}
                    style={styles.avatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarLetter}>
                      {senderName?.charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.senderInfoColumn}>
                <Text style={styles.senderUsername}>{senderName}</Text>
                <Text style={styles.senderSubtext}>Villeray · 2.8 km · ⭐ 4.9 · 22 swaps</Text>
              </View>
              <Text style={styles.senderTime}>il y a 2h</Text>
            </View>

            {/* Message Bubble (if exists) */}
            {swap.message && (
              <View style={styles.messageBubble}>
                <Text style={styles.messageText}>{swap.message}</Text>
              </View>
            )}

            {/* "Elle propose" Section */}
            <View style={styles.proposalSection}>
              <Text style={styles.sectionLabel}>Elle propose</Text>
              <View style={styles.itemsStack}>
                {senderItems.map((item, index) => (
                  <SwapItemCard
                    key={`sender-${index}`}
                    item={item}
                    variant="their"
                  />
                ))}
              </View>
            </View>

            {/* Supplement Badge (if cash top-up) */}
            {swap.cashTopUp && (
              <View style={styles.supplementBadge}>
                <Ionicons name="information-circle" size={18} color={colors.rust} />
                <Text style={styles.supplementText}>
                  Elle ajoute un complément de <Text style={styles.supplementAmount}>${swap.cashTopUp.amount}</Text> en argent
                </Text>
              </View>
            )}

            {/* "Contre mon article" Section */}
            <View style={styles.proposalSection}>
              <Text style={styles.sectionLabel}>Contre mon article</Text>
              <View style={styles.itemsStack}>
                {myItems.map((item, index) => (
                  <SwapItemCard
                    key={`my-${index}`}
                    item={item}
                    variant="mine"
                  />
                ))}
              </View>
            </View>

            {/* Summary Box */}
            <View style={styles.summaryContainer}>
              <SwapSummaryBox
                youReceive={senderItems.map(item => item.title).join(', ')}
                youGive={myItems.map(item => item.title).join(', ')}
                receivedItems={senderItems}
                givenItems={myItems}
                cashSupplement={swap.cashTopUp?.amount}
              />
            </View>
          </>
        )}

        {/* === OTHER STATUSES: Simplified Layout === */}
        {swap.status !== 'proposed' && (
          <>
            {/* Status Indicator */}
            <View style={styles.statusIndicator}>
              <View style={styles.statusIcon}>
                <Ionicons
                  name={
                    swap.status === 'completed'
                      ? 'checkmark-circle'
                      : swap.status === 'declined' || swap.status === 'cancelled'
                        ? 'close-circle'
                        : 'swap-horizontal'
                  }
                  size={20}
                  color={colors.surface}
                />
              </View>
              <Text style={styles.statusText}>
                {STATUS_LABELS[swap.status]}
              </Text>
            </View>

            {/* Sender Info */}
            <View style={styles.compactSenderCard}>
              <View style={styles.avatarSmall}>
                <Image
                  source={{ uri: senderImage || 'https://via.placeholder.com/36x36' }}
                  style={styles.avatarImageSmall}
                  contentFit="cover"
                />
              </View>
              <View style={styles.compactSenderInfo}>
                <Text style={styles.compactSenderName}>
                  {senderName}
                </Text>
                <Caption>Villeray · 2.8 km</Caption>
              </View>
            </View>

            {/* Items Display */}
            <View style={styles.itemsSection}>
              <Text style={styles.itemsSectionLabel}>Éléments de l'échange</Text>
              <View style={styles.itemsStack}>
                {senderItems.map((item, index) => (
                  <SwapItemCard
                    key={`sender-${index}`}
                    item={item}
                    variant="their"
                  />
                ))}
              </View>
              <View style={styles.swapDivider}>
                <Ionicons name="swap-horizontal" size={16} color={colors.muted} />
              </View>
              <View style={styles.itemsStack}>
                {myItems.map((item, index) => (
                  <SwapItemCard
                    key={`receiver-${index}`}
                    item={item}
                    variant="mine"
                  />
                ))}
              </View>
            </View>

            {/* Summary Box */}
            {(swap.status === 'accepted' || swap.status === 'photos_pending' || swap.status === 'shipping' || swap.status === 'completed') && (
              <View style={styles.summaryContainer}>
                <SwapSummaryBox
                  youReceive={senderItems.map(item => item.title).join(', ')}
                  youGive={myItems.map(item => item.title).join(', ')}
                  receivedItems={senderItems}
                  givenItems={myItems}
                  cashSupplement={swap.cashTopUp?.amount}
                />
              </View>
            )}
          </>
        )}

        {/* Action Buttons based on status */}
        <View style={styles.actionsSection}>
          {/* Proposed - Receiver can accept/decline */}
          {swap.status === 'proposed' && isReceiver && (
            <>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAccept}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color={colors.cream} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={20} color={colors.cream} />
                    <Text variant="body" style={styles.acceptButtonText}>
                      Accepter
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.declineBtn}
                onPress={handleDecline}
                disabled={isProcessing}
              >
                <Ionicons name="close" size={20} color={colors.rust} />
                <Text variant="body" style={styles.declineButtonText}>
                  Refuser
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Proposed - Initiator can cancel */}
          {swap.status === 'proposed' && isInitiator && (
            <TouchableOpacity
              style={styles.declineBtn}
              onPress={handleCancel}
              disabled={isProcessing}
            >
              <Text variant="body" style={styles.declineButtonText}>
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
                <Ionicons name="hand-left-outline" size={24} color={colors.sage} />
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
                <Ionicons name="send-outline" size={24} color={colors.sage} />
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
                  <ActivityIndicator size="small" color={colors.cream} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={20} color={colors.cream} />
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
              <Ionicons name="hourglass-outline" size={24} color={colors.rust} />
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
                <ActivityIndicator size="small" color={colors.cream} />
              ) : (
                <>
                  <Ionicons name="send" size={20} color={colors.cream} />
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
                <ActivityIndicator size="small" color={colors.cream} />
              ) : (
                <>
                  <Ionicons name="cube" size={20} color={colors.cream} />
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
              const otherUserId = isInitiator ? swap.receiverId : swap.initiatorId;
              router.push(`/chat/${otherUserId}`);
            }}
          >
            <Ionicons name="chatbubble-outline" size={20} color={colors.sage} />
            <Text variant="body" style={styles.contactButtonText}>
              Contacter {senderName}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Sticky Bottom Buttons — Proposed Status Only */}
      {swap.status === 'proposed' && !isInitiator && (
        <View style={styles.stickyBottom}>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={handleDecline}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={colors.charcoal} />
            ) : (
              <Text style={styles.declineBtnText}>Refuser</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={handleAccept}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color={colors.surface} />
                <Text style={styles.acceptBtnText}>Accepter le swap</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
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
    color: colors.muted,
  },

  // ============================================
  // TOP BAR (STICKY)
  // ============================================
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: 'rgba(245, 240, 232, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    color: colors.charcoal,
    textAlign: 'center',
  },
  badgeNew: {
    backgroundColor: colors.rust,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeNewText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    fontWeight: '500',
    color: colors.surface,
  },

  // ============================================
  // SCROLL VIEW & CONTENT
  // ============================================
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120, // Account for sticky bottom buttons
  },

  // ============================================
  // SENDER PROFILE
  // ============================================
  senderProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 12,
    backgroundColor: colors.surface,
  },
  avatarWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.sageLight,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.rust,
  },
  avatarLetter: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    color: colors.surface,
  },
  senderInfoColumn: {
    flex: 1,
  },
  senderUsername: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
    lineHeight: 18,
    marginBottom: 2,
  },
  senderSubtext: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 14,
  },
  senderTime: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 14,
  },

  // ============================================
  // MESSAGE BUBBLE
  // ============================================
  messageBubble: {
    marginHorizontal: 24,
    marginVertical: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.cream,
    borderRadius: 4,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '300',
    color: colors.charcoal,
  },

  // ============================================
  // PROPOSAL SECTIONS
  // ============================================
  proposalSection: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 0.15,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  itemsStack: {
    gap: 12,
  },

  // ============================================
  // SUPPLEMENT BADGE
  // ============================================
  supplementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginVertical: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(196, 96, 58, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.2)',
    borderRadius: 10,
  },
  supplementText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.charcoal,
    flex: 1,
  },
  supplementAmount: {
    fontWeight: '700',
  },

  // ============================================
  // SUMMARY BOX
  // ============================================
  summaryContainer: {
    marginHorizontal: 24,
    marginVertical: 20,
  },

  // ============================================
  // STICKY BOTTOM BUTTONS
  // ============================================
  stickyBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: 32,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    color: colors.charcoal,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 15,
    backgroundColor: colors.sage,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  acceptBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    color: colors.surface,
  },

  // ============================================
  // OTHER STATUS LAYOUTS (Not focused for redesign)
  // ============================================
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.sage,
    gap: 12,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    color: colors.cream,
  },
  declineButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    color: colors.rust,
  },
  compactSenderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatarImageSmall: {
    width: '100%',
    height: '100%',
  },
  compactSenderInfo: {
    flex: 1,
  },
  compactSenderName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
  },
  itemsSection: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  itemsSectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    letterSpacing: 0.15,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  swapDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  actionsSection: {
    marginTop: 20,
    paddingHorizontal: 24,
  },
  modeSelection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.charcoal,
    marginBottom: 16,
    textAlign: 'center',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    marginBottom: 8,
    gap: 12,
  },
  modeContent: {
    flex: 1,
  },
  modeButtonTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.charcoal,
  },
  photosSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.charcoal,
    marginBottom: 8,
    textAlign: 'center',
  },
  sectionDesc: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 100,
    gap: 8,
  },
  uploadButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    padding: 16,
    borderRadius: 8,
    gap: 12,
  },
  waitingText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 16,
    borderRadius: 8,
    gap: 12,
  },
  actionButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
  },
  ratingSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
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
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.sage,
  },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 15,
    borderRadius: 8,
    gap: 8,
    marginBottom: 8,
  },
  declineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingVertical: 15,
    borderRadius: 8,
    gap: 8,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingVertical: 15,
    borderRadius: 8,
    gap: 8,
  },
  cancelButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    color: colors.charcoal,
  },
});
