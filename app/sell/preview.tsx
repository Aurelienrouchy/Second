import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import PhotoCarousel from '@/components/PhotoCarousel';
import SuccessModal from '@/components/sell/SuccessModal';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft } from '@/services/draftService';
import { ArticlesService } from '@/services/articlesService';
import { auth } from '@/config/firebaseConfig';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HERO_HEIGHT = 340;

const conditionLabels: Record<string, string> = {
  neuf: 'Neuf',
  'très bon état': 'Très bon état',
  'bon état': 'Bon état',
  satisfaisant: 'Satisfaisant',
};

const packageSizeLabels: Record<string, string> = {
  small: 'Petit colis',
  medium: 'Colis moyen',
  large: 'Grand colis',
};

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: string;
  colors: string[];
  materials: string[];
  size: string | null;
  brand: string;
}

interface PricingData {
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhood: MeetupNeighborhood | null;
  neighborhoods: MeetupNeighborhood[];
  packageSize: string | null;
}

export default function PreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const isResuming = params.resumeDraft === 'true';
  const photosFromParams: string[] = params.photos ? JSON.parse(params.photos as string) : [];
  const fieldsFromParams: EditedFields = params.fields ? JSON.parse(params.fields as string) : {};
  const pricingFromParams: PricingData = params.pricing
    ? JSON.parse(params.pricing as string)
    : { price: 0, isHandDelivery: false, isShipping: false, neighborhood: null, neighborhoods: [], packageSize: null };
  const aiResult: AIAnalysisResult | null = params.aiResult
    ? JSON.parse(params.aiResult as string)
    : null;
  const storageUrlsFromParams: string[] = params.storageUrls
    ? JSON.parse(params.storageUrls as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(photosFromParams);
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);
  const [fields, setFields] = useState<EditedFields>(fieldsFromParams);
  const [pricing, setPricing] = useState<PricingData>(pricingFromParams);
  const publishingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [publishedArticleId, setPublishedArticleId] = useState<string | null>(null);

  // Photo carousel active index
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load draft on resume
  useEffect(() => {
    const loadDraft = async () => {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        if (isResuming) {
          if (existingDraft.photos.length > 0) setPhotos(existingDraft.photos);
          if (existingDraft.storageUrls?.length) setStorageUrls(existingDraft.storageUrls);
          if (existingDraft.fields) setFields(existingDraft.fields as EditedFields);
          if (existingDraft.pricing) setPricing(existingDraft.pricing as PricingData);
        }
        if (existingDraft.currentStep < 4) {
          await draftService.updateDraftStep(existingDraft, 4);
        }
      }
    };
    loadDraft();
  }, [isResuming]);

  const handleBack = () => {
    router.back();
  };

  const handlePublish = async () => {
    // Synchronous guard: prevents double-tap before React state update
    if (publishingRef.current) return;
    publishingRef.current = true;

    // TODO: check for duplicate articles (similar title/photos) before publishing

    // ── Pre-publication validation (C5) ──
    const validationErrors: string[] = [];
    if (!fields.title || fields.title.trim().length < 3) {
      validationErrors.push('Le titre doit contenir au moins 3 caractères');
    }
    if (!pricing.price || pricing.price <= 0) {
      validationErrors.push('Entrez un prix valide');
    }
    if (pricing.price > 10000) {
      validationErrors.push('Le prix maximum est de 10 000 $');
    }
    const imageUrls = storageUrls.length > 0 ? storageUrls : photos;
    if (!imageUrls || imageUrls.length === 0) {
      validationErrors.push('Ajoutez au moins une photo');
    }
    if (!fields.categoryIds || fields.categoryIds.length === 0) {
      validationErrors.push('Sélectionnez une catégorie');
    }
    if (validationErrors.length > 0) {
      publishingRef.current = false;
      Alert.alert('Informations manquantes', validationErrors.join('\n'));
      return;
    }

    setIsPublishing(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non connecté');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- articleData built dynamically with optional fields
      const articleData: any = {
        title: fields.title,
        description: fields.description,
        price: pricing.price,
        images: imageUrls.map((uri) => ({ url: uri })),
        category: fields.categoryDisplay?.name || '',
        categoryIds: fields.categoryIds || [],
        condition: fields.condition as 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant',
        sellerId: currentUser.uid,
        sellerName: currentUser.displayName || 'Utilisateur',
        isHandDelivery: pricing.isHandDelivery,
        isShipping: pricing.isShipping,
      };

      // Vendor input stays on the EU grid (no system toggle this lot), so we
      // tag the system explicitly. Omit when empty (never undefined in Firestore).
      if (fields.size) articleData.size = { value: fields.size, system: 'EU' as const };
      if (fields.brand) articleData.brand = fields.brand;

      // Colors — multi-select with backward compat (C2)
      if (fields.colors && fields.colors.length > 0) {
        articleData.colors = fields.colors;
        articleData.color = fields.colors[0];
      }

      // Materials — multi-select with backward compat (C2)
      if (fields.materials && fields.materials.length > 0) {
        articleData.materials = fields.materials;
        articleData.material = fields.materials[0];
      }

      if (currentUser.photoURL) articleData.sellerImage = currentUser.photoURL;

      // Neighborhoods — multi-select with backward compat (C8)
      if (pricing.neighborhoods && pricing.neighborhoods.length > 0) {
        articleData.neighborhoods = pricing.neighborhoods;
        articleData.neighborhood = pricing.neighborhoods[0];
      } else if (pricing.neighborhood) {
        articleData.neighborhood = pricing.neighborhood;
        articleData.neighborhoods = [pricing.neighborhood];
      }

      if (pricing.packageSize) articleData.packageSize = pricing.packageSize;

      const articleId = await ArticlesService.createArticle(articleData);
      await draftService.deleteDraft(true);

      setPublishedArticleId(articleId);
      setIsPublishing(false);
      setShowSuccessModal(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('[Preview] Error publishing article:', error);
      setIsPublishing(false);
      const message = error instanceof Error ? error.message : 'Une erreur est survenue lors de la publication';
      Alert.alert(
        'Erreur',
        message,
        [{ text: 'OK' }]
      );
    } finally {
      publishingRef.current = false;
    }
  };

  // Build tags array
  const tags: string[] = [];
  if (fields.condition) tags.push(conditionLabels[fields.condition] || fields.condition);
  if (fields.size) tags.push(fields.size);
  if (fields.colors?.length > 0) {
    fields.colors.forEach((c) => tags.push(c));
  }
  if (fields.materials?.length > 0) {
    fields.materials.forEach((m) => tags.push(m));
  }

  // Specs grid
  const colorsDisplay = fields.colors?.length > 0 ? fields.colors.join(', ') : null;
  const materialsDisplay = fields.materials?.length > 0 ? fields.materials.join(', ') : null;
  const specs = [
    { label: 'Condition', value: conditionLabels[fields.condition] || fields.condition },
    { label: 'Taille', value: fields.size },
    { label: 'Couleur', value: colorsDisplay },
    { label: 'Matière', value: materialsDisplay },
  ].filter((s) => s.value);

  return (
    <View style={styles.container}>
      <View style={{ paddingTop: insets.top }} />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Hero image */}
        <View style={styles.heroContainer}>
          <PhotoCarousel photos={photos} height={HERO_HEIGHT} />

          {/* Back button overlay */}
          <Pressable
            style={({ pressed }) => [styles.heroBackButton, { top: insets.top + 8 }, pressed && { opacity: 0.7 }]}
            onPress={handleBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.cream} />
          </Pressable>

          {/* Preview badge */}
          <View style={[styles.previewBadge, { top: insets.top + 12 }]}>
            <Text style={styles.previewBadgeText}>APERÇU</Text>
          </View>
        </View>

        {/* Article content */}
        <View style={styles.articleContent}>
          {/* Brand */}
          {fields.brand ? (
            <Text style={styles.brandText}>{fields.brand.toUpperCase()}</Text>
          ) : null}

          {/* Title */}
          <Text style={styles.articleTitle}>{fields.title}</Text>

          {/* Price */}
          <Text style={styles.articlePrice}>{formatPrice(pricing.price ?? 0)}</Text>

          {/* Tags row */}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description */}
          {fields.description ? (
            <Text style={styles.descriptionText}>{fields.description}</Text>
          ) : null}

          {/* Specs grid */}
          {specs.length > 0 && (
            <View style={styles.specsGrid}>
              {specs.map((spec, index) => (
                <View
                  key={index}
                  style={[
                    styles.specCell,
                    index % 2 === 0 && styles.specCellLeft,
                    index < specs.length - (specs.length % 2 === 0 ? 2 : 1) && styles.specCellTop,
                  ]}
                >
                  <Text style={styles.specLabel}>{spec.label.toUpperCase()}</Text>
                  <Text style={styles.specValue}>{spec.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Delivery badges */}
          <View style={styles.deliveryRow}>
            {pricing.isHandDelivery && pricing.neighborhoods?.length > 0
              ? pricing.neighborhoods.map((n) => (
                  <View key={n.id} style={styles.deliveryBadge}>
                    <Ionicons name="person-outline" size={14} color={colors.charcoal} />
                    <Text style={styles.deliveryBadgeText}>{n.name}</Text>
                  </View>
                ))
              : pricing.isHandDelivery && pricing.neighborhood ? (
                  <View style={styles.deliveryBadge}>
                    <Ionicons name="person-outline" size={14} color={colors.charcoal} />
                    <Text style={styles.deliveryBadgeText}>{pricing.neighborhood.name}</Text>
                  </View>
                ) : null}
            {SHIPPING_ENABLED && pricing.isShipping && (
              <View style={styles.deliveryBadge}>
                <Ionicons name="cube-outline" size={14} color={colors.charcoal} />
                <Text style={styles.deliveryBadgeText}>Expédition</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={({ pressed }) => [styles.publishButton, isPublishing && styles.publishButtonDisabled, pressed && { opacity: 0.7 }]}
          onPress={handlePublish}
          disabled={isPublishing}
        >
          {isPublishing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color={colors.cream} />
              <Text style={styles.publishButtonText}>PUBLIER L'ANNONCE</Text>
            </>
          )}
        </Pressable>

        <Pressable style={({ pressed }) => [styles.modifyButton, pressed && { opacity: 0.7 }]} onPress={handleBack}>
          <Text style={styles.modifyButtonText}>Modifier</Text>
        </Pressable>
      </View>

      {/* Success modal */}
      <SuccessModal
        visible={showSuccessModal}
        articleTitle={fields.title}
        onViewArticle={() => {
          setShowSuccessModal(false);
          if (publishedArticleId) {
            // Single replace into the article route so back navigation
            // bubbles up cleanly to (tabs). The previous flow had a
            // 100ms setTimeout between replace('/(tabs)') and push(...)
            // that raced with focus-effects re-firing in the sell tab,
            // dispatching an unhandled GO_BACK.
            router.replace(`/article/${publishedArticleId}` as any);
          } else {
            router.replace('/(tabs)');
          }
        }}
        onReturnHome={() => {
          setShowSuccessModal(false);
          router.replace('/(tabs)');
        }}
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
  // Hero
  heroContainer: {
    position: 'relative',
  },
  heroBackButton: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBadge: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(196, 96, 58, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 2,
  },
  previewBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.white,
    textTransform: 'uppercase',
  },
  // Article content — matches design .preview-detail-body { padding: 20px 24px }
  articleContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  brandText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.65,
    color: colors.muted,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  articleTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.charcoal,
    lineHeight: 30,
    marginBottom: 10,
  },
  articlePrice: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.rust,
    marginBottom: 16,
  },
  // Tags — matches design .preview-tag
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  tag: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 2,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
    letterSpacing: 0.44,
  },
  // Description
  descriptionText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 22,
    color: colors.charcoal,
    marginBottom: 16,
  },
  // Specs grid — matches design .preview-specs
  specsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
  },
  specCell: {
    width: '50%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  specCellLeft: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  specCellTop: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  specLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.08,
    color: colors.muted,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  specValue: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.charcoal,
  },
  // Delivery — matches design .preview-delivery-badge
  deliveryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  deliveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deliveryBadgeText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
    letterSpacing: 0.44,
  },
  // Footer — matches design .sticky-footer (cream bg, 24px horizontal)
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: 10,
    marginBottom: 10,
  },
  publishButtonDisabled: {
    opacity: 0.7,
  },
  publishButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  modifyButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: colors.charcoal,
    borderRadius: radius.md,
  },
  modifyButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.charcoal,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
});
