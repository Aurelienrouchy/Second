import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  Text,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams, useNavigation, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/BrandSelectionSheet';
import ConditionSelector, { ConditionValue } from '@/features/sell/components/details/ConditionSelector';
import FormSectionTitle from '@/features/sell/components/shared/FormSectionTitle';
import FormFieldGroup from '@/features/sell/components/shared/FormFieldGroup';
import { ScreenHeader } from '@/components/ui';
import { ArticleChildSafetyFields } from '@/components/ArticleChildSafetyFields';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';
import {
  PhotoStripPreview,
  TextareaField,
  FieldRow,
  ChipSelector,
  SellFooter,
} from '@/features/sell';
import { AIAnalysisResult, CONDITION_DISPLAY, ConditionId } from '@/types/ai';
import { colors as dataColors, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { articleRequiresSize, getSizesForCategory } from '@/data/sizes';
import { getCategoryInfoFromIds } from '@/data/categories-v2';
import draftService, { ArticleDraft, DraftFields } from '@/features/sell/services/draftService';
import { aiFilledFields } from '@/features/sell/utils/aiBadges';
import { isObject, isStringArray, parseRouteParam, serializeRouteParam } from '@/features/sell/utils/routeParams';
import { getListingDeclarationErrors } from '@/features/sell/utils/listingValidation';
import type { SizeSystem } from '@/types/article';
import { articleHygieneRequirement, evaluateArticleHygieneInput, type ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';
import { track } from '@/lib/analytics';
import { auth } from '@/config/firebaseConfig';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';

// Lift the sticky footer to sit spacing.md (16) above the keyboard when open;
// keyboard.height is bottom-anchored, so blending against the safe-area inset
// gives the closed-state inset and the open-state float without a jump.

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: ConditionValue | '';
  conditionConfirmed: boolean;
  childSafetyDeclaration?: ArticleChildSafetyDraft | null;
  hygieneDeclaration?: ArticleHygieneDeclarationInput | null;
  hygieneKind?: ArticleHygieneDeclarationInput['kind'] | null;
  colors: string[];
  materials: string[];
  size: string | null;
  sizeSystem: SizeSystem;
  brand: string | null;
}

export default function DetailsScreen() {
  const router = useRouter();
  const [photoOwnerUid] = useState(() => auth.currentUser?.uid);
  const navigation = useNavigation();
  const advancingRef = useRef(false);
  useFocusEffect(useCallback(() => { advancingRef.current = false; }, []));
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const keyboard = useAnimatedKeyboard();
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));

  // Parse params
  const isResuming = params.resumeDraft === 'true';
  const photosFromParams = parseRouteParam(params.photos, [] as string[], isStringArray);
  const aiResult = parseRouteParam<AIAnalysisResult | null>(params.aiResult, null, isObject);
  const aiFilled = aiFilledFields(aiResult);
  const storageUrlsFromParams = parseRouteParam(params.storageUrls, [] as string[], isStringArray);

  const [photos, setPhotos] = useState<string[]>(photosFromParams);
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);

  const getConditionDisplay = (conditionId?: ConditionId): ConditionValue | null => {
    if (!conditionId) return null;
    return (CONDITION_DISPLAY[conditionId] || null) as ConditionValue | null;
  };

  const [fields, setFields] = useState<EditedFields>({
    title: aiResult?.title || '',
    description: aiResult?.description || '',
    categoryIds: aiResult?.category?.categoryPath || [],
    categoryDisplay: {
      icon: aiResult?.category?.icon || '',
      name: aiResult?.category?.displayName || '',
      context: aiResult?.category?.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
    },
    condition: '',
    conditionConfirmed: false,
    hygieneDeclaration: null,
    hygieneKind: null,
    colors: aiResult?.colors?.colorIds || (aiResult?.colors?.primaryColorId ? [aiResult.colors.primaryColorId] : []),
    materials: aiResult?.materials?.materialIds || (aiResult?.materials?.primaryMaterialId ? [aiResult.materials.primaryMaterialId] : []),
    size: aiResult?.size?.normalized || aiResult?.size?.detected || null,
    sizeSystem: 'EU',
    brand: aiResult?.brand?.detected || null,
  });

  const [isInitialized, setIsInitialized] = useState(!isResuming);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      draftService.assertCurrentOwner(photoOwnerUid);
      const existingDraft = await draftService.loadDraft();
      draftService.assertCurrentOwner(photoOwnerUid);
      if (existingDraft) {
        setDraft(existingDraft);
        // The draft's fields win over the analysis passed in params: they are
        // the seller's own edits, which the exit alert promises to keep.
        // Hydrating only on resume lost them on a back-and-forth.
        if (existingDraft.fields) {
          setFields({
            title: existingDraft.fields.title,
            description: existingDraft.fields.description,
            categoryIds: existingDraft.fields.categoryIds,
            categoryDisplay: existingDraft.fields.categoryDisplay,
            condition: existingDraft.fields.conditionConfirmed === true ? existingDraft.fields.condition as ConditionValue : '',
            conditionConfirmed: existingDraft.fields.conditionConfirmed === true,
            childSafetyDeclaration: existingDraft.fields.childSafetyDeclaration ?? null,
            hygieneDeclaration: existingDraft.fields.hygieneDeclaration ?? null,
            hygieneKind: existingDraft.fields.hygieneKind ?? existingDraft.fields.hygieneDeclaration?.kind ?? null,
            colors: existingDraft.fields.colors ?? (existingDraft.fields.color ? [existingDraft.fields.color] : []),
            materials: existingDraft.fields.materials ?? (existingDraft.fields.material ? [existingDraft.fields.material] : []),
            size: existingDraft.fields.size ?? null,
            sizeSystem: existingDraft.fields.sizeSystem ?? 'EU',
            brand: existingDraft.fields.brand ?? null,
          });
        }
        if (isResuming) {
          if (existingDraft.photos.length > 0) setPhotos(existingDraft.photos);
          if (existingDraft.storageUrls?.length) setStorageUrls(existingDraft.storageUrls);
        }
        setIsInitialized(true);
        if (existingDraft.currentStep < 2) {
          const updated = await draftService.updateDraftStep(existingDraft, 2);
          setDraft(updated);
        }
      } else {
        setIsInitialized(true);
      }
    };
    void loadDraft().catch(() => {
      if (__DEV__) console.warn('Draft initialization interrupted');
    });
  }, [isResuming, photoOwnerUid]);

  const draftId = draft?.id;
  const persistFields = useCallback(async () => {
    draftService.assertCurrentOwner(photoOwnerUid);
    const latest = await draftService.loadDraft();
    draftService.assertCurrentOwner(photoOwnerUid);
    if (!latest) throw new Error('Draft unavailable');
    const draftFields: DraftFields = {
      title: fields.title, description: fields.description,
      categoryIds: fields.categoryIds, categoryDisplay: fields.categoryDisplay,
      condition: fields.condition, colors: fields.colors, materials: fields.materials,
      brands: fields.brand ? [fields.brand] : [], size: fields.size, brand: fields.brand,
      conditionConfirmed: fields.conditionConfirmed,
      childSafetyDeclaration: fields.childSafetyDeclaration,
      hygieneDeclaration: fields.hygieneDeclaration ?? null,
      hygieneKind: fields.hygieneKind ?? null,
      sizeSystem: fields.sizeSystem,
    };
    const updated = await draftService.updateDraftFields(latest, draftFields);
    setDraft(updated);
  }, [fields, photoOwnerUid]);

  // Auto-save while editing; navigation also waits for a final save.
  useEffect(() => {
    if (!draftId || !isInitialized) return;
    const timeoutId = setTimeout(() => {
      void persistFields().catch(() => {
        if (__DEV__) console.error('Failed to save draft fields');
      });
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [draftId, isInitialized, persistFields]);

  // Bottom sheet refs
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);

  const updateField = <K extends keyof EditedFields>(key: K, value: EditedFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleCategorySelect = useCallback((categoryIds: string[]) => {
    // Resolve the French labels from the category tree (same shape as the AI
    // path) — never derive the name from the raw id suffix (e.g. "solid").
    const info = getCategoryInfoFromIds(categoryIds);
    const aiCatLast = aiResult?.category?.categoryPath?.[aiResult.category.categoryPath.length - 1];
    track('sell_field_edited', {
      screen: 'sell',
      field: 'category',
      value: categoryIds[categoryIds.length - 1],
      matched_ai_suggestion: !!aiCatLast && categoryIds[categoryIds.length - 1] === aiCatLast,
    });
    setFields((prev) => ({
      ...prev,
      categoryIds,
      hygieneDeclaration: null,
      hygieneKind: null,
      childSafetyDeclaration: null,
      categoryDisplay: {
        icon: info?.icon || '',
        name: info?.displayName || 'Article',
        context: info?.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
      },
      // The size grid depends on the category (getSizesForCategory). A size
      // detected for the previous category is no longer guaranteed valid.
      size: null,
    }));
  }, []);

  // Allows the back action to proceed once the user confirmed the leave alert,
  // so the beforeRemove guard does not re-trigger the alert in a loop.
  const allowLeaveRef = useRef(false);

  // Intercept native back (iOS swipe-back + Android hardware button) in addition
  // to the header back button, so leaving never silently bypasses the draft alert.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // Publication réussie : le brouillon est déjà supprimé, pas d'alerte parasite.
      if (allowLeaveRef.current || draftService.wasPublished) return;
      e.preventDefault();
      Alert.alert(
        'Quitter ?',
        'Tes modifications seront sauvegardées dans le brouillon.',
        [
          {
            text: 'Annuler',
            style: 'cancel',
            onPress: () =>
              track('sell_exit_prompted', {
                flow_step: 'details',
                confirmed_leave: false,
                photo_count: photos.length,
              }),
          },
          {
            text: 'Quitter',
            onPress: async () => {
              try { await persistFields(); } catch {
                Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter.');
                return;
              }
              track('sell_exit_prompted', {
                flow_step: 'details',
                confirmed_leave: true,
                photo_count: photos.length,
              });
              allowLeaveRef.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, persistFields, photos.length]);

  const handleBack = () => {
    router.back();
  };

  const handleContinue = async () => {
    if (advancingRef.current) return;
    // Same gate as isFormValid below — keep details/preview validation aligned
    // so the footer's disabled state and the action never diverge.
    const missing: string[] = [];
    const missingKeys: string[] = [];
    // 3 characters, like the preview and the server: a shorter title passed
    // here and was only refused at publish time.
    if (fields.title.trim().length < 3) { missing.push('Le titre (3 caractères minimum)'); missingKeys.push('title'); }
    if (fields.categoryIds.length === 0) { missing.push('La catégorie'); missingKeys.push('category'); }
    for (const error of getListingDeclarationErrors(fields)) {
      missing.push(error.message);
      missingKeys.push(error.key);
    }
    if (missing.length > 0) {
      track('sell_validation_failed', {
        step: 'details',
        missing_fields: missingKeys,
        errors: missingKeys,
      });
      Alert.alert('Informations manquantes', `${missing.join('\n')}`);
      return;
    }
    advancingRef.current = true;
    try { await persistFields(); } catch {
      advancingRef.current = false;
      Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de continuer.');
      return;
    }
    if (!navigation.isFocused()) {advancingRef.current = false; return;}
    track('sell_step_completed', {
      step: 'details',
      category_ids: fields.categoryIds,
      has_brand: !!fields.brand,
      has_size: !!fields.size,
      colors_count: fields.colors.length,
      materials_count: fields.materials.length,
      ai_used: !!aiResult,
    });
    router.push({
      pathname: '/sell/pricing',
      params: {
        photos: serializeRouteParam(photos),
        fields: serializeRouteParam(fields),
        aiResult: aiResult ? serializeRouteParam(aiResult) : undefined,
        storageUrls: serializeRouteParam(storageUrls),
      },
    });
  };

  const handleColorToggle = useCallback((colorId: string) => {
    let countAfter = 0;
    setFields((prev) => {
      const newColors = prev.colors.includes(colorId)
        ? prev.colors.filter((c) => c !== colorId)
        : [...prev.colors, colorId];
      countAfter = newColors.length;
      return { ...prev, colors: newColors };
    });
    track('sell_field_edited', {
      screen: 'sell',
      field: 'colors',
      value: colorId,
      selected_count_after: countAfter,
    });
  }, [setFields]);

  const handleMaterialToggle = useCallback((matId: string) => {
    let countAfter = 0;
    setFields((prev) => {
      const newMaterials = prev.materials.includes(matId)
        ? prev.materials.filter((m) => m !== matId)
        : [...prev.materials, matId];
      countAfter = newMaterials.length;
      return { ...prev, materials: newMaterials };
    });
    track('sell_field_edited', {
      screen: 'sell',
      field: 'materials',
      value: matId,
      selected_count_after: countAfter,
    });
  }, [setFields]);

  const isFormValid = fields.title.trim().length >= 3 && fields.categoryIds.length > 0 && getListingDeclarationErrors(fields).length === 0;
  const requiresSize = articleRequiresSize(fields.categoryIds);
  const hygieneRequirement = articleHygieneRequirement(fields.categoryIds);
  const hygieneDecision = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration);
  const hygieneIsMixed = hygieneRequirement === 'mixed_underwear' || hygieneRequirement === 'mixed_cosmetic';
  const hygieneKind = hygieneRequirement === 'underwear' || hygieneRequirement === 'cosmetic'
    ? hygieneRequirement : fields.hygieneKind;
  const hygieneConfirmation = hygieneKind === 'underwear'
    ? 'Je confirme que ce sous-vêtement n’a jamais été porté.'
    : 'Je confirme que ce cosmétique est neuf, encore scellé et n’a jamais été ouvert.';
  const brandLabel = fields.brand || null;

  // Chip data
  const allColorItems = getColorItems();
  const allMaterialItems = getMaterialItems();
  const allSizeItems = getSizesForCategory(fields.categoryIds, fields.sizeSystem).map((s) => ({
    value: s,
    label: s,
  }));

  const aiColorIds = aiResult?.colors?.colorIds || [];
  const aiMaterialIds = aiResult?.materials?.materialIds || [];

  const resolveColorLabel = useCallback(
    (colorId: string): string => {
      const colorData = dataColors.find(
        (c) => c.id === colorId || c.name.toLowerCase() === colorId.toLowerCase(),
      );
      if (colorData) return colorData.name;
      const colorItem = allColorItems.find((c) => c.value === colorId);
      return colorItem?.label || colorId;
    },
    [allColorItems],
  );

  return (
    <View testID="sell-details-screen" style={styles.container}>
      <ScreenHeader
        title="Détails"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PhotoStripPreview ownerUid={draft?.ownerUid ?? photoOwnerUid} photos={storageUrls.length === photos.length && storageUrls.length > 0 ? storageUrls : photos} />

        <ArticleChildSafetyFields categoryIds={fields.categoryIds} value={fields.childSafetyDeclaration} disabled={!isInitialized} onChange={childSafetyDeclaration => {if (advancingRef.current) return; try {draftService.assertCurrentOwner(photoOwnerUid); setFields(previous => ({...previous, childSafetyDeclaration}));} catch { /* No choice from an old draft session. */ }}} />
        <FormSectionTitle title="Essentiel" />

        <TextareaField
          testID="sell-title-input"
          label="Titre"
          value={fields.title}
          onChangeText={(text) => updateField('title', text)}
          placeholder="Ex: Robe d'été fleurie Zara"
          maxLength={80}
          hasAiConfidence={aiFilled.title}
        />

        <TextareaField
          testID="sell-description-input"
          label="Description"
          value={fields.description}
          onChangeText={(text) => updateField('description', text)}
          placeholder="Coupe, matière, mesures utiles et particularités de votre article..."
          maxLength={500}
          hasAiConfidence={aiFilled.description}
          multiline
          numberOfLines={4}
        />

        <FormFieldGroup>
          <FieldRow
            testID="sell-category-selector"
            label="CATÉGORIE"
            value={fields.categoryDisplay.name || null}
            hasAiConfidence={aiFilled.category}
            onPress={() => categorySheetRef.current?.show()}
          />
          <ConditionSelector
            value={fields.condition || null}
            onChange={(value) => {
              setFields(prev => ({ ...prev, condition: value, conditionConfirmed: true }));
              track('sell_field_edited', {
                screen: 'sell',
                field: 'condition',
                value,
                matched_ai_suggestion: value === getConditionDisplay(aiResult?.condition?.conditionId),
                ai_confidence: aiResult?.condition?.confidence?.level,
              });
            }}
          />
        </FormFieldGroup>

        {hygieneRequirement !== 'none' && hygieneRequirement !== 'invalid' && (
          <>
            <FormSectionTitle title="Règle d’hygiène" />
            <Text style={styles.guidance}>Seuls les sous-vêtements jamais portés et les cosmétiques neufs encore scellés sont admis. Votre déclaration sera visible par les acheteurs.</Text>
            {hygieneIsMixed && (
              <View style={styles.declarationChoices} accessibilityRole="radiogroup" accessibilityLabel="Nature de l’article">
                {([
                  { kind: hygieneRequirement === 'mixed_underwear' ? 'underwear' : 'cosmetic', label: hygieneRequirement === 'mixed_underwear' ? 'C’est un sous-vêtement' : 'C’est un cosmétique' },
                  { kind: 'not_applicable', label: hygieneRequirement === 'mixed_underwear' ? 'C’est un autre article, pas un sous-vêtement' : 'C’est un accessoire ou un autre article, pas un cosmétique' },
                ] as const).map(choice => (
                  <Pressable key={choice.kind} accessibilityRole="radio"
                    accessibilityState={{ checked: fields.hygieneKind === choice.kind }}
                    style={[styles.declarationChoice, fields.hygieneKind === choice.kind && styles.declarationChoiceSelected]}
                    onPress={() => setFields(prev => ({ ...prev, hygieneKind: choice.kind,
                      hygieneDeclaration: choice.kind === 'not_applicable' ? { schemaVersion: 1, kind: 'not_applicable' } : null }))}>
                    <Text style={styles.declarationChoiceText}>{choice.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {(hygieneKind === 'underwear' || hygieneKind === 'cosmetic') && (
              <Pressable accessibilityRole="checkbox" accessibilityLabel={hygieneConfirmation}
                accessibilityState={{ checked: fields.hygieneDeclaration?.kind === hygieneKind }}
                style={[styles.declarationChoice, fields.hygieneDeclaration?.kind === hygieneKind && styles.declarationChoiceSelected]}
                onPress={() => setFields(prev => ({ ...prev,
                  hygieneDeclaration: prev.hygieneDeclaration?.kind === hygieneKind ? null
                    : hygieneKind === 'underwear' ? { schemaVersion: 1, kind: 'underwear', neverWorn: true }
                      : { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true } }))}>
                <Text style={styles.declarationChoiceText}>{hygieneConfirmation}</Text>
              </Pressable>
            )}
            {!hygieneDecision.allowed && <Text accessibilityRole="alert" style={styles.guidance}>{hygieneDecision.message}</Text>}
          </>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <FormSectionTitle title="Caractéristiques" />
        </View>

        <FormFieldGroup>
          <FieldRow
            label="MARQUE"
            value={brandLabel}
            onPress={() => brandSheetRef.current?.show()}
          />
          <FieldRow
            label={requiresSize ? 'TAILLE' : 'TAILLE (FACULTATIVE)'}
            value={fields.size ? `${fields.size} ${fields.sizeSystem}` : null}
            hasAiConfidence={aiFilled.size}
            onPress={() => sizeSheetRef.current?.show()}
          />
        </FormFieldGroup>
        {!requiresSize && (
          <Pressable testID="sell-size-not-applicable" style={styles.declarationChoice} onPress={() => updateField('size', null)} accessibilityRole="button">
            <Text style={styles.declarationChoiceText}>Taille inconnue ou non applicable</Text>
          </Pressable>
        )}

        <ChipSelector
          label="Couleur"
          selectedValues={fields.colors}
          aiSuggestedIds={aiColorIds}
          allItems={allColorItems}
          hasAiConfidence={aiFilled.colors}
          onToggle={handleColorToggle}
          onViewAll={() => colorSheetRef.current?.show()}
          resolveLabel={resolveColorLabel}
        />

        <ChipSelector
          label="Matière"
          selectedValues={fields.materials}
          aiSuggestedIds={aiMaterialIds}
          allItems={allMaterialItems}
          hasAiConfidence={aiFilled.materials}
          onToggle={handleMaterialToggle}
          onViewAll={() => materialSheetRef.current?.show()}
        />
      </ScrollView>

      <Animated.View style={[styles.footerWrapper, footerAnimatedStyle]}>
        <SellFooter
          testID="sell-details-footer-cta"
          label="CONTINUER"
          onPress={handleContinue}
          onInvalidPress={handleContinue}
          isValid={isFormValid}
          bottomInset={0}
        />
      </Animated.View>

      {/* Bottom Sheets */}
      <CategoryBottomSheet
        ref={categorySheetRef}
        onSelect={handleCategorySelect}
        suggestedCategoryId={aiResult?.category?.categoryPath?.[aiResult.category.categoryPath.length - 1]}
      />
      <SelectionBottomSheet
        ref={colorSheetRef}
        title="Couleur"
        items={allColorItems}
        selectedValues={fields.colors}
        onSelect={(value) => handleColorToggle(value)}
        onSelectMultiple={(values) => updateField('colors', values)}
        type="color"
        multiSelect
      />
      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={allMaterialItems}
        selectedValues={fields.materials}
        onSelect={(value) => handleMaterialToggle(value)}
        onSelectMultiple={(values) => updateField('materials', values)}
        multiSelect
      />
      <SelectionBottomSheet
        ref={sizeSheetRef}
        title="Taille"
        items={allSizeItems}
        selectedValue={fields.size}
        onSelect={(value) => {
          updateField('size', value);
          track('sell_field_edited', {
            screen: 'sell',
            field: 'size',
            value,
            matched_ai_suggestion:
              value === (aiResult?.size?.normalized || aiResult?.size?.detected),
          });
        }}
        type="size"
        sizeSystem={fields.sizeSystem}
        onSizeSystemChange={sizeSystem => setFields(prev => prev.sizeSystem === sizeSystem ? prev : {...prev, sizeSystem, size: null})}
      />
      <BrandSelectionSheet
        ref={brandSheetRef}
        selectedBrand={fields.brand}
        onSelectSingle={(brand) => {
          setFields(prev => ({ ...prev, brand }));
          track('sell_field_edited', {
            screen: 'sell',
            field: 'brand',
            value: brand,
            matched_ai_suggestion: !!aiResult?.brand?.detected && brand === aiResult.brand.detected,
          });
        }}
        onSelectNoBrand={() => setFields(prev => ({...prev, brand: null}))}
        singleSelect
      />
    </View>
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
    paddingBottom: 100,
  },
  // Carries the footer's cream through the safe-area gap so the animated
  // paddingBottom region matches the footer rather than the screen background.
  footerWrapper: {
    backgroundColor: colors.cream,
  },
  guidance: {
    ...typography.bodySmall,
    color: colors.muted,
    marginVertical: spacing.sm,
  },
  declarationChoices: {
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  declarationChoice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  declarationChoiceSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  declarationChoiceText: {
    ...typography.bodySmall,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
});
