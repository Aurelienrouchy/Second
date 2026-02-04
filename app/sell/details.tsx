import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SellFlowHeader from '@/components/SellFlowHeader';
import EditableField from '@/components/EditableField';
import SmartSelector from '@/components/SmartSelector';
import CategoryDisplay from '@/components/CategoryDisplay';
import ConditionSelector from '@/components/ConditionSelector';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import { Ionicons } from '@expo/vector-icons';
import { LabelDetectedBanner } from '@/components/ConfidenceIndicator';
import { AIAnalysisResult, getConfidenceLevel, CONDITION_DISPLAY, ConditionId } from '@/types/ai';
import { colors, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { getSizesForCategory } from '@/data/sizes';
import draftService, { ArticleDraft, DraftFields } from '@/services/draftService';

type ConditionValue = 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: ConditionValue;
  color: string | null;
  material: string | null;
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

  // Photos state (can be loaded from draft)
  const [photos, setPhotos] = useState<string[]>(photosFromParams);

  // Storage URLs state (from AI analysis upload)
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);

  // Map conditionId to display value
  const getConditionDisplay = (conditionId?: ConditionId): ConditionValue => {
    if (!conditionId) return 'très bon état';
    return (CONDITION_DISPLAY[conditionId] || 'très bon état') as ConditionValue;
  };

  // State for edited fields - initialized from aiResult, but may be overwritten by draft
  const [fields, setFields] = useState<EditedFields>({
    title: aiResult?.title || '',
    description: aiResult?.description || '',
    categoryIds: aiResult?.category?.categoryPath || [],
    categoryDisplay: {
      icon: aiResult?.category?.icon || '📦',
      name: aiResult?.category?.displayName || '',
      context: aiResult?.category?.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
    },
    condition: getConditionDisplay(aiResult?.condition?.conditionId),
    color: aiResult?.colors?.primaryColorId || null,
    material: aiResult?.materials?.primaryMaterialId || null,
    size: aiResult?.size?.detected || null, // Use detected size from label if available
    brand: aiResult?.brand?.detected || '',
  });

  // Track if fields have been initialized from draft
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

        // If resuming, restore fields from draft
        if (isResuming && existingDraft.fields) {
          console.log('[Details] Resuming draft, restoring fields:', existingDraft.fields);
          setFields({
            title: existingDraft.fields.title,
            description: existingDraft.fields.description,
            categoryIds: existingDraft.fields.categoryIds,
            categoryDisplay: existingDraft.fields.categoryDisplay,
            condition: existingDraft.fields.condition as ConditionValue,
            color: existingDraft.fields.color ?? null,
            material: existingDraft.fields.material ?? null,
            size: existingDraft.fields.size ?? null,
            brand: existingDraft.fields.brand ?? '',
          });
          // Also restore photos from draft if available
          if (existingDraft.photos.length > 0) {
            setPhotos(existingDraft.photos);
          }
          // Restore storage URLs from draft if available
          if (existingDraft.storageUrls && existingDraft.storageUrls.length > 0) {
            setStorageUrls(existingDraft.storageUrls);
          }
        }
        setIsInitialized(true);

        // Update step to 2 if not already
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

  // Auto-save fields to draft when they change (debounced)
  useEffect(() => {
    // Don't save until fields are initialized (prevents overwriting draft with empty state)
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
          color: fields.color,
          material: fields.material,
          size: fields.size,
          brand: fields.brand,
        };
        const updated = await draftService.updateDraftFields(draft, draftFields);
        setDraft(updated);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        console.error('Failed to save draft fields:', error);
        setSaveStatus('error');
      }
    };

    // Debounce save
    const timeoutId = setTimeout(saveToDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [fields, draft?.id, isInitialized]);

  // Bottom sheet refs
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);

  // Build SmartSelector options
  const colorOptions = (aiResult?.colors?.colorIds || []).map((colorId) => {
    const colorData = colors.find(
      (c) => c.id === colorId || c.name.toLowerCase() === colorId.toLowerCase()
    );
    return {
      value: colorId,
      label: colorData?.name || colorId,
      color: colorData?.hex || '#808080',
      isAISuggested: true,
    };
  });

  const materialOptions = (aiResult?.materials?.materialIds || []).map((matId) => {
    // Try to find a nice label for the material
    const materialItems = getMaterialItems();
    const materialData = materialItems.find((m) => m.value === matId);
    return {
      value: matId,
      label: materialData?.label || matId,
      isAISuggested: true,
    };
  });

  // Size options - use detected size if available
  const sizeOptions = aiResult?.size?.detected
    ? [{ value: aiResult.size.detected, label: aiResult.size.detected, isAISuggested: true }]
    : [];

  const updateField = <K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K]
  ) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleCategorySelect = (categoryIds: string[]) => {
    updateField('categoryIds', categoryIds);
    // Update display
    // This is simplified - in real app, you'd look up the category name
    const lastId = categoryIds[categoryIds.length - 1];
    updateField('categoryDisplay', {
      icon: '📦', // Would be looked up
      name: lastId.split('_').pop() || 'Article',
      context: categoryIds.slice(0, -1).join(' · '),
    });
  };

  const handleContinue = () => {
    // Validate required fields
    if (!fields.title.trim()) {
      // Show error
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

  const isFormValid = fields.title.trim() !== '' && fields.categoryIds.length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SellFlowHeader currentStep={2} confirmClose={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Photo preview */}
        <View style={styles.photoSection}>
          {photos.length > 0 && (
            <>
              <Image
                source={{ uri: photos[0] }}
                style={styles.mainPhoto}
                contentFit="cover"
              />
              {photos.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.thumbnailStrip}
                  contentContainerStyle={styles.thumbnailContent}
                >
                  {photos.slice(1).map((uri, index) => (
                    <Image
                      key={index}
                      source={{ uri }}
                      style={styles.thumbnail}
                      contentFit="cover"
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>

        {/* Label detected banner */}
        {aiResult?.labelFound && (
          <View style={styles.labelBannerContainer}>
            <LabelDetectedBanner />
          </View>
        )}

        {/* Form fields */}
        <View style={styles.formSection}>
          {/* Title */}
          <EditableField
            label="Titre"
            value={fields.title}
            onSave={(value) => updateField('title', value)}
            placeholder="Ex: Robe d'été fleurie Zara"
            maxLength={80}
            confidenceLevel={aiResult?.titleConfidence ? getConfidenceLevel(aiResult.titleConfidence) : undefined}
            required
          />

          {/* Description */}
          <EditableField
            label="Description"
            value={fields.description}
            onSave={(value) => updateField('description', value)}
            placeholder="Décrivez votre article en détail..."
            multiline
            maxLength={500}
            confidenceLevel={aiResult?.descriptionConfidence ? getConfidenceLevel(aiResult.descriptionConfidence) : undefined}
            required
          />

          {/* Category */}
          <CategoryDisplay
            icon={fields.categoryDisplay.icon}
            name={fields.categoryDisplay.name}
            context={fields.categoryDisplay.context}
            onPress={() => categorySheetRef.current?.show()}
            confidenceLevel={aiResult?.category?.confidence?.level}
            isEmpty={fields.categoryIds.length === 0}
          />

          {/* Condition */}
          <ConditionSelector
            value={fields.condition}
            onChange={(value) => updateField('condition', value)}
            confidenceLevel={aiResult?.condition?.confidence?.level}
          />

          {/* Separator */}
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>Optionnel</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Brand */}
          <View style={styles.brandSection}>
            <View style={styles.brandHeader}>
              <Text style={styles.fieldLabel}>Marque</Text>
              {aiResult?.brand?.confidence?.level && (
                <View style={styles.confidenceBadge}>
                  <Text style={styles.confidenceText}>IA</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.brandSelector}
              onPress={() => brandSheetRef.current?.show(aiResult?.brand?.detected || undefined)}
              activeOpacity={0.7}
            >
              <View style={styles.brandSelectorContent}>
                {fields.brand ? (
                  <Text style={styles.brandSelectorValue}>{fields.brand}</Text>
                ) : (
                  <Text style={styles.brandSelectorPlaceholder}>
                    {aiResult?.brand?.detected
                      ? `Rechercher "${aiResult.brand.detected}"...`
                      : 'Sélectionner une marque'
                    }
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>
            {/* Brand suggestions when AI detected */}
            {aiResult?.brand?.detected && !fields.brand && (
              <View style={styles.brandHint}>
                <Ionicons name="sparkles" size={14} color="#8B5CF6" />
                <Text style={styles.brandHintText}>
                  Marque détectée : {aiResult.brand.detected}
                </Text>
              </View>
            )}
          </View>

          {/* Color */}
          <SmartSelector
            label="Couleur"
            options={colorOptions}
            selectedValue={fields.color}
            onSelect={(value) => updateField('color', value)}
            onViewAll={() => colorSheetRef.current?.show()}
            confidenceLevel={aiResult?.colors?.confidence?.level}
            viewAllLabel="Voir toutes les couleurs"
            emptyMessage="Aucune couleur détectée"
            allItems={getColorItems()}
          />

          {/* Material */}
          <SmartSelector
            label="Matière"
            options={materialOptions}
            selectedValue={fields.material}
            onSelect={(value) => updateField('material', value)}
            onViewAll={() => materialSheetRef.current?.show()}
            confidenceLevel={aiResult?.materials?.confidence?.level}
            viewAllLabel="Voir toutes les matières"
            emptyMessage="Aucune matière détectée"
            allItems={getMaterialItems()}
          />

          {/* Size */}
          <SmartSelector
            label="Taille"
            options={sizeOptions}
            selectedValue={fields.size}
            onSelect={(value) => updateField('size', value)}
            onViewAll={() => sizeSheetRef.current?.show()}
            confidenceLevel={aiResult?.size?.confidence?.level}
            viewAllLabel="Voir toutes les tailles"
            emptyMessage="Sélectionner une taille"
            allItems={getSizesForCategory(fields.categoryIds).map((s) => ({
              value: s,
              label: s,
            }))}
          />
        </View>
      </ScrollView>

      {/* Continue button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !isFormValid && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!isFormValid}
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

      {/* Bottom Sheets */}
      <CategoryBottomSheet
        ref={categorySheetRef}
        onSelect={handleCategorySelect}
      />

      <SelectionBottomSheet
        ref={colorSheetRef}
        title="Couleur"
        items={getColorItems()}
        selectedValue={fields.color}
        onSelect={(value) => updateField('color', value)}
        type="color"
      />

      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={getMaterialItems()}
        selectedValue={fields.material}
        onSelect={(value) => updateField('material', value)}
      />

      <SelectionBottomSheet
        ref={sizeSheetRef}
        title="Taille"
        items={getSizesForCategory(fields.categoryIds).map((s) => ({
          value: s,
          label: s,
        }))}
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
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 20,
  },
  photoSection: {
    marginBottom: 20,
  },
  mainPhoto: {
    width: '100%',
    height: 280,
    backgroundColor: '#F3F4F6',
  },
  thumbnailStrip: {
    marginTop: 8,
  },
  thumbnailContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  formSection: {
    paddingHorizontal: 16,
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    gap: 12,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  separatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  labelBannerContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  brandSection: {
    marginBottom: 20,
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confidenceBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#7C3AED',
  },
  brandSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  brandSelectorContent: {
    flex: 1,
  },
  brandSelectorValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
  },
  brandSelectorPlaceholder: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  brandHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  brandHintText: {
    fontSize: 13,
    color: '#8B5CF6',
    fontWeight: '500',
  },
});
