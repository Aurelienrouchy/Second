/**
 * Edit Article Screen
 * Allows users to edit their own articles
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

// Components
import EditableField from '@/components/EditableField';
import SmartSelector from '@/components/SmartSelector';
import CategoryDisplay from '@/components/CategoryDisplay';
import ConditionSelector from '@/components/ConditionSelector';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';

// Data
import { getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { getSizesForCategory } from '@/data/sizes';
import { getCategoryInfoFromIds } from '@/data/categories-v2';

// Services & Types
import { ArticlesService } from '@/services/articlesService';
import { useUser } from '@/contexts/AuthContext';
import { Article } from '@/types';
import { colors } from '@/constants/theme';

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
  price: number;
}

export default function EditArticleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();

  const [article, setArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields
  const [fields, setFields] = useState<EditedFields>({
    title: '',
    description: '',
    categoryIds: [],
    categoryDisplay: { icon: 'pricetag-outline', name: '', context: '' },
    condition: 'très bon état',
    color: null,
    material: null,
    size: null,
    brand: '',
    price: 0,
  });

  // Bottom sheet refs
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SelectionBottomSheetRef>(null);

  // Load article on mount
  useEffect(() => {
    if (id) {
      loadArticle(id);
    }
  }, [id]);

  const loadArticle = async (articleId: string) => {
    setIsLoading(true);
    try {
      const articleData = await ArticlesService.getArticleById(articleId);

      if (!articleData) {
        Alert.alert('Erreur', 'Article introuvable');
        router.back();
        return;
      }

      // Check ownership
      if (user?.id !== articleData.sellerId) {
        Alert.alert('Erreur', 'Vous ne pouvez pas modifier cet article');
        router.back();
        return;
      }

      setArticle(articleData);

      // Get category info
      const categoryInfo = articleData.categoryIds
        ? getCategoryInfoFromIds(articleData.categoryIds)
        : null;

      // Initialize form fields from article
      setFields({
        title: articleData.title || '',
        description: articleData.description || '',
        categoryIds: articleData.categoryIds || [],
        categoryDisplay: categoryInfo ? {
          icon: categoryInfo.icon || 'pricetag-outline',
          name: categoryInfo.displayName || '',
          context: categoryInfo.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
        } : { icon: 'pricetag-outline', name: articleData.category || '', context: '' },
        condition: (articleData.condition as ConditionValue) || 'très bon état',
        color: articleData.color?.toLowerCase().replace(/\s+/g, '-') || null,
        material: articleData.material?.toLowerCase().replace(/\s+/g, '-') || null,
        size: articleData.size || null,
        brand: articleData.brand || '',
        price: articleData.price || 0,
      });
    } catch (error) {
      if (__DEV__) console.error('Error loading article:', error);
      Alert.alert('Erreur', 'Impossible de charger l\'article');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = <K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K]
  ) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleCategorySelect = (categoryIds: string[]) => {
    updateField('categoryIds', categoryIds);
    const categoryInfo = getCategoryInfoFromIds(categoryIds);
    if (categoryInfo) {
      updateField('categoryDisplay', {
        icon: categoryInfo.icon || 'pricetag-outline',
        name: categoryInfo.displayName || '',
        context: categoryInfo.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
      });
    }
  };

  const handleSave = async () => {
    if (!article || !id) return;

    // Validate required fields
    if (!fields.title.trim()) {
      Alert.alert('Erreur', 'Le titre est requis');
      return;
    }

    if (!fields.description.trim()) {
      Alert.alert('Erreur', 'La description est requise');
      return;
    }

    if (fields.price <= 0) {
      Alert.alert('Erreur', 'Le prix doit être supérieur à 0');
      return;
    }

    setIsSaving(true);
    try {
      // Find color and material labels
      const colorItem = getColorItems().find(c => c.value === fields.color);
      const materialItem = getMaterialItems().find(m => m.value === fields.material);

      await ArticlesService.updateArticle(id, {
        title: fields.title.trim(),
        description: fields.description.trim(),
        categoryIds: fields.categoryIds,
        category: fields.categoryDisplay.name,
        condition: fields.condition,
        color: colorItem?.label || fields.color || undefined,
        material: materialItem?.label || fields.material || undefined,
        size: fields.size || undefined,
        brand: fields.brand.trim() || undefined,
        price: fields.price,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Succès', 'Article modifié avec succès', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      if (__DEV__) console.error('Error updating article:', error);
      Alert.alert('Erreur', 'Impossible de modifier l\'article');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const isFormValid = fields.title.trim() !== '' &&
                      fields.description.trim() !== '' &&
                      fields.categoryIds.length > 0 &&
                      fields.price > 0;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  if (!article) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Modifier l'article</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Photo preview (non-editable for now) */}
        <View style={styles.photoSection}>
          {article.images && article.images.length > 0 && (
            <>
              <Image
                source={{ uri: article.images[0]?.url }}
                style={styles.mainPhoto}
                contentFit="cover"
              />
              {article.images.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.thumbnailStrip}
                  contentContainerStyle={styles.thumbnailContent}
                >
                  {article.images.slice(1).map((img, index) => (
                    <Image
                      key={index}
                      source={{ uri: img.url }}
                      style={styles.thumbnail}
                      contentFit="cover"
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>

        {/* Form fields */}
        <View style={styles.formSection}>
          {/* Title */}
          <EditableField
            label="Titre"
            value={fields.title}
            onSave={(value) => updateField('title', value)}
            placeholder="Ex: Robe d'été fleurie Zara"
            maxLength={80}
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
            required
          />

          {/* Price */}
          <EditableField
            label="Prix"
            value={fields.price > 0 ? fields.price.toString() : ''}
            onSave={(value) => updateField('price', parseFloat(value) || 0)}
            placeholder="0"
            keyboardType="numeric"
            suffix="€"
            required
          />

          {/* Category */}
          <CategoryDisplay
            icon={fields.categoryDisplay.icon}
            name={fields.categoryDisplay.name}
            context={fields.categoryDisplay.context}
            onPress={() => categorySheetRef.current?.show()}
            isEmpty={fields.categoryIds.length === 0}
          />

          {/* Condition */}
          <ConditionSelector
            value={fields.condition}
            onChange={(value) => updateField('condition', value)}
          />

          {/* Separator */}
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>Optionnel</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Brand */}
          <EditableField
            label="Marque"
            value={fields.brand}
            onSave={(value) => updateField('brand', value)}
            placeholder="Ex: Nike, Zara, H&M..."
          />

          {/* Color */}
          <SmartSelector
            label="Couleur"
            options={fields.color ? [{
              value: fields.color,
              label: getColorItems().find(c => c.value === fields.color)?.label || fields.color,
              color: getColorItems().find(c => c.value === fields.color)?.color,
            }] : []}
            selectedValue={fields.color}
            onSelect={(value) => updateField('color', value)}
            onViewAll={() => colorSheetRef.current?.show()}
            viewAllLabel="Voir toutes les couleurs"
            emptyMessage="Sélectionner une couleur"
          />

          {/* Material */}
          <SmartSelector
            label="Matière"
            options={fields.material ? [{
              value: fields.material,
              label: getMaterialItems().find(m => m.value === fields.material)?.label || fields.material,
            }] : []}
            selectedValue={fields.material}
            onSelect={(value) => updateField('material', value)}
            onViewAll={() => materialSheetRef.current?.show()}
            viewAllLabel="Voir toutes les matières"
            emptyMessage="Sélectionner une matière"
          />

          {/* Size */}
          <SmartSelector
            label="Taille"
            options={fields.size ? [{
              value: fields.size,
              label: fields.size,
            }] : []}
            selectedValue={fields.size}
            onSelect={(value) => updateField('size', value)}
            onViewAll={() => sizeSheetRef.current?.show()}
            viewAllLabel="Voir toutes les tailles"
            emptyMessage="Sélectionner une taille"
          />
        </View>
      </ScrollView>

      {/* Save button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[
            styles.saveButton,
            (!isFormValid || isSaving) && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!isFormValid || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.saveButtonText,
                !isFormValid && styles.saveButtonTextDisabled,
              ]}
            >
              Enregistrer les modifications
            </Text>
          )}
        </Pressable>
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
        onSelect={(value) => updateField('color', value)}
      />

      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={getMaterialItems()}
        onSelect={(value) => updateField('material', value)}
      />

      <SelectionBottomSheet
        ref={sizeSheetRef}
        title="Taille"
        items={getSizesForCategory(fields.categoryIds).map((s) => ({
          value: s,
          label: s,
        }))}
        onSelect={(value) => updateField('size', value)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.muted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
    backgroundColor: colors.white,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  headerPlaceholder: {
    width: 32,
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
    backgroundColor: colors.surfaceWarm,
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
    backgroundColor: colors.surfaceWarm,
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
    backgroundColor: colors.border,
  },
  separatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: colors.border,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButtonTextDisabled: {
    color: colors.muted,
  },
});
