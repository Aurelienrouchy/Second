import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  InputAccessoryView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/components/NeighborhoodBottomSheet';
import FormSectionTitle from '@/components/sell/FormSectionTitle';
import { ScreenHeader } from '@/components/ui';
import {
  PriceCard,
  HandDeliveryCard,
  ShippingCard,
  FormErrors,
  SellFooter,
} from '@/features/sell';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft, DraftPricing } from '@/services/draftService';
import { track } from '@/lib/analytics';
import { colors, spacing } from '@/constants/theme';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

type PackageSize = 'small' | 'medium' | 'large';

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
  // Quand le shipping est désactivé, on force le main-à-main par défaut.
  const [isHandDelivery, setIsHandDelivery] = useState(!SHIPPING_ENABLED);
  const [isShipping, setIsShipping] = useState(SHIPPING_ENABLED);
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<MeetupNeighborhood[]>([]);
  const [packageSize, setPackageSize] = useState<PackageSize | null>(
    aiResult?.packageSize?.suggested || null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(!isResuming);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

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
          if (SHIPPING_ENABLED) {
            setIsHandDelivery(!!existingDraft.pricing.isHandDelivery);
            setIsShipping(!!existingDraft.pricing.isShipping);
          } else {
            // Shipping désactivé : un brouillon legacy en shipping est ramené au main-à-main.
            setIsHandDelivery(true);
            setIsShipping(false);
          }
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
      } catch (error) {
        if (__DEV__) console.error('Failed to save draft pricing:', error);
      }
    };
    const timeoutId = setTimeout(saveToDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [price, isHandDelivery, isShipping, selectedNeighborhoods, packageSize, draft?.id, isInitialized]);

  const handleBack = () => {
    Alert.alert(
      'Quitter ?',
      'Tes modifications seront sauvegardées dans le brouillon.',
      [
        {
          text: 'Annuler',
          style: 'cancel',
          onPress: () =>
            track('sell_exit_prompted', {
              flow_step: 'pricing',
              confirmed_leave: false,
              photo_count: photos.length,
              has_price: !!price,
            }),
        },
        {
          text: 'Quitter',
          onPress: () => {
            track('sell_exit_prompted', {
              flow_step: 'pricing',
              confirmed_leave: true,
              photo_count: photos.length,
              has_price: !!price,
            });
            router.back();
          },
        },
      ],
    );
  };

  const handlePriceChange = (value: string) => {
    const cleaned = value.replace(',', '.').replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setPrice(cleaned);
  };

  const handleNeighborhoodToggle = (neighborhood: MeetupNeighborhood) => {
    let countAfter = 0;
    setSelectedNeighborhoods((prev) => {
      const exists = prev.some((n) => n.id === neighborhood.id);
      const next = exists ? prev.filter((n) => n.id !== neighborhood.id) : [...prev, neighborhood];
      countAfter = next.length;
      return next;
    });
    track('sell_field_edited', {
      screen: 'sell',
      field: 'neighborhoods',
      value: neighborhood.id,
      selected_count_after: countAfter,
    });
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];
    const priceNum = parseFloat(price);
    if (!price || isNaN(priceNum) || priceNum < 0.01) {
      newErrors.push('Entrez un prix valide');
    } else if (priceNum > 10000) {
      newErrors.push('Le prix maximum est de 10 000 $');
    }
    if (!isHandDelivery && !isShipping) {
      newErrors.push('Sélectionnez au moins une option de livraison');
    }
    if (isHandDelivery && selectedNeighborhoods.length === 0) {
      newErrors.push('Sélectionnez au moins un quartier pour la remise en main propre');
    }
    if (isShipping && !packageSize) {
      newErrors.push('Sélectionnez une taille de colis');
    }
    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleContinue = () => {
    if (!validateForm()) {
      const missingKeys: string[] = [];
      const priceValue = parseFloat(price);
      if (!price || isNaN(priceValue) || priceValue < 0.01) missingKeys.push('price_invalid');
      else if (priceValue > 10000) missingKeys.push('price_too_high');
      if (!isHandDelivery && !isShipping) missingKeys.push('no_delivery');
      if (isHandDelivery && selectedNeighborhoods.length === 0) missingKeys.push('neighborhoods_required');
      if (isShipping && !packageSize) missingKeys.push('package_size_required');
      track('sell_validation_failed', {
        step: 'pricing',
        missing_fields: missingKeys,
        errors: missingKeys,
      });
      return;
    }
    track('sell_step_completed', {
      step: 'pricing',
      price_cents: Math.round(parseFloat(price) * 100),
      is_hand_delivery: isHandDelivery,
      is_shipping: isShipping,
      neighborhoods_count: selectedNeighborhoods.length,
      package_size: packageSize ?? undefined,
    });
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
    priceNum <= 10000 &&
    hasAtLeastOneDelivery &&
    handDeliveryValid &&
    shippingValid;

  return (
    <KeyboardAvoidingView
      testID="sell-pricing-screen"
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Prix & livraison"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FormSectionTitle title="Ton prix" />

        <PriceCard
          price={price}
          onPriceChange={handlePriceChange}
          inputRef={priceInputRef}
        />

        <View style={{ marginTop: spacing.lg }}>
          <FormSectionTitle title="Options de livraison" />
        </View>

        <HandDeliveryCard
          isActive={isHandDelivery}
          onToggle={() => {
            const enabled = !isHandDelivery;
            setIsHandDelivery(enabled);
            track('sell_field_edited', { screen: 'sell', field: 'hand_delivery', enabled });
          }}
          selectedNeighborhoods={selectedNeighborhoods}
          onNeighborhoodToggle={handleNeighborhoodToggle}
          onViewMore={() => neighborhoodSheetRef.current?.show()}
        />

        {SHIPPING_ENABLED && (
          <ShippingCard
            isActive={isShipping}
            onToggle={() => {
              const enabled = !isShipping;
              setIsShipping(enabled);
              track('sell_field_edited', { screen: 'sell', field: 'shipping', enabled });
            }}
            packageSize={packageSize}
            onPackageSizeSelect={(size) => {
              setPackageSize(size);
              track('sell_field_edited', {
                screen: 'sell',
                field: 'package_size',
                value: size,
                matched_ai_suggestion: size === aiResult?.packageSize?.suggested,
              });
            }}
            aiSuggestedSize={aiResult?.packageSize?.suggested}
          />
        )}

        <FormErrors errors={errors} />
      </ScrollView>

      <SellFooter
        testID="sell-pricing-footer-cta"
        label="APERÇU"
        onPress={handleContinue}
        isValid={isFormValid}
        bottomInset={Math.max(insets.bottom, 16) - 16}
      />

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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },
});
