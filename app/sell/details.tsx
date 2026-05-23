import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import ConditionSelector from '@/components/ConditionSelector';
import StepProgressBar from '@/components/sell/StepProgressBar';
import FormSectionTitle from '@/components/sell/FormSectionTitle';
import FormFieldGroup from '@/components/sell/FormFieldGroup';
import { AIAnalysisResult, getConfidenceLevel, CONDITION_DISPLAY, ConditionId } from '@/types/ai';
import { colors as dataColors, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { getSizesForCategory } from '@/data/sizes';
import draftService, { ArticleDraft, DraftFields } from '@/services/draftService';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';

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
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

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
    size: aiResult?.size?.detected || null,
    brand: aiResult?.brand?.detected || '',
  });

  const [isInitialized, setIsInitialized] = useState(!isResuming);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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
      setSaveStatus('saving');
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
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        if (__DEV__) console.error('Failed to save draft fields:', error);
        setSaveStatus('error');
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

  const handleCategorySelect = (categoryIds: string[]) => {
    updateField('categoryIds', categoryIds);
    const lastId = categoryIds[categoryIds.length - 1];
    updateField('categoryDisplay', {
      icon: '',
      name: lastId.split('_').pop() || 'Article',
      context: categoryIds.slice(0, -1).join(' · '),
    });
  };

  const handleBack = () => {
    router.back();
  };

  const handleContinue = () => {
    if (!fields.title.trim()) return;
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

  const isFormValid = fields.title.trim() !== '' && fields.categoryIds.length > 0;

  // Chip helpers
  const allColorItems = getColorItems();
  const allMaterialItems = getMaterialItems();
  const allSizeItems = getSizesForCategory(fields.categoryIds).map((s) => ({
    value: s,
    label: s,
  }));

  const aiColorIds = aiResult?.colors?.colorIds || [];
  const aiMaterialIds = aiResult?.materials?.materialIds || [];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Détails"
        onBack={handleBack}
        topContent={<StepProgressBar currentStep={3} />}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Photo strip — scrolls with content */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoStrip}
            style={styles.photoStripContainer}
          >
            {photos.map((uri, index) => (
              <Image
                key={`photo-${index}`}
                source={{ uri }}
                style={styles.photoThumb}
                contentFit="cover"
              />
            ))}
          </ScrollView>
        )}

        {/* Section: Essentiel */}
        <FormSectionTitle title="Essentiel" />

        {/* Title field — label inside bordered card (matches design .textarea-field) */}
        <View style={styles.textareaField}>
          <View style={styles.textareaLabel}>
            <Text style={styles.textFieldLabel}>Titre</Text>
            <View style={styles.textareaLabelRight}>
              {aiResult?.titleConfidence ? (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>IA</Text>
                </View>
              ) : null}
              <Text style={styles.charCount}>{fields.title.length} / 80</Text>
            </View>
          </View>
          <TextInput
            style={styles.textareaContent}
            value={fields.title}
            onChangeText={(text) => updateField('title', text)}
            placeholder="Ex: Robe d'été fleurie Zara"
            placeholderTextColor={colors.muted}
            maxLength={80}
            cursorColor={colors.rust}
            selectionColor={colors.rust}
          />
        </View>

        {/* Description field — label inside bordered card */}
        <View style={styles.textareaField}>
          <View style={styles.textareaLabel}>
            <Text style={styles.textFieldLabel}>Description</Text>
            <View style={styles.textareaLabelRight}>
              {aiResult?.descriptionConfidence ? (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>IA</Text>
                </View>
              ) : null}
              <Text style={styles.charCount}>{fields.description.length} / 500</Text>
            </View>
          </View>
          <TextInput
            style={[styles.textareaContent, styles.textareaMultiline]}
            value={fields.description}
            onChangeText={(text) => updateField('description', text)}
            placeholder="Décrivez votre article en détail..."
            placeholderTextColor={colors.muted}
            maxLength={500}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            cursorColor={colors.rust}
            selectionColor={colors.rust}
          />
        </View>

        {/* Category + Condition grouped */}
        <FormFieldGroup>
          {/* Category row */}
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => categorySheetRef.current?.show()}
            activeOpacity={0.7}
          >
            <Text style={styles.fieldRowLabel}>CATÉGORIE</Text>
            <View style={styles.fieldRowValueContainer}>
              <Text
                style={[
                  styles.fieldRowValue,
                  !fields.categoryDisplay.name && styles.fieldRowPlaceholder,
                ]}
                numberOfLines={1}
              >
                {fields.categoryDisplay.name || 'Sélectionner'}
              </Text>
              {aiResult?.category?.confidence?.level && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>IA</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>

          {/* Condition row */}
          <ConditionSelector
            value={fields.condition}
            onChange={(value) => updateField('condition', value)}
            confidenceLevel={aiResult?.condition?.confidence?.level}
          />
        </FormFieldGroup>

        {/* Section: Caracteristiques */}
        <View style={{ marginTop: spacing.lg }}>
          <FormSectionTitle title="Caractéristiques" />
        </View>

        {/* Brand + Size grouped */}
        <FormFieldGroup>
          {/* Brand row */}
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => brandSheetRef.current?.show(aiResult?.brand?.detected || undefined)}
            activeOpacity={0.7}
          >
            <Text style={styles.fieldRowLabel}>MARQUE</Text>
            <View style={styles.fieldRowValueContainer}>
              <Text
                style={[
                  styles.fieldRowValue,
                  !fields.brand && styles.fieldRowPlaceholder,
                ]}
                numberOfLines={1}
              >
                {fields.brand || 'Sélectionner'}
              </Text>
              {aiResult?.brand?.confidence?.level && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>IA</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>

          {/* Size row */}
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => sizeSheetRef.current?.show()}
            activeOpacity={0.7}
          >
            <Text style={styles.fieldRowLabel}>TAILLE</Text>
            <View style={styles.fieldRowValueContainer}>
              <Text
                style={[
                  styles.fieldRowValue,
                  !fields.size && styles.fieldRowPlaceholder,
                ]}
              >
                {fields.size || 'Sélectionner'}
              </Text>
              {aiResult?.size?.confidence?.level && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>IA</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </TouchableOpacity>
        </FormFieldGroup>

        {/* Color chips */}
        <View style={styles.chipSection}>
          <View style={styles.chipHeader}>
            <Text style={styles.chipLabel}>Couleur</Text>
            {aiResult?.colors?.confidence?.level && (
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>IA</Text>
              </View>
            )}
          </View>
          <View style={styles.chipRow}>
            {/* AI-suggested colors first */}
            {aiColorIds.map((colorId) => {
              const colorData = dataColors.find(
                (c) => c.id === colorId || c.name.toLowerCase() === colorId.toLowerCase()
              );
              const isSelected = fields.colors.includes(colorId);
              return (
                <TouchableOpacity
                  key={colorId}
                  style={[
                    styles.chip,
                    !isSelected && styles.chipAISuggested,
                    isSelected && styles.chipAISuggestedActive,
                  ]}
                  onPress={() => {
                    const newColors = isSelected
                      ? fields.colors.filter((c) => c !== colorId)
                      : [...fields.colors, colorId];
                    updateField('colors', newColors);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {colorData?.name || colorId}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {/* User-selected colors NOT in AI suggestions */}
            {fields.colors
              .filter((colorId) => !aiColorIds.includes(colorId))
              .map((colorId) => {
                const colorData = dataColors.find(
                  (c) => c.id === colorId || c.name.toLowerCase() === colorId.toLowerCase()
                );
                const colorItem = allColorItems.find((c) => c.value === colorId);
                return (
                  <TouchableOpacity
                    key={colorId}
                    style={[styles.chip, styles.chipSelected]}
                    onPress={() => {
                      const newColors = fields.colors.filter((c) => c !== colorId);
                      updateField('colors', newColors);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, styles.chipTextSelected]}>
                      {colorData?.name || colorItem?.label || colorId}
                    </Text>
                    <Ionicons name="close" size={10} color={colors.white} />
                  </TouchableOpacity>
                );
              })}
            {/* View all button */}
            <TouchableOpacity
              style={styles.chipViewAll}
              onPress={() => colorSheetRef.current?.show()}
            >
              <Text style={styles.chipViewAllText}>Toutes</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Material chips */}
        <View style={styles.chipSection}>
          <View style={styles.chipHeader}>
            <Text style={styles.chipLabel}>Matière</Text>
            {aiResult?.materials?.confidence?.level && (
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>IA</Text>
              </View>
            )}
          </View>
          <View style={styles.chipRow}>
            {aiMaterialIds.map((matId) => {
              const matData = allMaterialItems.find((m) => m.value === matId);
              const isSelected = fields.materials.includes(matId);
              return (
                <TouchableOpacity
                  key={matId}
                  style={[
                    styles.chip,
                    !isSelected && styles.chipAISuggested,
                    isSelected && styles.chipAISuggestedActive,
                  ]}
                  onPress={() => {
                    const newMaterials = isSelected
                      ? fields.materials.filter((m) => m !== matId)
                      : [...fields.materials, matId];
                    updateField('materials', newMaterials);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {matData?.label || matId}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {/* User-selected materials NOT in AI suggestions */}
            {fields.materials
              .filter((matId) => !aiMaterialIds.includes(matId))
              .map((matId) => {
                const matData = allMaterialItems.find((m) => m.value === matId);
                return (
                  <TouchableOpacity
                    key={matId}
                    style={[styles.chip, styles.chipSelected]}
                    onPress={() => {
                      const newMaterials = fields.materials.filter((m) => m !== matId);
                      updateField('materials', newMaterials);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, styles.chipTextSelected]}>
                      {matData?.label || matId}
                    </Text>
                    <Ionicons name="close" size={10} color={colors.white} />
                  </TouchableOpacity>
                );
              })}
            <TouchableOpacity
              style={styles.chipViewAll}
              onPress={() => materialSheetRef.current?.show()}
            >
              <Text style={styles.chipViewAllText}>Toutes</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.muted} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !isFormValid && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!isFormValid}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.continueButtonText,
              !isFormValid && styles.continueButtonTextDisabled,
            ]}
          >
            CONTINUER
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={isFormValid ? colors.cream : colors.muted}
          />
        </TouchableOpacity>
      </View>

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
        onSelect={(value) => {
          const newColors = fields.colors.includes(value)
            ? fields.colors.filter((c) => c !== value)
            : [...fields.colors, value];
          updateField('colors', newColors);
        }}
        onSelectMultiple={(values) => updateField('colors', values)}
        type="color"
        multiSelect
      />
      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={allMaterialItems}
        selectedValues={fields.materials}
        onSelect={(value) => {
          const newMats = fields.materials.includes(value)
            ? fields.materials.filter((m) => m !== value)
            : [...fields.materials, value];
          updateField('materials', newMats);
        }}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  // Photo strip — now inside ScrollView, larger photos
  photoStripContainer: {
    marginBottom: 20,
    marginHorizontal: -20,
  },
  photoStrip: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 8,
  },
  photoThumb: {
    width: 90,
    height: 120,
    borderRadius: 4,
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  // Textarea fields — matches design .textarea-field (label INSIDE bordered card)
  textareaField: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    backgroundColor: colors.white,
    marginBottom: 14,
    overflow: 'hidden',
  },
  textareaLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  textareaLabelRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textFieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  charCount: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },
  textareaContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.charcoal,
    lineHeight: 22,
  },
  textareaMultiline: {
    minHeight: 80,
    fontSize: 13,
    lineHeight: 21,
  },
  // AI badge — matches design .ai-fill-badge (pill shape)
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    marginLeft: 8,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
  // Field rows — matches design .field-row (13px 16px padding)
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  fieldRowLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    width: 80,
    textTransform: 'uppercase',
  },
  fieldRowValueContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldRowValue: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  fieldRowPlaceholder: {
    color: colors.muted,
  },
  // Chip sections — matches design inline styles
  chipSection: {
    marginBottom: 14,
  },
  chipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  chipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 2,
    backgroundColor: colors.white,
  },
  chipSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  chipAISuggested: {
    borderColor: 'rgba(122,140,110,0.4)',
    backgroundColor: 'rgba(122,140,110,0.06)',
  },
  chipAISuggestedActive: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  chipText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
    letterSpacing: 0.44,
  },
  chipTextSelected: {
    color: colors.white,
  },
  chipViewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipViewAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.2,
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
