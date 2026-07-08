import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import ConditionSelector from '@/components/ConditionSelector';
import FormSectionTitle from '@/components/sell/FormSectionTitle';
import FormFieldGroup from '@/components/sell/FormFieldGroup';
import { ScreenHeader } from '@/components/ui';
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
import { getSizesForCategory } from '@/data/sizes';
import { getCategoryInfoFromIds } from '@/data/categories-v2';
import draftService, { ArticleDraft, DraftFields } from '@/services/draftService';
import { track } from '@/lib/analytics';
import { colors, spacing } from '@/constants/theme';

// Lift the sticky footer to sit spacing.md (16) above the keyboard when open;
// keyboard.height is bottom-anchored, so blending against the safe-area inset
// gives the closed-state inset and the open-state float without a jump.

type ConditionValue = 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: ConditionValue;
  colors: string[];
  materials: string[];
  size: string | null;
  brand: string;
}

export default function DetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const keyboard = useAnimatedKeyboard();
  const footerAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));

  // Parse params
  const isResuming = params.resumeDraft === 'true';
  const photosFromParams: string[] = params.photos ? JSON.parse(params.photos as string) : [];
  const aiResult: AIAnalysisResult | null = params.aiResult
    ? JSON.parse(params.aiResult as string)
    : null;
  const storageUrlsFromParams: string[] = params.storageUrls
    ? JSON.parse(params.storageUrls as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(photosFromParams);
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);

  const getConditionDisplay = (conditionId?: ConditionId): ConditionValue => {
    if (!conditionId) return 'très bon état';
    return (CONDITION_DISPLAY[conditionId] || 'très bon état') as ConditionValue;
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
    condition: getConditionDisplay(aiResult?.condition?.conditionId),
    colors: aiResult?.colors?.colorIds || (aiResult?.colors?.primaryColorId ? [aiResult.colors.primaryColorId] : []),
    materials: aiResult?.materials?.materialIds || (aiResult?.materials?.primaryMaterialId ? [aiResult.materials.primaryMaterialId] : []),
    size: aiResult?.size?.normalized || aiResult?.size?.detected || null,
    brand: aiResult?.brand?.detected || '',
  });

  const [isInitialized, setIsInitialized] = useState(!isResuming);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  // Load draft on mount
  useEffect(() => {
    const loadDraft = async () => {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        setDraft(existingDraft);
        if (isResuming && existingDraft.fields) {
          setFields({
            title: existingDraft.fields.title,
            description: existingDraft.fields.description,
            categoryIds: existingDraft.fields.categoryIds,
            categoryDisplay: existingDraft.fields.categoryDisplay,
            condition: existingDraft.fields.condition as ConditionValue,
            colors: existingDraft.fields.colors ?? (existingDraft.fields.color ? [existingDraft.fields.color] : []),
            materials: existingDraft.fields.materials ?? (existingDraft.fields.material ? [existingDraft.fields.material] : []),
            size: existingDraft.fields.size ?? null,
            brand: existingDraft.fields.brand ?? '',
          });
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
    loadDraft();
  }, [isResuming]);

  // Auto-save fields
  useEffect(() => {
    if (!draft || !isInitialized) return;
    const saveToDraft = async () => {
      try {
        const draftFields: DraftFields = {
          title: fields.title,
          description: fields.description,
          categoryIds: fields.categoryIds,
          categoryDisplay: fields.categoryDisplay,
          condition: fields.condition,
          colors: fields.colors,
          materials: fields.materials,
          brands: fields.brand ? [fields.brand] : [],
          size: fields.size,
          brand: fields.brand,
        };
        const updated = await draftService.updateDraftFields(draft, draftFields);
        setDraft(updated);
      } catch (error) {
        if (__DEV__) console.error('Failed to save draft fields:', error);
      }
    };
    const timeoutId = setTimeout(saveToDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [fields, draft?.id, isInitialized]);

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
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Quitter',
            onPress: () => {
              allowLeaveRef.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation]);

  const handleBack = () => {
    router.back();
  };

  const handleContinue = () => {
    // Same gate as isFormValid below — keep details/preview validation aligned
    // so the footer's disabled state and the action never diverge.
    const missing: string[] = [];
    if (!fields.title.trim()) missing.push('Le titre');
    if (!fields.description.trim()) missing.push('La description');
    if (fields.categoryIds.length === 0) missing.push('La catégorie');
    if (missing.length > 0) {
      Alert.alert('Informations manquantes', `${missing.join('\n')}`);
      return;
    }
    router.push({
      pathname: '/sell/pricing',
      params: {
        photos: JSON.stringify(photos),
        fields: JSON.stringify(fields),
        aiResult: params.aiResult,
        storageUrls: JSON.stringify(storageUrls),
      },
    });
  };

  const handleColorToggle = useCallback((colorId: string) => {
    setFields((prev) => {
      const newColors = prev.colors.includes(colorId)
        ? prev.colors.filter((c) => c !== colorId)
        : [...prev.colors, colorId];
      return { ...prev, colors: newColors };
    });
  }, []);

  const handleMaterialToggle = useCallback((matId: string) => {
    setFields((prev) => {
      const newMaterials = prev.materials.includes(matId)
        ? prev.materials.filter((m) => m !== matId)
        : [...prev.materials, matId];
      return { ...prev, materials: newMaterials };
    });
  }, []);

  const isFormValid = fields.title.trim() !== '' && fields.description.trim() !== '' && fields.categoryIds.length > 0;

  // Chip data
  const allColorItems = getColorItems();
  const allMaterialItems = getMaterialItems();
  const allSizeItems = getSizesForCategory(fields.categoryIds).map((s) => ({
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
        <PhotoStripPreview photos={photos} />

        <FormSectionTitle title="Essentiel" />

        <TextareaField
          testID="sell-title-input"
          label="Titre"
          value={fields.title}
          onChangeText={(text) => updateField('title', text)}
          placeholder="Ex: Robe d'été fleurie Zara"
          maxLength={80}
          hasAiConfidence={!!aiResult?.titleConfidence}
        />

        <TextareaField
          testID="sell-description-input"
          label="Description"
          value={fields.description}
          onChangeText={(text) => updateField('description', text)}
          placeholder="Décrivez votre article en détail..."
          maxLength={500}
          hasAiConfidence={!!aiResult?.descriptionConfidence}
          multiline
          numberOfLines={4}
        />

        <FormFieldGroup>
          <FieldRow
            testID="sell-category-selector"
            label="CATÉGORIE"
            value={fields.categoryDisplay.name || null}
            hasAiConfidence={!!aiResult?.category?.confidence?.level}
            onPress={() => categorySheetRef.current?.show()}
          />
          <ConditionSelector
            value={fields.condition}
            onChange={(value) => updateField('condition', value)}
            confidenceLevel={aiResult?.condition?.confidence?.level}
          />
        </FormFieldGroup>

        <View style={{ marginTop: spacing.lg }}>
          <FormSectionTitle title="Caractéristiques" />
        </View>

        <FormFieldGroup>
          <FieldRow
            label="MARQUE"
            value={fields.brand || null}
            hasAiConfidence={!!aiResult?.brand?.confidence?.level}
            onPress={() => brandSheetRef.current?.show(aiResult?.brand?.detected || undefined)}
          />
          <FieldRow
            label="TAILLE"
            value={fields.size}
            hasAiConfidence={!!aiResult?.size?.confidence?.level}
            onPress={() => sizeSheetRef.current?.show()}
          />
        </FormFieldGroup>

        <ChipSelector
          label="Couleur"
          selectedValues={fields.colors}
          aiSuggestedIds={aiColorIds}
          allItems={allColorItems}
          hasAiConfidence={!!aiResult?.colors?.confidence?.level}
          onToggle={handleColorToggle}
          onViewAll={() => colorSheetRef.current?.show()}
          resolveLabel={resolveColorLabel}
        />

        <ChipSelector
          label="Matière"
          selectedValues={fields.materials}
          aiSuggestedIds={aiMaterialIds}
          allItems={allMaterialItems}
          hasAiConfidence={!!aiResult?.materials?.confidence?.level}
          onToggle={handleMaterialToggle}
          onViewAll={() => materialSheetRef.current?.show()}
        />
      </ScrollView>

      <Animated.View style={[styles.footerWrapper, footerAnimatedStyle]}>
        <SellFooter
          testID="sell-details-footer-cta"
          label="CONTINUER"
          onPress={handleContinue}
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
        onSelect={(value) => updateField('size', value)}
        type="size"
      />
      <BrandSelectionSheet
        ref={brandSheetRef}
        selectedBrand={fields.brand}
        onSelectSingle={(brand) => updateField('brand', brand)}
        initialSearchQuery={aiResult?.brand?.detected || ''}
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
});
