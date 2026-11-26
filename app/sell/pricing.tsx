import { auth } from '@/config/firebaseConfig';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Text,
  Pressable,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/features/sell/components/pricing/NeighborhoodBottomSheet';
import FormSectionTitle from '@/features/sell/components/shared/FormSectionTitle';
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
import draftService, { ArticleDraft, DraftPricing, DraftFields } from '@/features/sell/services/draftService';
import { PRICE_INPUT_ACCESSORY_ID } from '@/features/sell/components/pricing/PriceCard';
import { toggleNeighborhood } from '@/features/sell/utils/neighborhoods';
import { isObject, isStringArray, parseRouteParam, serializeRouteParam } from '@/features/sell/utils/routeParams';
import { track } from '@/lib/analytics';
import { colors, fonts, spacing } from '@/constants/theme';
import { SHIPPING_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { isValidArticlePrice } from '@/functions/src/shared/article';
import { automaticShippingEstimate } from '@/functions/src/shared/automaticShippingEstimate';
import { useSellActorSource, isSellActorSourceCurrent } from '@/features/sell/hooks/useSellActorSource';
import { useSellExitGuard } from '@/features/sell/hooks/useSellExitGuard';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';

export default function PricingScreen() {
  const router = useRouter();
  const [photoOwnerUid] = useState(() => auth.currentUser?.uid);
  const navigation = useNavigation();
  const { source: actorSource, getCurrentSource } = useSellActorSource();
  const [pricingSource] = useState(actorSource);
  const mounted = useRef(true);
  const inputRevision = useRef(0);
  const [renderedInputRevision, setRenderedInputRevision] = useState(0);
  const loadedDraft = useRef<ArticleDraft | null>(null);
  const draftReady = useRef<Promise<void>>(Promise.resolve());
  const advancingRef = useRef(false);
  useFocusEffect(useCallback(() => { advancingRef.current = false; }, []));
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inputRevision.current += 1; };
  }, []);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const priceInputRef = useRef<TextInput>(null);
  const neighborhoodSheetRef = useRef<NeighborhoodBottomSheetRef>(null);

  // Parse params
  const isResuming = params.resumeDraft === 'true';
  const [photos, setPhotos] = useState<string[]>(parseRouteParam(params.photos, [] as string[], isStringArray));
  const [fields, setFields] = useState<DraftFields | null>(parseRouteParam<DraftFields | null>(params.fields, null, isObject));
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(parseRouteParam<AIAnalysisResult | null>(params.aiResult, null, isObject));
  const [storageUrls, setStorageUrls] = useState<string[]>(parseRouteParam(params.storageUrls, [] as string[], isStringArray));

  // State
  const [price, setPrice] = useState('');
  // Quand le shipping est désactivé, on force le main-à-main par défaut.
  const [isHandDelivery, setIsHandDelivery] = useState(!SHIPPING_ENABLED);
  const [isShipping, setIsShipping] = useState(SHIPPING_ENABLED);
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<MeetupNeighborhood[]>([]);
  const parcelEstimate = automaticShippingEstimate({categoryIds: fields?.categoryIds ?? []});
  const packageSize = parcelEstimate.profileSize;
  const [errors, setErrors] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  // Le KeyboardAvoidingView de l'écran rétrécirait la feuille pleine page dès que
  // sa recherche ouvre le clavier : on le neutralise tant qu'elle est ouverte.
  const [isNeighborhoodSheetOpen, setIsNeighborhoodSheetOpen] = useState(false);
  const isPricingSourceCurrent = useCallback(() => mounted.current &&
    isSellActorSourceCurrent(getCurrentSource(), pricingSource), [getCurrentSource, pricingSource]);
  const assertPricingSourceCurrent = useCallback(() => {
    if (!isPricingSourceCurrent()) throw staleTradeOperation();
    draftService.assertCurrentOwner(photoOwnerUid);
  }, [isPricingSourceCurrent, photoOwnerUid]);
  const markEdited = () => {
    const next = ++inputRevision.current;
    setRenderedInputRevision(next);
  };

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      assertPricingSourceCurrent();
      const existingDraft = await draftService.loadDraft();
      assertPricingSourceCurrent();
      if (existingDraft) {
        loadedDraft.current = existingDraft;
        if (isResuming) {
          setPhotos(existingDraft.photos);
          setStorageUrls(existingDraft.storageUrls ?? []);
          setFields(existingDraft.fields);
          setAiResult(existingDraft.aiResult);
        }
        if (existingDraft.pricing) {
          if (existingDraft.pricing.price !== null) {
            setPrice(existingDraft.pricing.price.toString());
          }
          if (SHIPPING_LISTINGS_ENABLED) {
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
        }
        setIsInitialized(true);
        if (existingDraft.currentStep < 3) {
          const updated = await draftService.updateDraftStep(existingDraft, 3);
          assertPricingSourceCurrent();
          loadedDraft.current = updated;
        }
      } else {
        setIsInitialized(true);
      }
    };
    const ready = loadDraft();
    draftReady.current = ready;
    void ready.catch(() => {
      if (__DEV__) console.warn('Draft initialization interrupted');
    });
  }, [isResuming, assertPricingSourceCurrent]);

  const capturePricingOrigin = () => {
    assertPricingSourceCurrent();
    const session = captureTradeSession(photoOwnerUid!);
    const revision = renderedInputRevision;
    const draftId = loadedDraft.current?.id;
    const assertCurrent = () => {
      assertPricingSourceCurrent();
      assertTradeSessionCurrent(session);
      if (!navigation.isFocused() || inputRevision.current !== revision ||
        draftId !== undefined && loadedDraft.current?.id !== draftId) throw staleTradeOperation();
    };
    assertCurrent();
    return assertCurrent;
  };
  const persistPricing = useCallback(async (assertCurrent: () => void) => {
    assertCurrent();
    try { await draftReady.current; } catch (error) {
      assertCurrent();
      // An unsuccessful step marker must not poison a later explicit save of
      // the draft already read for this actor. Never bind an unknown draft here.
      if (!loadedDraft.current) throw error;
    }
    assertCurrent();
    // No editing is admitted before initialization; leaving that early only
    // waits for the existing draft, and must not replace its values by blanks.
    if (!isInitialized) return;
    const latest = await draftService.loadDraft();
    assertCurrent();
    if (!latest || latest.id !== loadedDraft.current?.id) throw new Error('Draft unavailable');
    const pricingData: DraftPricing = {
      price: price ? parseFloat(price) : null, isHandDelivery, isShipping,
      neighborhood: selectedNeighborhoods[0] || null,
      neighborhoods: selectedNeighborhoods, packageSize,
    };
    const updated = await draftService.updateDraftPricing(latest, pricingData);
    assertCurrent();
    loadedDraft.current = updated;
  }, [price, isHandDelivery, isShipping, selectedNeighborhoods, packageSize, isInitialized]);

  // Header, hardware back and swipe share the same owned native action.
  // The exact removal is replayed only after persistence, without a Quitter prompt.
  useSellExitGuard({ captureOrigin: capturePricingOrigin, save: persistPricing,
    hasWork: () => true, confirmExit: false,
    errorMessage: 'Réessayez avant de revenir aux détails pour conserver votre saisie.' });
  const handleBack = () => { router.back(); };

  const handlePriceChange = (value: string) => {
    if (!isInitialized || !isPricingSourceCurrent()) return;
    const cleaned = value.replace(',', '.').replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    markEdited();
    setPrice(cleaned);
  };

  const handleNeighborhoodToggle = (neighborhood: MeetupNeighborhood) => {
    if (!isInitialized || !isPricingSourceCurrent()) return;
    Keyboard.dismiss();
    const { next, capped } = toggleNeighborhood(selectedNeighborhoods, neighborhood);
    if (capped) {
      Alert.alert('10 quartiers maximum', 'Retire un quartier pour en choisir un autre.');
      return;
    }
    markEdited(); setSelectedNeighborhoods(next);
    track('sell_field_edited', {
      screen: 'sell',
      field: 'neighborhoods',
      value: neighborhood.id,
      selected_count_after: next.length,
    });
  };

  const handleNeighborhoodsConfirm = (neighborhoods: MeetupNeighborhood[]) => {
    if (!isInitialized || !isPricingSourceCurrent()) return;
    markEdited(); setSelectedNeighborhoods(neighborhoods);
    track('sell_field_edited', {
      screen: 'sell',
      field: 'neighborhoods',
      selected_count_after: neighborhoods.length,
    });
  };

  // Le prix se saisit au pavé décimal : sans ce repli, le clavier restait ouvert
  // par-dessus la feuille des quartiers.
  const openNeighborhoodSheet = () => {
    if (!isInitialized || !isPricingSourceCurrent()) return;
    Keyboard.dismiss();
    neighborhoodSheetRef.current?.show();
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];
    const priceNum = parseFloat(price);
    if (!isValidArticlePrice(priceNum)) {
      newErrors.push('Indiquez un prix entre 0,01 $ et 10 000 $, avec au plus deux décimales. Aucun arrondi automatique ne sera appliqué.');
    }
    if (!isHandDelivery && !isShipping) {
      newErrors.push('Sélectionnez au moins une option de livraison');
    }
    if (isHandDelivery && selectedNeighborhoods.length === 0) {
      newErrors.push('Sélectionnez au moins un quartier pour la remise en main propre');
    }
    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleContinue = async () => {
    if (advancingRef.current || !isInitialized || !isPricingSourceCurrent()) return;
    if (!validateForm()) {
      const missingKeys: string[] = [];
      const priceValue = parseFloat(price);
      if (!isValidArticlePrice(priceValue)) missingKeys.push(priceValue > 10000 ? 'price_too_high' : 'price_invalid');
      if (!isHandDelivery && !isShipping) missingKeys.push('no_delivery');
      if (isHandDelivery && selectedNeighborhoods.length === 0) missingKeys.push('neighborhoods_required');
      track('sell_validation_failed', {
        step: 'pricing',
        missing_fields: missingKeys,
        errors: missingKeys,
      });
      return;
    }
    advancingRef.current = true;
    let assertCurrent: (() => void) | undefined;
    try { assertCurrent = capturePricingOrigin(); await persistPricing(assertCurrent); assertCurrent(); } catch {
      advancingRef.current = false;
      try { if (!assertCurrent) return; assertCurrent(); } catch { return; }
      Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de continuer.');
      return;
    }
    if (!navigation.isFocused()) {advancingRef.current = false; return;}
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
        // Resumed here, this screen holds no photos, fields or images: the
        // preview must read them from the draft, or it showed an empty
        // article that refused to publish.
        ...(isResuming ? { resumeDraft: 'true' } : {}),
        photos: serializeRouteParam(photos),
        fields: serializeRouteParam(fields),
        pricing: serializeRouteParam({
          price: parseFloat(price),
          isHandDelivery,
          isShipping,
          neighborhood: selectedNeighborhoods[0] || null,
          neighborhoods: selectedNeighborhoods,
          packageSize,
        }),
        aiResult: aiResult ? serializeRouteParam(aiResult) : undefined,
        storageUrls: serializeRouteParam(storageUrls),
      },
    });
  };

  const priceNum = parseFloat(price);
  const hasAtLeastOneDelivery = isHandDelivery || isShipping;
  const handDeliveryValid = !isHandDelivery || selectedNeighborhoods.length > 0;
  const isFormValid =
    isValidArticlePrice(priceNum) &&
    hasAtLeastOneDelivery &&
    handDeliveryValid;

  return (
    <KeyboardAvoidingView
      testID="sell-pricing-screen"
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={!isNeighborhoodSheetOpen}
    >
      <ScreenHeader
        title="Prix & livraison"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
            if (!isInitialized || !isPricingSourceCurrent()) return;
            Keyboard.dismiss();
            const enabled = !isHandDelivery;
            markEdited(); setIsHandDelivery(enabled);
            track('sell_field_edited', { screen: 'sell', field: 'hand_delivery', enabled });
          }}
          selectedNeighborhoods={selectedNeighborhoods}
          onNeighborhoodToggle={handleNeighborhoodToggle}
          onViewMore={openNeighborhoodSheet}
        />

        {SHIPPING_LISTINGS_ENABLED && (
          <ShippingCard
            isActive={isShipping}
            onToggle={() => {
              if (!isInitialized || !isPricingSourceCurrent()) return;
              const enabled = !isShipping;
              markEdited(); setIsShipping(enabled);
              track('sell_field_edited', { screen: 'sell', field: 'shipping', enabled });
            }}
            estimate={parcelEstimate}
          />
        )}

        <FormErrors errors={errors} />
      </ScrollView>

      <SellFooter
        testID="sell-pricing-footer-cta"
        label="APERÇU"
        onPress={handleContinue}
        onInvalidPress={handleContinue}
        isValid={isFormValid}
        bottomInset={Math.max(insets.bottom, 16) - 16}
      />

      <NeighborhoodBottomSheet
        ref={neighborhoodSheetRef}
        selectedNeighborhoods={selectedNeighborhoods}
        onConfirm={handleNeighborhoodsConfirm}
        onVisibilityChange={setIsNeighborhoodSheetOpen}
      />

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={PRICE_INPUT_ACCESSORY_ID}>
          <View style={styles.accessoryBar}>
            <Pressable
              testID="sell-price-done"
              onPress={() => Keyboard.dismiss()}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              accessibilityRole="button"
            >
              <Text style={styles.accessoryText}>Terminé</Text>
            </Pressable>
          </View>
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
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: colors.surfaceWarm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  accessoryText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
});
