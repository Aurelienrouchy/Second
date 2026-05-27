/**
 * Edit Article Screen
 * Allows users to edit their own articles
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import * as ImagePicker from 'expo-image-picker';

// Components
import EditableField from '@/components/EditableField';
import CategoryDisplay from '@/components/CategoryDisplay';
import ConditionSelector from '@/components/ConditionSelector';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/components/NeighborhoodBottomSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ChipSelector } from '@/features/sell';

// Data
import { colors as dataColors, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { getSizesForCategory } from '@/data/sizes';
import { getCategoryInfoFromIds } from '@/data/categories-v2';

// Services & Types
import { ArticlesService } from '@/services/articlesService';
import { isStorageUrl } from '@/utils/fixStorageUrl';
import { useAuthStore } from '@/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { queryKeys } from '@/lib/queryKeys';
import { Article, ArticleImage, MeetupNeighborhood } from '@/types';
import { colors, fonts } from '@/constants/theme';

type ConditionValue = 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

type PackageSize = 'small' | 'medium' | 'large';

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
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhoods: import('@/types').MeetupNeighborhood[];
  packageSize: PackageSize | null;
}

export default function EditArticleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

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
    colors: [],
    materials: [],
    size: null,
    brand: '',
    price: 0,
    isHandDelivery: false,
    isShipping: true,
    neighborhoods: [],
    packageSize: null,
  });

  // Editable photos state
  const [editedImages, setEditedImages] = useState<{ url: string }[]>([]);

  // Track initial values for unsaved-changes detection
  const initialFieldsRef = useRef<EditedFields | null>(null);
  const initialImagesRef = useRef<{ url: string }[]>([]);

  // Bottom sheet refs
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SelectionBottomSheetRef>(null);
  const neighborhoodSheetRef = useRef<NeighborhoodBottomSheetRef>(null);

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

      // Block editing sold articles
      if (articleData.isSold) {
        Alert.alert(
          'Article vendu',
          'Cet article est vendu et ne peut plus être modifié.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
        return;
      }

      setArticle(articleData);
      const loadedImages = articleData.images || [];
      setEditedImages(loadedImages);

      // Get category info
      const categoryInfo = articleData.categoryIds
        ? getCategoryInfoFromIds(articleData.categoryIds)
        : null;

      // Initialize form fields from article — prefer arrays, fallback to single values
      const loadedColors = articleData.colors?.length
        ? articleData.colors
        : articleData.color
          ? [articleData.color.toLowerCase().replace(/\s+/g, '-')]
          : [];
      const loadedMaterials = articleData.materials?.length
        ? articleData.materials
        : articleData.material
          ? [articleData.material.toLowerCase().replace(/\s+/g, '-')]
          : [];

      const loadedFields: EditedFields = {
        title: articleData.title || '',
        description: articleData.description || '',
        categoryIds: articleData.categoryIds || [],
        categoryDisplay: categoryInfo ? {
          icon: categoryInfo.icon || 'pricetag-outline',
          name: categoryInfo.displayName || '',
          context: categoryInfo.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
        } : { icon: 'pricetag-outline', name: articleData.category || '', context: '' },
        condition: (articleData.condition as ConditionValue) || 'très bon état',
        colors: loadedColors,
        materials: loadedMaterials,
        size: articleData.size || null,
        brand: articleData.brand || '',
        price: articleData.price || 0,
        isHandDelivery: articleData.isHandDelivery ?? false,
        isShipping: articleData.isShipping ?? true,
        neighborhoods: articleData.neighborhoods || (articleData.neighborhood ? [articleData.neighborhood] : []),
        packageSize: (articleData.packageSize as PackageSize) || null,
      };

      setFields(loadedFields);

      // Capture initial state for unsaved-changes detection
      initialFieldsRef.current = loadedFields;
      initialImagesRef.current = loadedImages;
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
    if (fields.title.trim().length < 3) {
      Alert.alert('Erreur', 'Le titre doit faire au moins 3 caractères');
      return;
    }

    if (!fields.description.trim()) {
      Alert.alert('Erreur', 'La description est requise');
      return;
    }

    if (fields.price < 0.01) {
      Alert.alert('Erreur', 'Le prix doit être supérieur à 0');
      return;
    }

    if (fields.price > 10000) {
      Alert.alert('Erreur', 'Le prix maximum est de 10 000 $');
      return;
    }

    if (!fields.isHandDelivery && !fields.isShipping) {
      Alert.alert('Erreur', 'Sélectionnez au moins une option de livraison');
      return;
    }

    if (fields.isHandDelivery && fields.neighborhoods.length === 0) {
      Alert.alert('Erreur', 'Sélectionnez au moins un quartier pour la remise en main propre');
      return;
    }

    if (fields.isShipping && !fields.packageSize) {
      Alert.alert('Erreur', 'Sélectionnez une taille de colis pour l\'expédition');
      return;
    }

    setIsSaving(true);
    try {
      // Upload any local images (file://) to Firebase Storage before saving
      let finalImages: ArticleImage[] = editedImages;
      const localUris = editedImages
        .map((img, idx) => ({ uri: img.url, idx }))
        .filter(({ uri }) => !isStorageUrl(uri) && !uri.startsWith('https://'));

      if (localUris.length > 0) {
        const localUriStrings = localUris.map(({ uri }) => uri);
        const uploaded = await ArticlesService.uploadImagesReactNative(localUriStrings, id);
        // Replace local URIs with uploaded Storage URLs
        finalImages = editedImages.map((img, idx) => {
          const localIndex = localUris.findIndex((l) => l.idx === idx);
          if (localIndex !== -1 && uploaded[localIndex]) {
            return uploaded[localIndex];
          }
          return img;
        });
      }

      const articleData: Record<string, unknown> = {
        title: fields.title.trim(),
        description: fields.description.trim(),
        categoryIds: fields.categoryIds,
        category: fields.categoryDisplay.name,
        condition: fields.condition,
        price: fields.price,
      };

      // Colors — always propagate (null clears server-side)
      articleData.colors = fields.colors;
      articleData.color = fields.colors.length > 0 ? fields.colors[0] : null;

      // Materials — always propagate (null clears server-side)
      articleData.materials = fields.materials;
      articleData.material = fields.materials.length > 0 ? fields.materials[0] : null;

      if (fields.size) articleData.size = fields.size;
      const trimmedBrand = fields.brand.trim();
      articleData.brand = trimmedBrand || null;

      // Delivery options
      articleData.isHandDelivery = fields.isHandDelivery;
      articleData.isShipping = fields.isShipping;
      if (fields.neighborhoods.length > 0) {
        articleData.neighborhoods = fields.neighborhoods;
        articleData.neighborhood = fields.neighborhoods[0];
      }
      if (fields.packageSize) articleData.packageSize = fields.packageSize;

      // Photos — always send the resolved images (local URIs now uploaded)
      if (finalImages.length > 0) {
        articleData.images = finalImages;
      }

      await httpsCallable(functions, 'updateArticle')({ articleId: id, updates: articleData });

      // Invalidate article caches so lists and detail reflect the update
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.articles.userList(user.id) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.detail(id) });

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

  const hasUnsavedChanges = useMemo(() => {
    if (!initialFieldsRef.current) return false;
    const init = initialFieldsRef.current;
    const fieldsChanged =
      fields.title !== init.title ||
      fields.description !== init.description ||
      fields.price !== init.price ||
      fields.condition !== init.condition ||
      fields.brand !== init.brand ||
      fields.size !== init.size ||
      fields.isHandDelivery !== init.isHandDelivery ||
      fields.isShipping !== init.isShipping ||
      fields.packageSize !== init.packageSize ||
      JSON.stringify(fields.categoryIds) !== JSON.stringify(init.categoryIds) ||
      JSON.stringify(fields.colors) !== JSON.stringify(init.colors) ||
      JSON.stringify(fields.materials) !== JSON.stringify(init.materials) ||
      JSON.stringify(fields.neighborhoods) !== JSON.stringify(init.neighborhoods);
    const imagesChanged =
      JSON.stringify(editedImages) !== JSON.stringify(initialImagesRef.current);
    return fieldsChanged || imagesChanged;
  }, [fields, editedImages]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (hasUnsavedChanges) {
      Alert.alert(
        'Modifications non enregistrées',
        'Voulez-vous vraiment quitter sans enregistrer ?',
        [
          { text: 'Rester', style: 'cancel' },
          { text: 'Quitter', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }, [router, hasUnsavedChanges]);

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

  const allColorItems = getColorItems();
  const allMaterialItems = getMaterialItems();

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

  // Photo management
  const handleAddPhoto = useCallback(async () => {
    const remainingSlots = 5 - editedImages.length;
    if (remainingSlots <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
        selectionLimit: remainingSlots,
      });
      if (!result.canceled && result.assets.length > 0) {
        const newImages = result.assets.map((asset) => ({ url: asset.uri }));
        setEditedImages((prev) => [...prev, ...newImages.slice(0, remainingSlots)]);
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  }, [editedImages.length]);

  const handleRemovePhoto = useCallback((index: number) => {
    setEditedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMakePrimary = useCallback((index: number) => {
    if (index === 0) return;
    setEditedImages((prev) => {
      const newImages = [...prev];
      const [image] = newImages.splice(index, 1);
      newImages.unshift(image);
      return newImages;
    });
  }, []);

  // Delivery management
  const handleNeighborhoodToggle = useCallback((neighborhood: MeetupNeighborhood) => {
    setFields((prev) => {
      const exists = prev.neighborhoods.some((n) => n.id === neighborhood.id);
      const newNeighborhoods = exists
        ? prev.neighborhoods.filter((n) => n.id !== neighborhood.id)
        : [...prev.neighborhoods, neighborhood];
      return { ...prev, neighborhoods: newNeighborhoods };
    });
  }, []);

  const hasAtLeastOneDelivery = fields.isHandDelivery || fields.isShipping;
  const handDeliveryValid = !fields.isHandDelivery || fields.neighborhoods.length > 0;
  const shippingValid = !fields.isShipping || !!fields.packageSize;

  const isFormValid =
    fields.title.trim().length >= 3 &&
    fields.description.trim() !== '' &&
    fields.categoryIds.length > 0 &&
    fields.price >= 0.01 &&
    fields.price <= 10000 &&
    hasAtLeastOneDelivery &&
    handDeliveryValid &&
    shippingValid;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable onPress={handleBack} style={styles.backButton}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Modifier l'article</Text>
          <View style={styles.headerPlaceholder} />
        </View>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          {/* Photo skeleton */}
          <View style={styles.photoSection}>
            <Skeleton width="100%" height={280} borderRadius={0} />
            <View style={styles.skeletonThumbnailStrip}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} width={60} height={60} borderRadius={8} />
              ))}
            </View>
          </View>
          {/* Form fields skeleton */}
          <View style={styles.formSection}>
            {/* Title field */}
            <View style={styles.skeletonField}>
              <Skeleton width={50} height={14} borderRadius={4} />
              <Skeleton width="100%" height={44} borderRadius={8} style={{ marginTop: 8 }} />
            </View>
            {/* Description field */}
            <View style={styles.skeletonField}>
              <Skeleton width={90} height={14} borderRadius={4} />
              <Skeleton width="100%" height={80} borderRadius={8} style={{ marginTop: 8 }} />
            </View>
            {/* Price field */}
            <View style={styles.skeletonField}>
              <Skeleton width={40} height={14} borderRadius={4} />
              <Skeleton width={120} height={44} borderRadius={8} style={{ marginTop: 8 }} />
            </View>
            {/* Category */}
            <View style={styles.skeletonField}>
              <Skeleton width="100%" height={52} borderRadius={8} />
            </View>
            {/* Condition */}
            <View style={styles.skeletonField}>
              <Skeleton width={80} height={14} borderRadius={4} />
              <View style={styles.skeletonConditionRow}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} width={75} height={36} borderRadius={8} />
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
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
        {/* Photo section — editable */}
        <View style={styles.photoSection}>
          {editedImages.length > 0 && (
            <>
              <View>
                <Image
                  source={{ uri: editedImages[0]?.url }}
                  style={styles.mainPhoto}
                  contentFit="cover"
                />
                <View style={styles.primaryBadge}>
                  <Text style={styles.primaryBadgeText}>PRINCIPALE</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbnailStrip}
                contentContainerStyle={styles.thumbnailContent}
              >
                {editedImages.map((img, index) => (
                  <Pressable
                    key={index}
                    style={[
                      styles.thumbnailWrapper,
                      index === 0 && styles.thumbnailPrimary,
                    ]}
                    onPress={() => handleMakePrimary(index)}
                  >
                    <Image
                      source={{ uri: img.url }}
                      style={styles.thumbnail}
                      contentFit="cover"
                    />
                    <Pressable
                      style={styles.thumbnailRemove}
                      onPress={() => handleRemovePhoto(index)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="close" size={10} color={colors.white} />
                    </Pressable>
                  </Pressable>
                ))}
                {editedImages.length < 5 && (
                  <Pressable style={styles.addPhotoButton} onPress={handleAddPhoto}>
                    <Ionicons name="add" size={24} color={colors.muted} />
                  </Pressable>
                )}
              </ScrollView>
            </>
          )}
          {editedImages.length === 0 && (
            <Pressable style={styles.emptyPhotoButton} onPress={handleAddPhoto}>
              <Ionicons name="camera-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyPhotoText}>Ajouter des photos</Text>
            </Pressable>
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
            suffix="$"
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

          {/* Color — multi-select */}
          <ChipSelector
            label="Couleur"
            selectedValues={fields.colors}
            aiSuggestedIds={[]}
            allItems={allColorItems}
            onToggle={handleColorToggle}
            onViewAll={() => colorSheetRef.current?.show()}
            resolveLabel={resolveColorLabel}
          />

          {/* Material — multi-select */}
          <ChipSelector
            label="Matière"
            selectedValues={fields.materials}
            aiSuggestedIds={[]}
            allItems={allMaterialItems}
            onToggle={handleMaterialToggle}
            onViewAll={() => materialSheetRef.current?.show()}
          />

          {/* Size */}
          <Pressable
            style={styles.sizeSelector}
            onPress={() => sizeSheetRef.current?.show()}
          >
            <Text style={styles.sizeSelectorLabel}>Taille</Text>
            <Text style={[styles.sizeSelectorValue, !fields.size && styles.sizeSelectorPlaceholder]}>
              {fields.size || 'Sélectionner une taille'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>

          {/* Delivery options separator */}
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>Livraison</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Hand delivery toggle */}
          <Pressable
            style={styles.deliveryToggle}
            onPress={() => updateField('isHandDelivery', !fields.isHandDelivery)}
          >
            <View style={styles.deliveryToggleLeft}>
              <Ionicons name="person-outline" size={20} color={colors.foreground} />
              <Text style={styles.deliveryToggleLabel}>Remise en main propre</Text>
            </View>
            <Ionicons
              name={fields.isHandDelivery ? 'checkbox' : 'square-outline'}
              size={22}
              color={fields.isHandDelivery ? colors.primary : colors.muted}
            />
          </Pressable>

          {fields.isHandDelivery && (
            <Pressable
              style={styles.neighborhoodSelector}
              onPress={() => neighborhoodSheetRef.current?.show()}
            >
              <Text style={styles.neighborhoodSelectorText}>
                {fields.neighborhoods.length > 0
                  ? fields.neighborhoods.map((n) => n.name).join(', ')
                  : 'Choisir les quartiers'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          )}

          {/* Shipping toggle */}
          <Pressable
            style={styles.deliveryToggle}
            onPress={() => updateField('isShipping', !fields.isShipping)}
          >
            <View style={styles.deliveryToggleLeft}>
              <Ionicons name="cube-outline" size={20} color={colors.foreground} />
              <Text style={styles.deliveryToggleLabel}>Expédition</Text>
            </View>
            <Ionicons
              name={fields.isShipping ? 'checkbox' : 'square-outline'}
              size={22}
              color={fields.isShipping ? colors.primary : colors.muted}
            />
          </Pressable>

          {fields.isShipping && (
            <View style={styles.packageSizeRow}>
              {(['small', 'medium', 'large'] as const).map((size) => {
                const labels: Record<PackageSize, string> = {
                  small: 'Petit',
                  medium: 'Moyen',
                  large: 'Grand',
                };
                const isSelected = fields.packageSize === size;
                return (
                  <Pressable
                    key={size}
                    style={[styles.packageSizeChip, isSelected && styles.packageSizeChipSelected]}
                    onPress={() => updateField('packageSize', size)}
                  >
                    <Text style={[styles.packageSizeChipText, isSelected && styles.packageSizeChipTextSelected]}>
                      {labels[size]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
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
        items={getSizesForCategory(fields.categoryIds).map((s) => ({
          value: s,
          label: s,
        }))}
        selectedValue={fields.size}
        onSelect={(value) => updateField('size', value)}
        type="size"
      />

      <NeighborhoodBottomSheet
        ref={neighborhoodSheetRef}
        selectedNeighborhoods={fields.neighborhoods}
        onSelect={handleNeighborhoodToggle}
        multiSelect
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  skeletonThumbnailStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  skeletonField: {
    marginBottom: 20,
  },
  skeletonConditionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
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
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnailPrimary: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 10,
  },
  primaryBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  primaryBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  thumbnailRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoButton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
  },
  emptyPhotoButton: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    gap: 8,
  },
  emptyPhotoText: {
    fontSize: 13,
    color: colors.muted,
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
  sizeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.white,
  },
  sizeSelectorLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.foreground,
    marginRight: 12,
  },
  sizeSelectorValue: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
  },
  sizeSelectorPlaceholder: {
    color: colors.muted,
  },
  deliveryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: colors.white,
  },
  deliveryToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deliveryToggleLabel: {
    fontSize: 14,
    color: colors.foreground,
  },
  neighborhoodSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginLeft: 32,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  neighborhoodSelectorText: {
    flex: 1,
    fontSize: 13,
    color: colors.foreground,
  },
  packageSizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 32,
    marginBottom: 16,
  },
  packageSizeChip: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  packageSizeChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  packageSizeChipText: {
    fontSize: 13,
    color: colors.foreground,
  },
  packageSizeChipTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
});
