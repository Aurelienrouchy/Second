/**
 * Propose Swap Screen
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
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import {
  getSwapParty,
  getPartyItems,
  proposeSwap,
} from '@/services/swapService';
import { ArticlesService } from '@/services/articlesService';
import { SwapParty, SwapPartyItem, Article } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label } from '@/components/ui';

export default function ProposeSwapScreen() {
  const { partyId, targetItemId, targetArticleId } = useLocalSearchParams<{
    partyId: string;
    targetItemId: string;
    targetArticleId: string;
  }>();
  const { user } = useAuth();

  const [party, setParty] = useState<SwapParty | null>(null);
  const [targetItem, setTargetItem] = useState<SwapPartyItem | null>(null);
  const [targetArticle, setTargetArticle] = useState<Article | null>(null);
  const [myItems, setMyItems] = useState<SwapPartyItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<SwapPartyItem | null>(null);
  const [message, setMessage] = useState('');
  const [cashTopUp, setCashTopUp] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [partyId, targetItemId, user]);

  const loadData = async () => {
    if (!partyId || !targetItemId || !user) return;

    try {
      const [partyData, itemsData, articleData] = await Promise.all([
        getSwapParty(partyId),
        getPartyItems(partyId),
        targetArticleId ? ArticlesService.getArticleById(targetArticleId) : null,
      ]);

      setParty(partyData);

      // Find target item
      const target = itemsData.find((item) => item.id === targetItemId);
      setTargetItem(target || null);
      setTargetArticle(articleData);

      // Get user's items in this party
      const userItems = itemsData.filter((item) => item.sellerId === user.id);
      setMyItems(userItems);

      // Pre-select first item if only one
      if (userItems.length === 1) {
        setSelectedItem(userItems[0]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateValueDifference = (): number => {
    if (!selectedItem || !targetItem) return 0;
    return targetItem.price - selectedItem.price;
  };

  const isWithinRange = (): boolean => {
    if (!selectedItem || !targetItem) return false;
    const diff = Math.abs(calculateValueDifference());
    const threshold = targetItem.price * 0.2; // ±20%
    return diff <= threshold;
  };

  const handleSubmit = async () => {
    if (!user || !selectedItem || !targetItem || !party) {
      Alert.alert('Erreur', 'Veuillez sélectionner un article à échanger');
      return;
    }

    // Get full article data for selected item
    const selectedArticle = await ArticlesService.getArticleById(selectedItem.articleId);
    if (!selectedArticle) {
      Alert.alert('Erreur', 'Article non trouvé');
      return;
    }

    setIsSubmitting(true);
    try {
      const cashAmount = parseFloat(cashTopUp) || 0;

      await proposeSwap(
        user.id,
        user.displayName || 'Utilisateur',
        user.profileImage,
        selectedArticle,
        targetItem.sellerId,
        targetItem.sellerName,
        targetItem.sellerImage,
        targetArticle || {
          id: targetItem.articleId,
          title: targetItem.title,
          price: targetItem.price,
          images: targetItem.imageUrl ? [{ url: targetItem.imageUrl }] : [],
        } as Article,
        message || undefined,
        cashAmount > 0 ? { amount: cashAmount, payerId: user.id } : undefined,
        party.id
      );

      Alert.alert(
        'Proposition envoyée !',
        `${targetItem.sellerName} va recevoir ta proposition d'échange.`,
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error) {
      console.error('Error proposing swap:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la proposition");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Proposer un échange' }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!targetItem) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Proposer un échange' }} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
          <Text variant="body" style={styles.errorText}>Article non trouvé</Text>
        </View>
      </SafeAreaView>
    );
  }

  const valueDiff = calculateValueDifference();
  const withinRange = isWithinRange();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Proposer un échange',
          headerBackTitle: 'Retour',
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Target Item */}
          <View style={styles.section}>
            <Label style={styles.sectionTitle}>Article souhaité</Label>
            <View style={styles.targetCard}>
              <Image
                source={{ uri: targetItem.imageUrl }}
                style={styles.targetImage}
              />
              <View style={styles.targetInfo}>
                <Text variant="body" style={styles.targetTitle}>{targetItem.title}</Text>
                <Text variant="h3" style={styles.targetPrice}>{targetItem.price}€</Text>
                <View style={styles.sellerRow}>
                  {targetItem.sellerImage ? (
                    <Image
                      source={{ uri: targetItem.sellerImage }}
                      style={styles.sellerAvatar}
                    />
                  ) : (
                    <View style={styles.sellerAvatarPlaceholder}>
                      <Ionicons name="person" size={12} color={colors.muted} />
                    </View>
                  )}
                  <Caption>{targetItem.sellerName}</Caption>
                </View>
              </View>
            </View>
          </View>

          {/* Swap Arrow */}
          <View style={styles.swapArrowContainer}>
            <View style={styles.swapArrow}>
              <Ionicons name="swap-vertical" size={24} color={colors.primary} />
            </View>
          </View>

          {/* My Items Selection */}
          <View style={styles.section}>
            <Label style={styles.sectionTitle}>Ton article à échanger</Label>

            {myItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="shirt-outline" size={40} color={colors.muted} />
                <Caption style={styles.emptyText}>
                  Tu n'as pas d'articles dans cette party.
                </Caption>
                <TouchableOpacity
                  style={styles.addItemButton}
                  onPress={() =>
                    router.replace({
                      pathname: '/swap-party/[id]',
                      params: { id: partyId },
                    })
                  }
                >
                  <Text variant="body" style={styles.addItemButtonText}>Ajouter un article</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.itemsContainer}
              >
                {myItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.itemCard,
                      selectedItem?.id === item.id && styles.itemCardSelected,
                    ]}
                    onPress={() => setSelectedItem(item)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.itemImage}
                    />
                    <Text variant="caption" style={styles.itemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="body" style={styles.itemPrice}>{item.price}€</Text>
                    {selectedItem?.id === item.id && (
                      <View style={styles.checkmark}>
                        <Ionicons name="checkmark" size={16} color={colors.white} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Value Difference Info */}
          {selectedItem && (
            <View style={styles.section}>
              <View
                style={[
                  styles.valueDiffCard,
                  withinRange ? styles.valueDiffGood : styles.valueDiffWarning,
                ]}
              >
                <Ionicons
                  name={withinRange ? 'checkmark-circle' : 'alert-circle'}
                  size={24}
                  color={withinRange ? colors.success : colors.warning}
                />
                <View style={styles.valueDiffContent}>
                  {valueDiff === 0 ? (
                    <Text variant="body" style={styles.valueDiffText}>
                      Les articles ont la même valeur !
                    </Text>
                  ) : (
                    <>
                      <Text variant="body" style={styles.valueDiffText}>
                        Différence de valeur : {Math.abs(valueDiff)}€
                      </Text>
                      <Caption style={styles.valueDiffHint}>
                        {valueDiff > 0
                          ? `L'article souhaité vaut ${valueDiff}€ de plus`
                          : `Ton article vaut ${Math.abs(valueDiff)}€ de plus`}
                      </Caption>
                    </>
                  )}
                  {!withinRange && (
                    <Text variant="caption" style={styles.valueDiffWarningText}>
                      Hors de la plage ±20% recommandée
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Cash Top-up (optional) */}
          {selectedItem && valueDiff > 0 && (
            <View style={styles.section}>
              <Label style={styles.sectionTitle}>
                Ajouter une compensation (optionnel)
              </Label>
              <View style={styles.cashInputContainer}>
                <TextInput
                  style={styles.cashInput}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  value={cashTopUp}
                  onChangeText={setCashTopUp}
                  keyboardType="numeric"
                  maxLength={4}
                />
                <Text variant="h2" style={styles.cashCurrency}>€</Text>
              </View>
              <Caption style={styles.cashHint}>
                Suggéré : {valueDiff}€ pour équilibrer l'échange
              </Caption>
            </View>
          )}

          {/* Message */}
          <View style={styles.section}>
            <Label style={styles.sectionTitle}>Message (optionnel)</Label>
            <TextInput
              style={styles.messageInput}
              placeholder="Ajoute un message pour ton échange..."
              placeholderTextColor={colors.muted}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!selectedItem || isSubmitting) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedItem || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="swap-horizontal" size={20} color={colors.white} />
                <Text variant="body" style={styles.submitButtonText}>Proposer l'échange</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    paddingBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  targetCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  targetImage: {
    width: 100,
    height: 100,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundSecondary,
  },
  targetInfo: {
    flex: 1,
    marginLeft: spacing.sm,
    justifyContent: 'center',
  },
  targetTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: 4,
  },
  targetPrice: {
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sellerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
  },
  sellerAvatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapArrowContainer: {
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  swapArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  addItemButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
  },
  addItemButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  itemsContainer: {
    paddingVertical: 4,
  },
  itemCard: {
    width: 120,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  itemCardSelected: {
    borderColor: colors.primary,
  },
  itemImage: {
    width: '100%',
    height: 120,
    backgroundColor: colors.backgroundSecondary,
  },
  itemTitle: {
    color: colors.foreground,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  itemPrice: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  checkmark: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  valueDiffCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  valueDiffGood: {
    backgroundColor: colors.successLight,
  },
  valueDiffWarning: {
    backgroundColor: colors.warningLight,
  },
  valueDiffContent: {
    flex: 1,
  },
  valueDiffText: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  valueDiffHint: {
    marginTop: 4,
  },
  valueDiffWarningText: {
    color: colors.warning,
    fontFamily: fonts.sansMedium,
    marginTop: 4,
  },
  cashInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  cashInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    paddingVertical: spacing.md,
  },
  cashCurrency: {
    color: colors.foreground,
  },
  cashHint: {
    marginTop: spacing.sm,
  },
  messageInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    fontFamily: fonts.sansRegular,
    color: colors.foreground,
    minHeight: 100,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  footer: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    backgroundColor: colors.muted,
  },
  submitButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
});
