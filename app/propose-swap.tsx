/**
 * Propose Swap Screen — Phone 4: Proposer un échange
 * Design System: HTML UI Kit (Cream, Charcoal, Sage, Rust)
 * Features: Multi-article selection, value difference calculation, optional message
 * Match: Exact HTML UI Kit design specifications
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { ArticlesService } from '@/services/articlesService';
import { proposeSwap } from '@/services/swapService';
import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text } from '@/components/ui';
import {
  SwapItemCard,
  SwapItemSelector,
  SwapSeparator,
  ValueDifferenceBox,
} from '@/components/swap';

export default function ProposeSwapScreen() {
  const {
    receiverItems: receiverItemsJson,
    partyId,
    targetArticleId,
    receiverId,
    receiverName,
    receiverImage,
  } = useLocalSearchParams<{
    receiverItems?: string;
    partyId?: string;
    targetArticleId?: string;
    receiverId?: string;
    receiverName?: string;
    receiverImage?: string;
  }>();
  const { user } = useAuth();

  // Parse receiver items from route params
  const [receiverItems, setReceiverItems] = useState<SwapItemInfo[]>([]);
  const [initiatorItems, setInitiatorItems] = useState<SwapItemInfo[]>([]);
  const [allAvailableItems, setAllAvailableItems] = useState<SwapItemInfo[]>([]);
  const [message, setMessage] = useState('');
  const [showItemSelector, setShowItemSelector] = useState(false);
  const [showReceiverSelector, setShowReceiverSelector] = useState(false);
  const [complementAmount, setComplementAmount] = useState('');
  const [complementPayer, setComplementPayer] = useState<'initiator' | 'receiver'>('initiator');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Parse receiver items from params or fetch target article
  useEffect(() => {
    if (receiverItemsJson) {
      try {
        const parsed = JSON.parse(receiverItemsJson);
        setReceiverItems(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (error) {
        if (__DEV__) console.error('Error parsing receiver items:', error);
      }
      setIsLoading(false);
    } else if (targetArticleId) {
      // Fetch the target article to pre-populate receiver items
      ArticlesService.getArticleById(targetArticleId)
        .then((article) => {
          if (article) {
            setReceiverItems([
              {
                articleId: article.id,
                title: article.title,
                price: article.price,
                imageUrl: article.images?.[0]?.url,
                brand: article.brand,
                size: article.size,
              },
            ]);
          }
        })
        .catch((error) => {
          if (__DEV__) console.error('Error fetching target article:', error);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [receiverItemsJson, targetArticleId]);

  // Load user's available items
  useEffect(() => {
    loadUserItems();
  }, [user]);

  const loadUserItems = async () => {
    if (!user) {
      return;
    }

    try {
      const articles = await ArticlesService.getUserArticles(user.id);
      const available = articles
        .filter((a) => a.isActive !== false && !a.isSold)
        .map((a) => ({
          articleId: a.id,
          title: a.title,
          price: a.price,
          imageUrl: a.images?.[0]?.url,
          brand: a.brand,
          size: a.size,
        }));
      setAllAvailableItems(available);
    } catch (error) {
      if (__DEV__) console.error('Error loading user items:', error);
    }
  };

  // Calculate total values
  const receiverTotal = useMemo(
    () => receiverItems.reduce((sum, item) => sum + item.price, 0),
    [receiverItems]
  );

  const initiatorTotal = useMemo(
    () => initiatorItems.reduce((sum, item) => sum + item.price, 0),
    [initiatorItems]
  );

  const valueDifference = useMemo(
    () => {
      const diff = receiverTotal - initiatorTotal;
      return diff > 0 ? diff : -diff;
    },
    [receiverTotal, initiatorTotal]
  );

  const receiverHasMore = receiverTotal > initiatorTotal;

  // Handle item selection from modal
  const handleSelectInitiatorItems = useCallback((articleIds: string[]) => {
    const selected = allAvailableItems.filter(item =>
      articleIds.includes(item.articleId)
    );
    setInitiatorItems(selected);
    setShowItemSelector(false);
  }, [allAvailableItems]);

  const handleSelectReceiverItems = useCallback((articleIds: string[]) => {
    const selected = allAvailableItems.filter(item =>
      articleIds.includes(item.articleId)
    );
    setReceiverItems(selected);
    setShowReceiverSelector(false);
  }, [allAvailableItems]);

  // Remove item from selections
  const handleRemoveInitiatorItem = useCallback((articleId: string) => {
    setInitiatorItems(prev =>
      prev.filter(item => item.articleId !== articleId)
    );
  }, []);

  const handleRemoveReceiverItem = useCallback((articleId: string) => {
    setReceiverItems(prev =>
      prev.filter(item => item.articleId !== articleId)
    );
  }, []);

  // Submit swap proposal
  const handleSubmit = async () => {
    if (!user || initiatorItems.length === 0 || receiverItems.length === 0) {
      Alert.alert('Erreur', 'Veuillez sélectionner des articles de part et d\'autre');
      return;
    }

    setIsSubmitting(true);
    try {
      await proposeSwap({
        initiatorId: user.id,
        initiatorName: user.displayName || 'Utilisateur',
        initiatorImage: user.profileImage,
        initiatorItems,
        receiverId: receiverId || '',
        receiverName: receiverName || '',
        receiverImage: receiverImage || '',
        receiverItems,
        message: message || undefined,
        cashTopUp: Number(complementAmount) > 0 ? { amount: Number(complementAmount), payerId: complementPayer === 'initiator' ? user.id : (receiverId || '') } : undefined,
        partyId,
      });

      Alert.alert(
        'Proposition envoyée !',
        'Ta proposition d\'échange a été envoyée avec succès.',
        [
          {
            text: 'OK',
            onPress: () => router.push('/my-swaps'),
          },
        ]
      );
    } catch (error) {
      if (__DEV__) console.error('Error proposing swap:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la proposition");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.charcoal} />
        </View>
      </SafeAreaView>
    );
  }

  const selectedInitiatorIds = initiatorItems.map(item => item.articleId);
  const selectedReceiverIds = receiverItems.map(item => item.articleId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Sticky Top Bar — padding: 16px 24px, 36x36 back button, title, gap: 16px */}
        <View style={styles.topBar}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={colors.charcoal}
            />
          </Pressable>
          <Text style={styles.topBarTitle}>Proposer un swap</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* "Leur article" section — padding: 20px 24px */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Leur article</Text>

            {receiverItems.map((item) => (
              <SwapItemCard
                key={item.articleId}
                item={item}
                variant="their"
                onRemove={() => handleRemoveReceiverItem(item.articleId)}
              />
            ))}

            <TouchableOpacity
              style={styles.addMoreButton}
              onPress={() => setShowReceiverSelector(true)}
            >
              <Text style={styles.addMoreButtonText}>+ Ajouter</Text>
            </TouchableOpacity>
          </View>

          {/* Swap Separator — line + circle + line, marginBottom: 20px */}
          <SwapSeparator />

          {/* "Mon article proposé" section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Mon article proposé</Text>

            {initiatorItems.map((item) => (
              <SwapItemCard
                key={item.articleId}
                item={item}
                variant="mine"
                onRemove={() => handleRemoveInitiatorItem(item.articleId)}
              />
            ))}

            <TouchableOpacity
              style={styles.addMoreButton}
              onPress={() => setShowItemSelector(true)}
            >
              <Text style={styles.addMoreButtonText}>+ Ajouter un article</Text>
            </TouchableOpacity>
          </View>

          {/* Value Difference Box (shows when both sides have items) */}
          {initiatorItems.length > 0 && receiverItems.length > 0 && (
            <View style={styles.valueDiffSection}>
              <View style={styles.valueDiffBox}>
                {/* Price summary row */}
                <View style={styles.priceSummaryRow}>
                  <View style={styles.priceSummaryItem}>
                    <Text style={styles.priceSummaryLabel}>Vos articles</Text>
                    <Text style={styles.priceSummaryValue}>${initiatorTotal}</Text>
                  </View>
                  <View style={styles.priceSummaryDivider} />
                  <View style={styles.priceSummaryItem}>
                    <Text style={styles.priceSummaryLabel}>Leurs articles</Text>
                    <Text style={styles.priceSummaryValue}>${receiverTotal}</Text>
                  </View>
                </View>

                {/* Difference indicator */}
                {valueDifference > 0 ? (
                  <View style={styles.diffIndicator}>
                    <Ionicons name="information-circle-outline" size={14} color={colors.rust} />
                    <Text style={styles.diffIndicatorText}>
                      {receiverHasMore
                        ? `Différence de $${valueDifference} en leur faveur`
                        : `Différence de $${valueDifference} en votre faveur`}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.diffIndicator, styles.diffIndicatorEven]}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={colors.sage} />
                    <Text style={[styles.diffIndicatorText, styles.diffIndicatorTextEven]}>
                      Valeurs équivalentes
                    </Text>
                  </View>
                )}

                {/* Cash top-up section */}
                <View style={styles.cashTopUpSection}>
                  <Text style={styles.cashTopUpTitle}>Ajouter un complément en argent</Text>

                  {/* Payer toggle */}
                  <View style={styles.payerToggleRow}>
                    <TouchableOpacity
                      style={[
                        styles.payerToggleButton,
                        complementPayer === 'initiator' && styles.payerToggleButtonActive,
                      ]}
                      onPress={() => setComplementPayer('initiator')}
                    >
                      <Text
                        style={[
                          styles.payerToggleText,
                          complementPayer === 'initiator' && styles.payerToggleTextActive,
                        ]}
                      >
                        Je paie
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.payerToggleButton,
                        complementPayer === 'receiver' && styles.payerToggleButtonActive,
                      ]}
                      onPress={() => setComplementPayer('receiver')}
                    >
                      <Text
                        style={[
                          styles.payerToggleText,
                          complementPayer === 'receiver' && styles.payerToggleTextActive,
                        ]}
                      >
                        {receiverName ? `${receiverName} paie` : 'L\'autre paie'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Amount input */}
                  <View style={styles.cashAmountRow}>
                    <Text style={styles.cashAmountDollar}>$</Text>
                    <TextInput
                      style={styles.cashAmountInput}
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      value={complementAmount}
                      onChangeText={(text) => setComplementAmount(text.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    {valueDifference > 0 && (
                      <TouchableOpacity
                        style={styles.suggestAmountButton}
                        onPress={() => setComplementAmount(String(valueDifference))}
                      >
                        <Text style={styles.suggestAmountText}>
                          Suggéré: ${valueDifference}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Message section (optionnel) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Message (optionnel)</Text>
            <TextInput
              style={styles.messageInput}
              placeholder="Salut ! Je pense que nos pièces s'échangeraient bien…"
              placeholderTextColor={colors.muted}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* Sticky Bottom CTA — padding: 16px 24px 32px, charcoal bg button, cream text */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              (initiatorItems.length === 0 || receiverItems.length === 0 || isSubmitting) &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={initiatorItems.length === 0 || receiverItems.length === 0 || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.cream} />
            ) : (
              <>
                <Ionicons
                  name="swap-horizontal"
                  size={16}
                  color={colors.cream}
                  style={styles.submitButtonIcon}
                />
                <Text style={styles.submitButtonText}>Envoyer la proposition</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Item Selector Modals */}
      <SwapItemSelector
        items={allAvailableItems}
        selectedItems={initiatorItems}
        onSelectionChange={setInitiatorItems}
        visible={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Sélectionner mes articles"
      />

      <SwapItemSelector
        items={allAvailableItems}
        selectedItems={receiverItems}
        onSelectionChange={setReceiverItems}
        visible={showReceiverSelector}
        onClose={() => setShowReceiverSelector(false)}
        title="Sélectionner l'article à recevoir"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ===== TOP BAR =====
  // padding: 16px 24px, background: rgba(245,240,232,0.95) with blur
  // border-bottom: 1px solid var(--border)
  // display: flex, align-items: center, gap: 16px
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
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
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.charcoal,
    flex: 1,
  },

  // ===== SCROLL CONTENT =====
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 120, // Space for sticky footer
  },

  // ===== SECTION LABEL =====
  // "Leur article" / "Mon article proposé" / "Message (optionnel)"
  // 10px, 0.15em, uppercase, muted, marginBottom 10px
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5, // 0.15em
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },

  // ===== SECTION CONTAINER =====
  section: {
    marginBottom: 20,
  },

  // ===== ITEM CARDS =====
  // Card: flex row, align-items center, gap 12px, padding 14px
  // border 1px solid border, borderRadius 4px, background white
  // (See SwapItemCard component for implementation)

  // ===== ADD MORE BUTTON =====
  // "+ Ajouter" button styling
  addMoreButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  addMoreButtonText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: '400',
    color: colors.charcoal,
  },

  // ===== VALUE DIFFERENCE BOX =====
  // background: rgba(196,96,58,0.07)
  // border: 1px solid rgba(196,96,58,0.2)
  // borderRadius: 4px
  // padding: 16px
  // marginBottom: 20px
  valueDiffSection: {
    marginBottom: 20,
  },
  valueDiffBox: {
    backgroundColor: 'rgba(196, 96, 58, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.2)',
    borderRadius: 4,
    padding: 16,
  },

  // Price summary row
  priceSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  priceSummaryLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 4,
  },
  priceSummaryValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    lineHeight: 24,
    color: colors.charcoal,
  },
  priceSummaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(196, 96, 58, 0.25)',
  },

  // Difference indicator
  diffIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(196, 96, 58, 0.08)',
    borderRadius: 6,
    marginBottom: 14,
  },
  diffIndicatorEven: {
    backgroundColor: 'rgba(94, 118, 89, 0.08)',
  },
  diffIndicatorText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    color: colors.rust,
  },
  diffIndicatorTextEven: {
    color: colors.sage,
  },

  // Cash top-up section
  cashTopUpSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(196, 96, 58, 0.15)',
    paddingTop: 14,
  },
  cashTopUpTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.charcoal,
    marginBottom: 10,
  },

  // Payer toggle
  payerToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  payerToggleButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerToggleButtonActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  payerToggleText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    color: colors.muted,
  },
  payerToggleTextActive: {
    color: colors.cream,
    fontFamily: fonts.sansMedium,
    fontWeight: '500',
  },

  // Amount input row
  cashAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cashAmountDollar: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '300',
    color: colors.charcoal,
  },
  cashAmountInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: '400',
    color: colors.charcoal,
    backgroundColor: colors.surface,
  },
  suggestAmountButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(196, 96, 58, 0.12)',
    borderRadius: 6,
  },
  suggestAmountText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '500',
    color: colors.rust,
  },

  // ===== MESSAGE INPUT =====
  // border 1px borderStrong, borderRadius 4px, padding 12px 14px, background white
  messageInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    color: colors.charcoal,
    minHeight: 100,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },

  // ===== STICKY FOOTER =====
  // padding: 16px 24px 32px
  // background: cream
  // border-top: 1px solid border
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: colors.charcoal,
  },
  submitButtonIcon: {
    marginRight: 4,
  },
  submitButtonDisabled: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 14,
    letterSpacing: 2.16, // 0.18em
    textTransform: 'uppercase',
    color: colors.cream,
  },
});
