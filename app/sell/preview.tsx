import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SellFlowHeader from '@/components/SellFlowHeader';
import PhotoCarousel from '@/components/PhotoCarousel';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft } from '@/services/draftService';
import { ArticlesService } from '@/services/articlesService';
import { auth } from '@/config/firebaseConfig';

// Condition display mapping
const conditionLabels: Record<string, string> = {
  neuf: 'Neuf avec étiquettes',
  'très bon état': 'Très bon état',
  'bon état': 'Bon état',
  satisfaisant: 'Satisfaisant',
};

// Package size display mapping
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
  color: string | null;
  material: string | null;
  size: string | null;
  brand: string;
}

interface PricingData {
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhood: MeetupNeighborhood | null;
  packageSize: string | null;
}

export default function PreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  // Parse params
  const isResuming = params.resumeDraft === 'true';
  const photosFromParams: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];
  const fieldsFromParams: EditedFields = params.fields
    ? JSON.parse(params.fields as string)
    : {};
  const pricingFromParams: PricingData = params.pricing
    ? JSON.parse(params.pricing as string)
    : { price: 0, isHandDelivery: false, isShipping: false, neighborhood: null, packageSize: null };
  const aiResult: AIAnalysisResult | null = params.aiResult
    ? JSON.parse(params.aiResult as string)
    : null;
  const storageUrlsFromParams: string[] = params.storageUrls
    ? JSON.parse(params.storageUrls as string)
    : [];

  // State - loaded from params or draft
  const [photos, setPhotos] = useState<string[]>(photosFromParams);
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);
  const [fields, setFields] = useState<EditedFields>(fieldsFromParams);
  const [pricing, setPricing] = useState<PricingData>(pricingFromParams);

  // Debug: Log what we received from params
  console.log('[Preview] Initialized with:', {
    photosCount: photosFromParams.length,
    storageUrlsCount: storageUrlsFromParams.length,
    storageUrls: storageUrlsFromParams,
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successScale] = useState(new Animated.Value(0));
  const [successOpacity] = useState(new Animated.Value(0));

  // Load draft and restore data on mount
  useEffect(() => {
    const loadDraft = async () => {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        // If resuming, restore all data from draft
        if (isResuming) {
          console.log('[Preview] Resuming draft, restoring data');
          if (existingDraft.photos.length > 0) {
            setPhotos(existingDraft.photos);
          }
          if (existingDraft.storageUrls && existingDraft.storageUrls.length > 0) {
            setStorageUrls(existingDraft.storageUrls);
          }
          if (existingDraft.fields) {
            setFields(existingDraft.fields as EditedFields);
          }
          if (existingDraft.pricing) {
            setPricing(existingDraft.pricing as PricingData);
          }
        }

        // Update step to 4 if not already
        if (existingDraft.currentStep < 4) {
          await draftService.updateDraftStep(existingDraft, 4);
        }
      }
    };
    loadDraft();
  }, [isResuming]);

  const handleModify = () => {
    router.back();
  };

  const handlePublish = async () => {
    setIsPublishing(true);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non connecté');
      }

      // Use Storage URLs if available (fast path - images already uploaded during AI analysis)
      // Otherwise fall back to local photos (will be uploaded by ArticlesService)
      const imageUrls = storageUrls.length > 0 ? storageUrls : photos;
      console.log('[Preview] 📸 Image URLs decision:', {
        storageUrlsCount: storageUrls.length,
        storageUrls: storageUrls,
        photosCount: photos.length,
        usingPath: storageUrls.length > 0 ? 'Storage URLs (fast path)' : 'local photos',
        finalImageUrls: imageUrls,
      });

      // Build article data from fields and pricing
      // Only include optional fields if they have values (Firestore doesn't accept undefined)
      const articleData: any = {
        title: fields.title,
        description: fields.description,
        price: pricing.price,
        images: imageUrls.map(uri => ({ url: uri })),
        category: fields.categoryDisplay?.name || '',
        categoryIds: fields.categoryIds || [],
        condition: fields.condition as 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant',
        sellerId: currentUser.uid,
        sellerName: currentUser.displayName || 'Utilisateur',
        isHandDelivery: pricing.isHandDelivery,
        isShipping: pricing.isShipping,
      };

      // Add optional fields only if they have values
      if (fields.size) articleData.size = fields.size;
      if (fields.brand) articleData.brand = fields.brand;
      if (fields.color) articleData.color = fields.color;
      if (fields.material) articleData.material = fields.material;
      if (currentUser.photoURL) articleData.sellerImage = currentUser.photoURL;
      if (pricing.neighborhood) articleData.neighborhood = pricing.neighborhood;
      if (pricing.packageSize) articleData.packageSize = pricing.packageSize;

      console.log('[Preview] Publishing article:', articleData);

      // Create article in Firebase
      const articleId = await ArticlesService.createArticle(articleData);
      console.log('[Preview] Article created with ID:', articleId);

      // Delete draft on successful publish (but keep Storage images for the article!)
      await draftService.deleteDraft(true); // keepStorageImages = true

      console.log('[Preview] ✅ Article published successfully:', {
        articleId,
        imagesCount: imageUrls.length,
        imageUrls,
        draftDeleted: true,
        storageImagesKept: true,
      });

      setIsPublishing(false);
      setShowSuccessModal(true);

      // Animate success modal
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto navigate after delay
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 2500);
    } catch (error: any) {
      console.error('[Preview] Error publishing article:', error);
      setIsPublishing(false);
      // Show error alert
      Alert.alert(
        'Erreur',
        error.message || 'Une erreur est survenue lors de la publication',
        [{ text: 'OK' }]
      );
    }
  };

  const formatPrice = (price: number | undefined) => {
    if (price === undefined || price === null) return '0,00 $';
    return price.toFixed(2).replace('.', ',') + ' $';
  };

  return (
    <View style={styles.container}>
      <SellFlowHeader currentStep={4} confirmClose={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Vérifiez votre annonce</Text>
          <Text style={styles.subtitle}>
            Voici comment les acheteurs verront votre article
          </Text>
        </View>

        {/* Article Preview Card */}
        <View style={styles.previewCard}>
          {/* Photo carousel */}
          <PhotoCarousel photos={photos} height={320} />

          {/* Article info */}
          <View style={styles.articleInfo}>
            {/* Title & Price */}
            <Text style={styles.articleTitle}>{fields.title}</Text>
            <Text style={styles.articlePrice}>{formatPrice(pricing.price)}</Text>

            {/* Description */}
            {fields.description && (
              <Text style={styles.articleDescription} numberOfLines={3}>
                {fields.description}
              </Text>
            )}

            {/* Details */}
            <View style={styles.detailsGrid}>
              {/* Category */}
              <View style={styles.detailItem}>
                <View style={styles.detailIcon}>
                  <Text style={styles.categoryIcon}>
                    {fields.categoryDisplay?.icon || '📦'}
                  </Text>
                </View>
                <Text style={styles.detailLabel}>Catégorie</Text>
                <Text style={styles.detailValue}>
                  {fields.categoryDisplay?.name || 'Non spécifié'}
                </Text>
              </View>

              {/* Condition */}
              <View style={styles.detailItem}>
                <View style={styles.detailIcon}>
                  <Ionicons name="star" size={18} color="#F79F24" />
                </View>
                <Text style={styles.detailLabel}>État</Text>
                <Text style={styles.detailValue}>
                  {conditionLabels[fields.condition] || fields.condition}
                </Text>
              </View>

              {/* Size */}
              {fields.size && (
                <View style={styles.detailItem}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="resize" size={18} color="#8B5CF6" />
                  </View>
                  <Text style={styles.detailLabel}>Taille</Text>
                  <Text style={styles.detailValue}>{fields.size}</Text>
                </View>
              )}

              {/* Brand */}
              {fields.brand && (
                <View style={styles.detailItem}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="pricetag" size={18} color="#10B981" />
                  </View>
                  <Text style={styles.detailLabel}>Marque</Text>
                  <Text style={styles.detailValue}>{fields.brand}</Text>
                </View>
              )}

              {/* Color */}
              {fields.color && (
                <View style={styles.detailItem}>
                  <View style={styles.detailIcon}>
                    <View style={[styles.colorDot, { backgroundColor: '#6B7280' }]} />
                  </View>
                  <Text style={styles.detailLabel}>Couleur</Text>
                  <Text style={styles.detailValue}>{fields.color}</Text>
                </View>
              )}

              {/* Material */}
              {fields.material && (
                <View style={styles.detailItem}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="layers" size={18} color="#3B82F6" />
                  </View>
                  <Text style={styles.detailLabel}>Matière</Text>
                  <Text style={styles.detailValue}>{fields.material}</Text>
                </View>
              )}
            </View>

            {/* Delivery badges */}
            <View style={styles.deliverySection}>
              <Text style={styles.deliverySectionTitle}>Options de livraison</Text>
              <View style={styles.deliveryBadges}>
                {pricing.isShipping && (
                  <View style={styles.deliveryBadge}>
                    <Ionicons name="cube-outline" size={16} color="#6B7280" />
                    <Text style={styles.deliveryBadgeText}>
                      Livraison • {packageSizeLabels[pricing.packageSize || 'medium']}
                    </Text>
                  </View>
                )}
                {pricing.isHandDelivery && (
                  <View style={styles.deliveryBadge}>
                    <Ionicons name="location-outline" size={16} color="#6B7280" />
                    <Text style={styles.deliveryBadgeText}>
                      Remise en main propre • {pricing.neighborhood?.name}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Modify button */}
        <TouchableOpacity style={styles.modifyButton} onPress={handleModify}>
          <Ionicons name="pencil" size={18} color="#F79F24" />
          <Text style={styles.modifyButtonText}>Modifier</Text>
        </TouchableOpacity>

        {/* AI disclaimer */}
        {aiResult && (
          <View style={styles.aiDisclaimer}>
            <Ionicons name="sparkles" size={16} color="#8B5CF6" />
            <Text style={styles.aiDisclaimerText}>
              Les informations ont été préremplies par l'IA. Vérifiez qu'elles sont correctes avant de publier.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Footer with Publish button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.publishButton, isPublishing && styles.publishButtonDisabled]}
          onPress={handlePublish}
          disabled={isPublishing}
          activeOpacity={0.8}
        >
          {isPublishing ? (
            <View style={styles.loadingContainer}>
              <View style={styles.loadingDot} />
              <View style={[styles.loadingDot, styles.loadingDotDelay1]} />
              <View style={[styles.loadingDot, styles.loadingDotDelay2]} />
            </View>
          ) : (
            <>
              <Ionicons name="rocket" size={20} color="#FFFFFF" />
              <Text style={styles.publishButtonText}>Publier l'article</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Success Modal */}
      <Modal visible={showSuccessModal} transparent animationType="none">
        <View style={styles.modalOverlay}>
          <Animated.View
            style={[
              styles.successModal,
              {
                opacity: successOpacity,
                transform: [{ scale: successScale }],
              },
            ]}
          >
            <View style={styles.successIconContainer}>
              <Ionicons name="checkmark-circle" size={80} color="#22C55E" />
            </View>
            <Text style={styles.successTitle}>Article publié !</Text>
            <Text style={styles.successSubtitle}>
              Votre article est maintenant visible par tous les acheteurs
            </Text>
            <View style={styles.confettiContainer}>
              <Text style={styles.confetti}>🎉</Text>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
  },
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  articleInfo: {
    padding: 20,
  },
  articleTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  articlePrice: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F79F24',
    marginBottom: 12,
  },
  articleDescription: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
    marginBottom: 20,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  detailItem: {
    width: '47%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  detailIcon: {
    marginBottom: 8,
  },
  categoryIcon: {
    fontSize: 18,
  },
  detailLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  deliverySection: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 16,
  },
  deliverySectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  deliveryBadges: {
    gap: 8,
  },
  deliveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  deliveryBadgeText: {
    fontSize: 14,
    color: '#374151',
  },
  modifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#F79F24',
  },
  modifyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F79F24',
  },
  aiDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
  },
  aiDisclaimerText: {
    flex: 1,
    fontSize: 13,
    color: '#6D28D9',
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F79F24',
    paddingVertical: 16,
    borderRadius: 14,
  },
  publishButtonDisabled: {
    backgroundColor: '#FCD34D',
  },
  publishButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  loadingContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  loadingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
  },
  loadingDotDelay1: {
    opacity: 0.7,
  },
  loadingDotDelay2: {
    opacity: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  successIconContainer: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  confettiContainer: {
    position: 'absolute',
    top: -20,
    right: -10,
  },
  confetti: {
    fontSize: 40,
  },
});
