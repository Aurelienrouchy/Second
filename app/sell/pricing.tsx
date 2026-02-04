import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SellFlowHeader from '@/components/SellFlowHeader';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/components/NeighborhoodBottomSheet';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft, DraftPricing } from '@/services/draftService';

type PackageSize = 'small' | 'medium' | 'large';

interface PackageSizeOption {
  value: PackageSize;
  label: string;
  weight: string;
  description: string;
}

const PACKAGE_SIZES: PackageSizeOption[] = [
  {
    value: 'small',
    label: 'Petit',
    weight: '<500g',
    description: 'T-shirt, accessoires',
  },
  {
    value: 'medium',
    label: 'Moyen',
    weight: '<1kg',
    description: 'Pull, jean, robe',
  },
  {
    value: 'large',
    label: 'Grand',
    weight: '<2kg',
    description: 'Manteau, bottes, lot',
  },
];

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
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<MeetupNeighborhood | null>(null);
  const [packageSize, setPackageSize] = useState<PackageSize | null>(
    aiResult?.packageSize?.suggested || null
  );
  const [errors, setErrors] = useState<string[]>([]);

  // Track if pricing has been initialized from draft
  const [isInitialized, setIsInitialized] = useState(!isResuming);

  // Draft state
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        setDraft(existingDraft);

        // If resuming, restore pricing from draft
        if (isResuming && existingDraft.pricing) {
          console.log('[Pricing] Resuming draft, restoring pricing:', existingDraft.pricing);
          if (existingDraft.pricing.price !== null) {
            setPrice(existingDraft.pricing.price.toString());
          }
          setIsHandDelivery(existingDraft.pricing.isHandDelivery);
          setIsShipping(existingDraft.pricing.isShipping);
          setSelectedNeighborhood(existingDraft.pricing.neighborhood);
          if (existingDraft.pricing.packageSize) {
            setPackageSize(existingDraft.pricing.packageSize as PackageSize);
          }
        }
        setIsInitialized(true);

        // Update step to 3 if not already
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

  // Auto-save pricing to draft when it changes (debounced)
  useEffect(() => {
    // Don't save until pricing is initialized (prevents overwriting draft with empty state)
    if (!draft || !isInitialized) return;

    const saveToDraft = async () => {
      setSaveStatus('saving');
      try {
        const pricingData: DraftPricing = {
          price: price ? parseFloat(price) : null,
          isHandDelivery,
          isShipping,
          neighborhood: selectedNeighborhood,
          packageSize: packageSize,
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

    // Debounce save
    const timeoutId = setTimeout(saveToDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [price, isHandDelivery, isShipping, selectedNeighborhood, packageSize, draft?.id, isInitialized]);

  // AI suggested package size
  const aiSuggestedSize = aiResult?.packageSize?.suggested;

  const handlePriceChange = (value: string) => {
    // Only allow numbers and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setPrice(cleaned);
  };

  const toggleHandDelivery = () => {
    // Can't uncheck if it's the only option
    if (isHandDelivery && !isShipping) {
      Alert.alert('Erreur', 'Sélectionnez au moins une option de livraison');
      return;
    }
    setIsHandDelivery(!isHandDelivery);
    if (!isHandDelivery) {
      // Reset neighborhood when disabling
    }
  };

  const toggleShipping = () => {
    // Can't uncheck if it's the only option
    if (isShipping && !isHandDelivery) {
      Alert.alert('Erreur', 'Sélectionnez au moins une option de livraison');
      return;
    }
    setIsShipping(!isShipping);
  };

  const handleNeighborhoodSelect = (neighborhood: MeetupNeighborhood) => {
    setSelectedNeighborhood(neighborhood);
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    const priceNum = parseFloat(price);
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      newErrors.push('Entrez un prix valide');
    }

    if (!isHandDelivery && !isShipping) {
      newErrors.push('Sélectionnez au moins une option de livraison');
    }

    if (isHandDelivery && !selectedNeighborhood) {
      newErrors.push('Sélectionnez un quartier pour la remise en main propre');
    }

    if (isShipping && !packageSize) {
      newErrors.push('Sélectionnez une taille de colis');
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleContinue = () => {
    if (!validateForm()) {
      return;
    }

    router.push({
      pathname: '/sell/preview',
      params: {
        photos: JSON.stringify(photos),
        fields: JSON.stringify(fields),
        pricing: JSON.stringify({
          price: parseFloat(price),
          isHandDelivery,
          isShipping,
          neighborhood: selectedNeighborhood,
          packageSize,
        }),
        aiResult: params.aiResult,
        storageUrls: JSON.stringify(storageUrls),
      },
    });
  };

  const priceNum = parseFloat(price);
  const isFormValid =
    !isNaN(priceNum) &&
    priceNum > 0 &&
    (isHandDelivery || isShipping) &&
    (!isHandDelivery || selectedNeighborhood) &&
    (!isShipping || packageSize);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SellFlowHeader currentStep={3} confirmClose={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Price Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>💰</Text>
            <Text style={styles.sectionTitle}>Fixez votre prix</Text>
          </View>

          <TouchableOpacity
            style={styles.priceInputContainer}
            onPress={() => priceInputRef.current?.focus()}
            activeOpacity={1}
          >
            <TextInput
              ref={priceInputRef}
              style={styles.priceInput}
              value={price}
              onChangeText={handlePriceChange}
              placeholder="0"
              placeholderTextColor="#D1D5DB"
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <Text style={styles.currency}>$</Text>
          </TouchableOpacity>
        </View>

        {/* Delivery Options Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>🚚</Text>
            <Text style={styles.sectionTitle}>Options de livraison</Text>
          </View>

          {/* Hand Delivery Option */}
          <TouchableOpacity
            style={[
              styles.deliveryCard,
              isHandDelivery && styles.deliveryCardActive,
            ]}
            onPress={toggleHandDelivery}
            activeOpacity={0.7}
          >
            <View style={styles.deliveryCardHeader}>
              <View
                style={[
                  styles.checkbox,
                  isHandDelivery && styles.checkboxActive,
                ]}
              >
                {isHandDelivery && (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                )}
              </View>
              <View style={styles.deliveryCardContent}>
                <Text style={styles.deliveryCardTitle}>
                  Remise en main propre
                </Text>
                <Text style={styles.deliveryCardSubtitle}>
                  Rencontrez l'acheteur dans votre quartier
                </Text>
              </View>
            </View>

            {/* Neighborhood selector */}
            {isHandDelivery && (
              <TouchableOpacity
                style={styles.neighborhoodSelector}
                onPress={() => neighborhoodSheetRef.current?.show()}
              >
                <Ionicons name="location-outline" size={20} color="#6B7280" />
                <Text
                  style={[
                    styles.neighborhoodText,
                    !selectedNeighborhood && styles.neighborhoodPlaceholder,
                  ]}
                >
                  {selectedNeighborhood?.name || 'Choisir un quartier'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* Shipping Option */}
          <TouchableOpacity
            style={[
              styles.deliveryCard,
              isShipping && styles.deliveryCardActive,
            ]}
            onPress={toggleShipping}
            activeOpacity={0.7}
          >
            <View style={styles.deliveryCardHeader}>
              <View
                style={[styles.checkbox, isShipping && styles.checkboxActive]}
              >
                {isShipping && (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                )}
              </View>
              <View style={styles.deliveryCardContent}>
                <Text style={styles.deliveryCardTitle}>Livraison</Text>
                <Text style={styles.deliveryCardSubtitle}>
                  Mondial Relay, Colissimo, La Poste
                </Text>
              </View>
            </View>

            {/* Package size selector */}
            {isShipping && (
              <View style={styles.packageSizeContainer}>
                <Text style={styles.packageSizeLabel}>📦 Taille du colis</Text>
                <View style={styles.packageSizeCards}>
                  {PACKAGE_SIZES.map((size) => {
                    const isSelected = packageSize === size.value;
                    const isAISuggested = aiSuggestedSize === size.value;
                    return (
                      <TouchableOpacity
                        key={size.value}
                        style={[
                          styles.packageSizeCard,
                          isSelected && styles.packageSizeCardSelected,
                        ]}
                        onPress={() => setPackageSize(size.value)}
                      >
                        <Text
                          style={[
                            styles.packageSizeName,
                            isSelected && styles.packageSizeNameSelected,
                          ]}
                        >
                          {size.label}
                        </Text>
                        <Text
                          style={[
                            styles.packageSizeWeight,
                            isSelected && styles.packageSizeWeightSelected,
                          ]}
                        >
                          {size.weight}
                        </Text>
                        {isAISuggested && (
                          <View style={styles.aiSuggestedBadge}>
                            <Ionicons
                              name="sparkles"
                              size={10}
                              color="#8B5CF6"
                            />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {aiSuggestedSize && (
                  <Text style={styles.aiSuggestedText}>
                    ✨ Suggéré par l'IA
                  </Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Errors */}
        {errors.length > 0 && (
          <View style={styles.errorsContainer}>
            {errors.map((error, index) => (
              <View key={index} style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Continue button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !isFormValid && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
        >
          <Text
            style={[
              styles.continueButtonText,
              !isFormValid && styles.continueButtonTextDisabled,
            ]}
          >
            Continuer
          </Text>
        </TouchableOpacity>
      </View>

      {/* Neighborhood Bottom Sheet */}
      <NeighborhoodBottomSheet
        ref={neighborhoodSheetRef}
        onSelect={handleNeighborhoodSelect}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 24,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  priceInput: {
    fontSize: 56,
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'center',
    minWidth: 100,
    padding: 0,
  },
  currency: {
    fontSize: 36,
    fontWeight: '600',
    color: '#6B7280',
    marginLeft: 8,
  },
  deliveryCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  deliveryCardActive: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F79F24',
  },
  deliveryCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: '#F79F24',
    borderColor: '#F79F24',
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  deliveryCardSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  neighborhoodSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    marginLeft: 40,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 10,
  },
  neighborhoodText: {
    flex: 1,
    fontSize: 15,
    color: '#1F2937',
  },
  neighborhoodPlaceholder: {
    color: '#9CA3AF',
  },
  packageSizeContainer: {
    marginTop: 14,
    marginLeft: 40,
  },
  packageSizeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
  },
  packageSizeCards: {
    flexDirection: 'row',
    gap: 8,
  },
  packageSizeCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    position: 'relative',
  },
  packageSizeCardSelected: {
    backgroundColor: '#F5F3FF',
    borderColor: '#8B5CF6',
  },
  packageSizeName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 2,
  },
  packageSizeNameSelected: {
    color: '#5B21B6',
  },
  packageSizeWeight: {
    fontSize: 12,
    color: '#6B7280',
  },
  packageSizeWeightSelected: {
    color: '#7C3AED',
  },
  aiSuggestedBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#F5F3FF',
    borderRadius: 10,
    padding: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  aiSuggestedText: {
    fontSize: 12,
    color: '#8B5CF6',
    marginTop: 10,
    textAlign: 'center',
  },
  errorsContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    flex: 1,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  continueButton: {
    backgroundColor: '#F79F24',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  continueButtonTextDisabled: {
    color: '#9CA3AF',
  },
});
