import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  InputAccessoryView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/components/NeighborhoodBottomSheet';
import StepProgressBar from '@/components/sell/StepProgressBar';
import FormSectionTitle from '@/components/sell/FormSectionTitle';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft, DraftPricing } from '@/services/draftService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';

type PackageSize = 'small' | 'medium' | 'large';

interface PackageSizeOption {
  value: PackageSize;
  label: string;
  weight: string;
  description: string;
}

const PACKAGE_SIZES: PackageSizeOption[] = [
  { value: 'small', label: 'Petit', weight: '<500g', description: 'T-shirt, accessoires' },
  { value: 'medium', label: 'Moyen', weight: '<1kg', description: 'Pull, jean, robe' },
  { value: 'large', label: 'Grand', weight: '<2kg', description: 'Manteau, bottes, lot' },
];

const NEIGHBORHOOD_TAGS = ['Plateau', 'Mile End', 'Rosemont', 'Villeray'];

export default function PricingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const priceInputRef = useRef<TextInput>(null);
  const neighborhoodSheetRef = useRef<NeighborhoodBottomSheetRef>(null);

  // Parse params
  const isResuming = params.resumeDraft === 'true';
  const photos: string[] = params.photos ? JSON.parse(params.photos as string) : [];
  const fields = params.fields ? JSON.parse(params.fields as string) : {};
  const aiResult: AIAnalysisResult | null = params.aiResult
    ? JSON.parse(params.aiResult as string)
    : null;
  const storageUrls: string[] = params.storageUrls
    ? JSON.parse(params.storageUrls as string)
    : [];

  // State
  const [price, setPrice] = useState('');
  const [isHandDelivery, setIsHandDelivery] = useState(false);
  const [isShipping, setIsShipping] = useState(true);
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<MeetupNeighborhood[]>([]);
  const [packageSize, setPackageSize] = useState<PackageSize | null>(
    aiResult?.packageSize?.suggested || null
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(!isResuming);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const aiSuggestedSize = aiResult?.packageSize?.suggested;

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        setDraft(existingDraft);
        if (isResuming && existingDraft.pricing) {
          if (existingDraft.pricing.price !== null) {
            setPrice(existingDraft.pricing.price.toString());
          }
          setIsHandDelivery(!!existingDraft.pricing.isHandDelivery);
          setIsShipping(!!existingDraft.pricing.isShipping);
          // Support both legacy single neighborhood and new multi-neighborhoods
          if (existingDraft.pricing.neighborhoods?.length) {
            setSelectedNeighborhoods(existingDraft.pricing.neighborhoods);
          } else if (existingDraft.pricing.neighborhood) {
            setSelectedNeighborhoods([existingDraft.pricing.neighborhood]);
          }
          if (existingDraft.pricing.packageSize) {
            setPackageSize(existingDraft.pricing.packageSize as PackageSize);
          }
        }
        setIsInitialized(true);
        if (existingDraft.currentStep < 3) {
          const updated = await draftService.updateDraftStep(existingDraft, 3);
          setDraft(updated);
        }
      } else {
        setIsInitialized(true);
      }
    };
    loadDraft();
  }, [isResuming]);

  // Auto-save pricing
  useEffect(() => {
    if (!draft || !isInitialized) return;
    const saveToDraft = async () => {
      setSaveStatus('saving');
      try {
        const pricingData: DraftPricing = {
          price: price ? parseFloat(price) : null,
          isHandDelivery,
          isShipping,
          neighborhood: selectedNeighborhoods[0] || null,
          neighborhoods: selectedNeighborhoods,
          packageSize,
        };
        const updated = await draftService.updateDraftPricing(draft, pricingData);
        setDraft(updated);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        console.error('Failed to save draft pricing:', error);
        setSaveStatus('error');
      }
    };
    const timeoutId = setTimeout(saveToDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [price, isHandDelivery, isShipping, selectedNeighborhoods, packageSize, draft?.id, isInitialized]);

  const handlePriceChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setPrice(cleaned);
  };

  const handleBack = () => {
    router.back();
  };

  const handleNeighborhoodToggle = (neighborhood: MeetupNeighborhood) => {
    setSelectedNeighborhoods((prev) => {
      const exists = prev.some((n) => n.id === neighborhood.id);
      if (exists) {
        return prev.filter((n) => n.id !== neighborhood.id);
      }
      return [...prev, neighborhood];
    });
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];
    const priceNum = parseFloat(price);
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      newErrors.push('Entrez un prix valide');
    }
    if (!isHandDelivery && !isShipping) {
      newErrors.push('Selectionnez au moins une option de livraison');
    }
    if (isHandDelivery && selectedNeighborhoods.length === 0) {
      newErrors.push('Selectionnez au moins un quartier pour la remise en main propre');
    }
    if (isShipping && !packageSize) {
      newErrors.push('Selectionnez une taille de colis');
    }
    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleContinue = () => {
    if (!validateForm()) return;
    router.push({
      pathname: '/sell/preview',
      params: {
        photos: JSON.stringify(photos),
        fields: JSON.stringify(fields),
        pricing: JSON.stringify({
          price: parseFloat(price),
          isHandDelivery,
          isShipping,
          neighborhood: selectedNeighborhoods[0] || null,
          neighborhoods: selectedNeighborhoods,
          packageSize,
        }),
        aiResult: params.aiResult,
        storageUrls: JSON.stringify(storageUrls),
      },
    });
  };

  const priceNum = parseFloat(price);
  const hasAtLeastOneDelivery = isHandDelivery || isShipping;
  const handDeliveryValid = !isHandDelivery || selectedNeighborhoods.length > 0;
  const shippingValid = !isShipping || !!packageSize;
  const isFormValid =
    !isNaN(priceNum) &&
    priceNum > 0 &&
    hasAtLeastOneDelivery &&
    handDeliveryValid &&
    shippingValid;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Prix & livraison"
        onBack={handleBack}
        topContent={<StepProgressBar currentStep={4} />}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Price section */}
        <FormSectionTitle title="Ton prix" />

        <TouchableOpacity
          style={styles.priceCard}
          onPress={() => priceInputRef.current?.focus()}
          activeOpacity={1}
        >
          <Text style={styles.priceLabel}>Prix de vente</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceCurrency}>$</Text>
            <TextInput
              ref={priceInputRef}
              style={styles.priceInput}
              value={price}
              onChangeText={handlePriceChange}
              placeholder="0"
              placeholderTextColor={colors.border}
              keyboardType="decimal-pad"
              cursorColor={colors.rust}
              selectionColor={colors.rust}
              inputAccessoryViewID="pricing-empty"
            />
          </View>
        </TouchableOpacity>

        {/* Delivery section */}
        <View style={{ marginTop: spacing.lg }}>
          <FormSectionTitle title="Options de livraison" />
        </View>

        {/* Hand delivery card */}
        <TouchableOpacity
          style={[
            styles.deliveryCard,
            isHandDelivery && styles.deliveryCardActive,
          ]}
          onPress={() => setIsHandDelivery((prev) => !prev)}
          activeOpacity={0.8}
        >
          <View style={styles.deliveryCardHeader}>
            <View
              style={[
                styles.radioOuter,
                isHandDelivery && styles.radioOuterActive,
              ]}
            >
              {isHandDelivery && <View style={styles.radioInner} />}
            </View>
            <View style={styles.deliveryCardContent}>
              <Text style={styles.deliveryCardTitle}>Remise en main propre</Text>
              <Text style={styles.deliveryCardSubtitle}>
                Rencontre dans un quartier de Montreal
              </Text>
            </View>
          </View>

          {/* Neighborhood tags */}
          {isHandDelivery && (
            <View style={styles.deliveryBody}>
              <Text style={styles.deliveryBodyLabel}>
                Quartiers ({selectedNeighborhoods.length} sélectionné{selectedNeighborhoods.length > 1 ? 's' : ''})
              </Text>
              <View style={styles.deliveryTagRow}>
                {NEIGHBORHOOD_TAGS.map((tag) => {
                  const isActive = selectedNeighborhoods.some((n) => n.name === tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[
                        styles.deliveryTag,
                        isActive && styles.deliveryTagActive,
                      ]}
                      onPress={() =>
                        handleNeighborhoodToggle({
                          id: tag.toLowerCase().replace(/\s/g, '-'),
                          name: tag,
                          borough: '',
                        } as MeetupNeighborhood)
                      }
                    >
                      <Text
                        style={[
                          styles.deliveryTagText,
                          isActive && styles.deliveryTagTextActive,
                        ]}
                      >
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.deliveryTagMore}
                  onPress={() => neighborhoodSheetRef.current?.show()}
                >
                  <Text style={styles.deliveryTagMoreText}>Voir plus</Text>
                  <Ionicons name="chevron-forward" size={12} color={colors.muted} />
                </TouchableOpacity>
              </View>
              {/* Show extra selected neighborhoods not in quick tags */}
              {selectedNeighborhoods.filter((n) => !NEIGHBORHOOD_TAGS.includes(n.name)).length > 0 && (
                <View style={[styles.deliveryTagRow, { marginTop: 6 }]}>
                  {selectedNeighborhoods
                    .filter((n) => !NEIGHBORHOOD_TAGS.includes(n.name))
                    .map((n) => (
                      <TouchableOpacity
                        key={n.id}
                        style={[styles.deliveryTag, styles.deliveryTagActive]}
                        onPress={() => handleNeighborhoodToggle(n)}
                      >
                        <Text style={[styles.deliveryTagText, styles.deliveryTagTextActive]}>
                          {n.name}
                        </Text>
                        <Ionicons name="close" size={10} color={colors.cream} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ))}
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Shipping card */}
        <TouchableOpacity
          style={[
            styles.deliveryCard,
            isShipping && styles.deliveryCardActive,
          ]}
          onPress={() => setIsShipping((prev) => !prev)}
          activeOpacity={0.8}
        >
          <View style={styles.deliveryCardHeader}>
            <View
              style={[
                styles.radioOuter,
                isShipping && styles.radioOuterActive,
              ]}
            >
              {isShipping && <View style={styles.radioInner} />}
            </View>
            <View style={styles.deliveryCardContent}>
              <Text style={styles.deliveryCardTitle}>Expedition postale</Text>
              <Text style={styles.deliveryCardSubtitle}>
                Envoi par Postes Canada
              </Text>
            </View>
          </View>

          {/* Package size selector */}
          {isShipping && (
            <View style={styles.deliveryBody}>
              <Text style={styles.deliveryBodyLabel}>Format du colis</Text>
              <View style={styles.packageSizeCards}>
                {PACKAGE_SIZES.map((size) => {
                  const isSelected = packageSize === size.value;
                  return (
                    <TouchableOpacity
                      key={size.value}
                      style={[
                        styles.packageCard,
                        isSelected && styles.packageCardSelected,
                      ]}
                      onPress={() => setPackageSize(size.value)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.packageName,
                          isSelected && styles.packageNameSelected,
                        ]}
                      >
                        {size.label}
                      </Text>
                      <Text style={styles.packageWeight}>
                        {size.weight}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {aiSuggestedSize && (
                <View style={styles.aiSuggestRow}>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                  <Text style={styles.aiSuggestText}>Format suggere selon l'article</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Errors */}
        {errors.length > 0 && (
          <View style={styles.errorsContainer}>
            {errors.map((error, index) => (
              <View key={index} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !isFormValid && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.continueButtonText,
              !isFormValid && styles.continueButtonTextDisabled,
            ]}
          >
            APERCU
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={isFormValid ? colors.cream : colors.muted}
          />
        </TouchableOpacity>
      </View>

      <NeighborhoodBottomSheet
        ref={neighborhoodSheetRef}
        selectedNeighborhoods={selectedNeighborhoods}
        onSelect={handleNeighborhoodToggle}
        multiSelect
      />

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="pricing-empty">
          <View />
        </InputAccessoryView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },
  // Price card — matches design .price-input-wrap
  priceCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    marginBottom: 14,
    overflow: 'hidden',
  },
  priceLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  priceInput: {
    fontFamily: fonts.sans,
    fontSize: 38,
    fontWeight: '600',
    color: colors.rust,
    minWidth: 60,
    padding: 0,
  },
  priceCurrency: {
    fontFamily: fonts.sans,
    fontSize: 24,
    fontWeight: '600',
    color: colors.muted,
    marginRight: 4,
  },
  // Delivery cards — matches design .delivery-option
  deliveryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  deliveryCardActive: {
    borderColor: colors.charcoal,
  },
  deliveryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  // Radio button — matches design .delivery-radio (round)
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  radioOuterActive: {
    borderColor: colors.charcoal,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.charcoal,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  deliveryCardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  // Delivery body — matches design .delivery-option-body (padding: 0 16px 14px 48px)
  deliveryBody: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 14,
  },
  deliveryBodyLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  // Delivery tags — matches design .delivery-tag
  deliveryTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  deliveryTag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 2,
  },
  deliveryTagActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  deliveryTagText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
  },
  deliveryTagTextActive: {
    color: colors.cream,
  },
  deliveryTagMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deliveryTagMoreText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.2,
  },
  // Package cards — matches design .pkg-option
  packageSizeCards: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 0,
  },
  packageCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  packageCardSelected: {
    borderColor: colors.charcoal,
    backgroundColor: 'rgba(26,24,20,0.03)',
  },
  packageName: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.charcoal,
    marginBottom: 2,
  },
  packageNameSelected: {
    color: colors.charcoal,
  },
  packageWeight: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.36,
  },
  // AI suggestion row below package options
  aiSuggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
  aiSuggestText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  // Errors
  errorsContainer: {
    backgroundColor: colors.dangerLight,
    borderRadius: 4,
    padding: 14,
    gap: 8,
    marginTop: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.danger,
    flex: 1,
  },
  // Footer — matches design .sticky-footer (cream bg, 24px horizontal)
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: 10,
  },
  continueButtonDisabled: {
    backgroundColor: colors.border,
  },
  continueButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
  },
  continueButtonTextDisabled: {
    color: colors.muted,
  },
});
