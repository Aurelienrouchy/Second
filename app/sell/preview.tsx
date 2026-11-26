import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PhotoCarousel from '@/features/sell/components/shared/PhotoCarousel';
import SuccessModal from '@/features/sell/components/shared/SuccessModal';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import draftService, { ArticleDraft, DraftSession } from '@/features/sell/services/draftService';
import { isObject, isStringArray, parseRouteParam } from '@/features/sell/utils/routeParams';
import { ArticleChildSafetyFields } from '@/components/ArticleChildSafetyFields';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { articleChildSafetyInput } from '@/utils/articleChildSafetyInput';
import { childSafetyCategory } from '@/functions/src/shared/articleChildSafety';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';
import { ChildSafetyReviewService } from '@/services/childSafetyReviewService';
import { ProductReviewService, productReviewHash } from '@/services/productReviewService';
import { ArticlesService } from '@/services/articlesService';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { auth } from '@/config/firebaseConfig';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { colors, components, fonts, spacing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { getConditionLabel } from '@/data/conditions';
import { getColorName } from '@/data/colors';
import { getMaterialName } from '@/data/materials';
import { getListingDeclarationErrors } from '@/features/sell/utils/listingValidation';
import type { SizeSystem } from '@/types/article';
import { isValidArticlePrice } from '@/functions/src/shared/article';
import { articleHygieneRequirement, evaluateArticleHygieneInput, type ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';

const HERO_HEIGHT = 340;

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: string;
  quantity?: number;
  childSafetyDeclaration?: ArticleChildSafetyDraft | null;
  stock?: number;
  conditionConfirmed?: boolean;
  hygieneDeclaration?: ArticleHygieneDeclarationInput | null;
  colors: string[];
  materials: string[];
  size: string | null;
  sizeSystem?: SizeSystem;
  brand: string | null;
}

interface PricingData {
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhood: MeetupNeighborhood | null;
  neighborhoods: MeetupNeighborhood[];
  packageSize: string | null;
}

/** Build the displayed tuple once. A replay template retains its original
 * statement shape; this comparison never adds consent to a historical intent. */
function buildPublicationInput(fields: EditedFields, pricing: PricingData, imageUrls: string[], replayTemplate: Record<string, unknown> | null): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: fields.title, description: fields.description, price: pricing.price,
    images: imageUrls.map(url => ({url})), category: fields.categoryDisplay?.name || '',
    categoryIds: fields.categoryIds || [], condition: fields.condition,
    isHandDelivery: pricing.isHandDelivery, isShipping: pricing.isShipping,
  };
  if (fields.size) input.size = {value: fields.size, system: fields.sizeSystem ?? 'EU'};
  if (fields.brand) input.brand = fields.brand;
  else input.brand = null;
  if (fields.colors?.length) {input.colors = fields.colors; input.color = fields.colors[0];}
  if (fields.materials?.length) {input.materials = fields.materials; input.material = fields.materials[0];}
  if (pricing.neighborhoods?.length) {input.neighborhoods = pricing.neighborhoods; input.neighborhood = pricing.neighborhoods[0];}
  else if (pricing.neighborhood) {input.neighborhood = pricing.neighborhood; input.neighborhoods = [pricing.neighborhood];}
  if (pricing.isShipping && pricing.packageSize) input.packageSize = pricing.packageSize;
  if (replayTemplate && Object.prototype.hasOwnProperty.call(replayTemplate, 'childSafetyDeclaration')) input.childSafetyDeclaration = replayTemplate.childSafetyDeclaration;
  else if (!replayTemplate && articleChildSafetyInput(fields.childSafetyDeclaration)) input.childSafetyDeclaration = articleChildSafetyInput(fields.childSafetyDeclaration);
  if (fields.hygieneDeclaration !== undefined) input.hygieneDeclaration = fields.hygieneDeclaration;
  if (!replayTemplate || Object.prototype.hasOwnProperty.call(replayTemplate, 'quantity')) input.quantity = fields.quantity ?? 1;
  if ((!replayTemplate || Object.prototype.hasOwnProperty.call(replayTemplate, 'stock')) && fields.stock !== undefined) input.stock = fields.stock;
  // Historical retries retain only the exact fields already present in their journal.
  if (replayTemplate) for (const key of ['saleDeclaration', 'inventoryUnitDeclaration', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription']) {
    if (Object.prototype.hasOwnProperty.call(replayTemplate, key)) input[key] = replayTemplate[key];
  }
  return input;
}

export default function PreviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const showAdmissionError = useTradeAdmissionError();
  const navigation = useNavigation();
  const [draftSession] = useState<DraftSession | null>(() => {
    try { return draftService.captureSession(); } catch { return null; }
  });
  const photoOwnerUid = draftSession?.uid;
  const scope = useLabelLifecycleContext('publication-preview', photoOwnerUid ?? null);
  const activeOperation = useRef<ReturnType<typeof scope.capture> | null>(null);
  const assertContext = () => {
    if (!draftSession || !isMountedRef.current) throw new Error('La session a changé.');
    draftService.assertCurrentSession(draftSession);
    if (activeOperation.current) scope.assertCurrent(activeOperation.current);
    else scope.capture();
  };
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const isResuming = params.resumeDraft === 'true';
  const photosFromParams = parseRouteParam(params.photos, [] as string[], isStringArray);
  const fieldsFromParams = parseRouteParam<EditedFields>(params.fields, {} as EditedFields, isObject);
  const pricingFromParams = parseRouteParam<PricingData>(
    params.pricing,
    { price: 0, isHandDelivery: false, isShipping: false, neighborhood: null, neighborhoods: [], packageSize: null },
    isObject,
  );
  const aiResult = parseRouteParam<AIAnalysisResult | null>(params.aiResult, null, isObject);
  const storageUrlsFromParams = parseRouteParam(params.storageUrls, [] as string[], isStringArray);

  const [photos, setPhotos] = useState<string[]>(photosFromParams);
  const [storageUrls, setStorageUrls] = useState<string[]>(storageUrlsFromParams);
  const [fields, setFields] = useState<EditedFields>(fieldsFromParams);
  const [pricing, setPricing] = useState<PricingData>(pricingFromParams);
  const publishingRef = useRef(false);
  const displayedDraftRef = useRef<ArticleDraft | null>(null);
  const publishAttemptRef = useRef<{ draft: ArticleDraft; input: string } | null>(null);
  const isMountedRef = useRef(true);
  const [publishingState, setPublishingState] = useState({frame: scope.frame, focus: scope.focusRevision, value: false});
  const isPublishing = publishingState.frame === scope.frame && publishingState.focus === scope.focusRevision && publishingState.value;
  const setIsPublishing = (value: boolean) => setPublishingState({frame: scope.frame, focus: scope.focusRevision, value});
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [publicationObservation, setPublicationObservation] = useState<{frame: typeof scope.frame; focus: typeof scope.focusRevision; state: 'online' | 'preparation' | 'unknown'} | null>(null);
  const [publishedArticleId, setPublishedArticleId] = useState<string | null>(null);
  const [hasPendingPublication, setHasPendingPublication] = useState(false);
  const [pendingPublicationInput, setPendingPublicationInput] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftReadFailed, setDraftReadFailed] = useState(false);
  const [draftReadRevision, setDraftReadRevision] = useState(0);
  const [lastFocus, setLastFocus] = useState(scope.focusRevision);
  if (lastFocus !== scope.focusRevision) {setLastFocus(scope.focusRevision); setDraftReady(false);}
  let pendingView: Record<string, unknown> | null = null;
  try {const parsed: unknown = pendingPublicationInput ? JSON.parse(pendingPublicationInput) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) pendingView = parsed as Record<string, unknown>;
  } catch { /* The journal service remains authoritative; no new intent is inferred. */ }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The back gesture and the Android back button bypassed `handleBack`: the
  // screen left mid-publish, the article went online, and the seller — who
  // never saw the success — could publish it a second time.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (publishingRef.current && activeOperation.current && scope.isCurrent(activeOperation.current)) e.preventDefault();
      }),
    [navigation],
  );

  // Load draft on resume
  useEffect(() => {
    if (!scope.focused || !draftSession) return;
    let operation;
    try {operation = scope.capture();} catch {return;}
    const assertLoad = () => {draftService.assertCurrentSession(draftSession!); scope.assertCurrent(operation);};
    const loadDraft = async () => {
      assertLoad();
      const existingDraft = await draftService.loadDraft();
      assertLoad();
      if (!existingDraft) throw new Error('Brouillon indisponible. Rouvrez cet aperçu depuis votre brouillon.');
      if (existingDraft) {
        displayedDraftRef.current = existingDraft;
        if (isResuming) {
          if (existingDraft.photos.length > 0) setPhotos(existingDraft.photos);
          if (existingDraft.storageUrls?.length) setStorageUrls(existingDraft.storageUrls);
          if (existingDraft.fields) setFields(existingDraft.fields as EditedFields);
          // The pricing screen passes what the seller JUST entered; its draft
          // write is debounced and may lag behind.
          if (existingDraft.pricing && !params.pricing) {
            const saved = existingDraft.pricing as PricingData;
            // Same coercion as the pricing screen: with shipping off, a
            // legacy shipping draft comes back as hand delivery.
            setPricing({
              ...saved,
              isHandDelivery: SHIPPING_LISTINGS_ENABLED ? !!saved.isHandDelivery : true,
              isShipping: SHIPPING_LISTINGS_ENABLED ? !!saved.isShipping : false,
            });
          }
        }
        // L'aperçu marque l'étape atteinte : un brouillon abandonné ici y
        // revient, avec son prix et sa livraison relus du brouillon.
        if (existingDraft.currentStep < 4) {
          const updated = await draftService.updateDraftStep(existingDraft, 4);
          assertLoad();
          displayedDraftRef.current = updated;
        }
        const pendingInput = await ArticlesService.getPendingPublicationInput(existingDraft.id, assertLoad);
        assertLoad();
        setHasPendingPublication(pendingInput !== null);
        setPendingPublicationInput(pendingInput);
        setDraftReady(true);
        setDraftReadFailed(false);
      }
    };
    void loadDraft().catch(() => {
      if (scope.isCurrent(operation)) setDraftReadFailed(true);
      if (__DEV__) console.warn('Draft initialization interrupted');
    });
  }, [isResuming, photoOwnerUid, scope.focusRevision, scope.focused, draftReadRevision]);
  const handleBack = () => {
    // Block navigation while a publish request is in flight so the user
    // cannot leave (and unmount the screen) mid-createArticle.
    if (isPublishing) return;
    router.back();
  };
  const handleEdit = () => {
    if (isPublishing) return;
    try { assertContext(); } catch { return; }
    if (isResuming) {
      router.replace({ pathname: '/sell/details', params: { resumeDraft: 'true' } });
    } else router.back();
  };

  const handlePublish = async () => {
    try { assertContext(); } catch {
      Alert.alert('Session changée', 'Rouvrez la création d’article avec votre compte actuel.');
      return;
    }
    // Synchronous guard: prevents double-tap before React state update
    if (publishingRef.current && activeOperation.current && scope.isCurrent(activeOperation.current)) return;
    if (!draftReady) return;
    publishingRef.current = true;
    // Uploaded images are used only when they mirror the photos shown, one
    // for one. All-or-nothing silently dropped the photos added after the
    // analysis; without local photos (purged cache), they are all there is.
    const imageUrls =
      storageUrls.length > 0 && (photos.length === 0 || storageUrls.length === photos.length)
        ? storageUrls
        : photos;
    const aiUsed = !!(aiResult && (aiResult.title || aiResult.category?.categoryId));

    const operation = scope.capture(); activeOperation.current = operation;
    setIsPublishing(true);
    setShowSuccessModal(false);
    setPublicationObservation(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non connecté');
      }

      // The draft id identifies this publish: retried after a lost response,
      // it returns the article already created instead of publishing a copy.
      assertContext();
      const draftForRequest = await draftService.loadDraft();
      assertContext();
      if (!draftForRequest) throw new Error('Le brouillon ne peut pas être relu. Vos renseignements restent affichés.');
      if (!displayedDraftRef.current || displayedDraftRef.current.id !== draftForRequest.id) throw new Error('La référence du brouillon a changé. Rouvrez cet aperçu.');
      const sameDisplayedDraft = JSON.stringify(displayedDraftRef.current) === JSON.stringify(draftForRequest);
      const pendingInput = await ArticlesService.getPendingPublicationInput(draftForRequest.id, assertContext);
      assertContext();
      const original: unknown = pendingInput === null ? null : JSON.parse(pendingInput);
      if (pendingInput !== null && !isObject(original)) throw new Error('L’intention de publication doit être rapprochée.');
      const currentInput = JSON.stringify(buildPublicationInput(fields, pricing, imageUrls, original as Record<string, unknown> | null));
      const actualInput = pendingInput ?? currentInput;
      // A historical attempt can only replay its exact input. It cannot be
      // upgraded to a new declaration after the server may have committed it.
      if (pendingInput === null) {
        if (!sameDisplayedDraft) throw new Error('Le brouillon a changé. Rouvrez son aperçu avant une nouvelle publication.');
        const validationErrors: string[] = [];
        const missingKeys: string[] = [];
        if (!fields.title || fields.title.trim().length < 3) {validationErrors.push('Le titre doit contenir au moins 3 caractères'); missingKeys.push('title');}
        if (imageUrls.length === 0) {validationErrors.push('Ajoutez au moins une photo'); missingKeys.push('photos');}
        if (!fields.categoryIds?.length) {validationErrors.push('Sélectionnez une catégorie'); missingKeys.push('category');}
        if (validationErrors.length) {
          track('article_publish_failed', {reason: 'client_validation', missing_fields: missingKeys});
          Alert.alert('Informations manquantes', validationErrors.join('\n')); return;
        }
        if (!isValidArticlePrice(pricing.price)) {
          setIsPublishing(false);
          track('article_publish_failed', { reason: 'client_validation', missing_fields: ['price'] });
          Alert.alert('Prix à corriger', 'Indiquez un prix entre 0,01 $ et 10 000 $, avec au plus deux décimales. Votre saisie est conservée ; aucun arrondi automatique ne sera appliqué.');
          return;
        }
        const declarationErrors = getListingDeclarationErrors(fields);
        if (declarationErrors.length) {
          setIsPublishing(false);
          track('article_publish_failed', { reason: 'client_validation', missing_fields: declarationErrors.map(error => error.key) });
          Alert.alert('Informations manquantes', declarationErrors.map(error => error.message).join('\n'));
          return;
        }
      }
      const previous = publishAttemptRef.current;
      if (previous && (previous.input !== actualInput || previous.draft.id !== draftForRequest.id)) {
        throw new Error('Vérifiez la publication précédente avec son contenu initial avant de publier des modifications.');
      }
      const attempt = previous ?? { draft: JSON.parse(JSON.stringify(draftForRequest)) as ArticleDraft, input: actualInput };
      publishAttemptRef.current = attempt;
      const articleId = await ArticlesService.createArticle(JSON.parse(attempt.input), {
        requestId: attempt.draft.id,
        assertContext,
      });
      assertContext();
      // The creation receipt is recorded, even if a later draft cleanup fails.
      // Mark owner lists stale now; their next focused opening reads the server.
      void queryClient.invalidateQueries({queryKey: queryKeys.articles.userList(currentUser.uid), refetchType: 'none'});
      void queryClient.invalidateQueries({queryKey: queryKeys.users.articles(currentUser.uid), refetchType: 'none'});
      setPublishedArticleId(articleId);
      let currentPublication: 'online' | 'preparation' | 'unknown' = 'unknown';
      if (Object.prototype.hasOwnProperty.call(JSON.parse(attempt.input), 'childSafetyDeclaration')) {
        const observed = await ProductReviewService.preview(currentUser.uid, {kind: 'article_listing', id: articleId}, assertContext);
        assertContext();
        if (observed.source.protocol !== 'product_review_source_v2') throw new Error('L’état actuel de cette préparation doit être relu.');
        const listing = observed.source.listingSubmission;
        const preparation = await ChildSafetyReviewService.publicationPreview(currentUser.uid, articleId, assertContext); assertContext();
        const revision = observed.source.contextSource.revision?.split(':');
        const expectedRevision = revision ? await productReviewHash([articleId, currentUser.uid, Number(revision[0]), Number(revision[1])]) : null; assertContext();
        if (expectedRevision === null || expectedRevision !== preparation.articleRevision || preparation.source.sourceHash !== listing.childSafety.sourceHash)
          throw new Error('La préparation a changé pendant la lecture. Son intention et votre brouillon sont conservés ; relisez le dossier.');
        currentPublication = observed.source.sources.currentListing.qualification === 'current_listing_recorded' && !preparation.blockers.includes('privacy_withdrawn') && listing.isActive === true && listing.moderationStatus === 'approved' ? 'online' : listing.isActive === false && listing.moderationStatus === 'pending' && !preparation.blockers.includes('preparation_unqualified') ? 'preparation' : 'unknown';
      } else {
        const observed = await ArticlesService.getArticleById(articleId); assertContext();
        currentPublication = observed?.sellerId === currentUser.uid && observed.isActive === true ? 'online' : 'unknown';
      }
      setPublicationObservation({frame: scope.frame, focus: scope.focusRevision, state: currentPublication});
      if (currentPublication === 'unknown') throw new Error('L’état actuel ne peut pas être qualifié. Votre brouillon et l’intention enregistrée sont conservés ; consultez le dossier avant un autre envoi.');
      if (pendingInput !== null && (pendingInput !== currentInput || !sameDisplayedDraft)) {
        setPublishedArticleId(articleId); setHasPendingPublication(true); setIsPublishing(false);
        Alert.alert('Publication retrouvée', 'L’intention d’origine a été retrouvée. Votre brouillon différent est conservé ; consultez cette annonce avant une autre publication.'); return;
      }
      track('article_published', {
        article_id: articleId,
        price_cents: Math.round(pricing.price * 100),
        category_ids: fields.categoryIds || [],
        condition: fields.condition,
        photo_count: imageUrls.length,
        has_brand: !!fields.brand,
        has_size: !!fields.size,
        colors_count: fields.colors?.length ?? 0,
        materials_count: fields.materials?.length ?? 0,
        is_hand_delivery: pricing.isHandDelivery,
        is_shipping: pricing.isShipping,
        neighborhoods_count: pricing.neighborhoods?.length ?? 0,
        package_size: pricing.isShipping ? pricing.packageSize ?? undefined : undefined,
        ai_used: aiUsed,
      });
      // Remote cleanup is deferred: an external purge cannot fence this
      // session's generation during its own reads/deletions. Keep adopted media.
      if (Object.prototype.hasOwnProperty.call(JSON.parse(attempt.input), 'inventoryUnitDeclaration')) {
        const unit = await ArticlesService.readInventoryUnit(articleId, assertContext); assertContext();
        if (unit.qualification !== 'native_current' || !unit.memberArticleIds.includes(articleId))
          throw new Error('La déclaration native du bien ne peut pas être relue. L’intention et le brouillon restent conservés ; aucune autre publication n’est nécessaire.');
      }
      const removed = await draftService.deletePublishedDraft(attempt.draft, draftSession!);
      assertContext();
      if (!removed) {
        setIsPublishing(false);
        Alert.alert('Publication enregistrée', 'Le brouillon a changé. Il a été conservé ; consultez vos articles pour retrouver la publication.');
        return;
      }
      await ArticlesService.finishPublication(attempt.draft.id, assertContext).catch(() => {
        if (__DEV__) console.warn('Publication receipt cleanup deferred');
      });
      assertContext();
      draftService.markPublished(draftSession!);
      publishAttemptRef.current = null;

      setPublishedArticleId(articleId);
      setIsPublishing(false);
      setShowSuccessModal(true);
    } catch (error: unknown) {
      try { assertContext(); } catch { return; }
      const failedRequestId = publishAttemptRef.current?.draft.id;
      setIsPublishing(false);
      if (displayedDraftRef.current) {
        const pending = displayedDraftRef.current ? await ArticlesService.getPendingPublicationInput(displayedDraftRef.current.id, assertContext) : null;
        assertContext(); setHasPendingPublication(pending !== null); setPendingPublicationInput(pending);
        if (pending === null) publishAttemptRef.current = null;
      }
      if (showAdmissionError(error, {
        isCurrent: () => {try {if (!draftSession || !isMountedRef.current) return false; draftService.assertCurrentSession(draftSession); scope.assertCurrent(operation); return true;} catch {return false;}},
        retry: () => {void handlePublish();},
        ...(photoOwnerUid ? {publication: {uid: photoOwnerUid, ...(failedRequestId ? {requestId: failedRequestId} : {})}} : {}),
      })) return;
      if (__DEV__) console.error('[Preview] Error publishing article:', error);
      const message = error instanceof Error ? error.message : 'Une erreur est survenue lors de la publication';
      // Le gate serveur createArticle exige email_verified. Le claim JWT ne se
      // rafraîchit qu'au prochain refresh (~1h), donc un vendeur fraîchement
      // vérifié peut encore être refusé ici malgré le pré-check du flow vente :
      // on lui offre un raccourci vers l'écran de vérification plutôt qu'un
      // refus générique en cul-de-sac.
      // Both spellings: the server message may be accented one day.
      const isEmailGate = /v[ée]rifier votre adresse e-mail/i.test(message);
      track('article_publish_failed', {
        reason: isEmailGate ? 'email_gate' : 'server_error',
        error_code: isEmailGate ? 'email_not_verified' : 'create_article_failed',
      });
      Alert.alert(
        'Erreur',
        message,
        isEmailGate
          ? [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Vérifier mon email', onPress: () => router.push('/settings/verify-email') },
            ]
          : [{ text: 'OK' }]
      );
    } finally {
      if (activeOperation.current === operation) {
        if (scope.isCurrent(operation)) setIsPublishing(false);
        publishingRef.current = false; activeOperation.current = null;
      }
    }
  };

  // Build tags array
  const tags: string[] = [];
  const hygiene = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration);
  const hygieneRequirement = articleHygieneRequirement(fields.categoryIds);
  if (fields.condition) tags.push(getConditionLabel(fields.condition));
  if (fields.size) tags.push(`Taille ${fields.size} ${fields.sizeSystem ?? 'EU'}`);
  if (fields.colors?.length > 0) {
    fields.colors.forEach((c) => tags.push(getColorName(c)));
  }
  if (fields.materials?.length > 0) {
    fields.materials.forEach((m) => tags.push(getMaterialName(m)));
  }

  return (
    <View style={styles.container} testID="sell-preview-screen">
      <ScreenHeader title="Aperçu" onBack={handleBack} />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <PhotoCarousel ownerUid={photoOwnerUid} photos={storageUrls.length === photos.length && storageUrls.length > 0 ? storageUrls : photos} height={HERO_HEIGHT} />

        {/* Article content */}
        <View style={styles.articleContent}>
          {hasPendingPublication && (
            <Text style={styles.descriptionText}>Votre publication est en attente de confirmation.</Text>
          )}
          {/* Brand */}
          {fields.brand ? <Text style={styles.brandText}>{fields.brand}</Text> : null}

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
          {hygieneRequirement !== 'none' && (
            <View>
              <Text style={styles.brandText}>Déclaration du vendeur — hygiène</Text>
              <Text style={styles.descriptionText}>
                {hygiene.declaration?.kind === 'underwear' ? 'Sous-vêtement jamais porté, selon votre déclaration.'
                  : hygiene.declaration?.kind === 'cosmetic' ? 'Cosmétique neuf encore scellé, selon votre déclaration.'
                    : hygiene.declaration?.kind === 'not_applicable' ? 'Article d’une autre nature, selon votre déclaration.'
                      : hygiene.message ?? 'La déclaration d’hygiène reste à compléter.'}
              </Text>
            </View>
          )}

          <ArticleChildSafetyFields categoryIds={fields.categoryIds} value={fields.childSafetyDeclaration} readOnly />

          {!draftReady && <View>
            <Text style={styles.descriptionText}>{draftReadFailed ? 'Le brouillon et sa publication précédente n’ont pas pu être relus.' : 'Lecture du brouillon…'}</Text>
            {draftReadFailed && <Pressable onPress={() => setDraftReadRevision(value => value + 1)}><Text style={styles.descriptionText}>Relire le brouillon</Text></Pressable>}
          </View>}
          {hasPendingPublication && <View>
            <Text style={styles.brandText}>Publication à vérifier</Text>
            <Text style={styles.descriptionText}>{typeof pendingView?.title === 'string' ? pendingView.title : 'Titre indisponible'}</Text>
            <Text style={styles.descriptionText}>{typeof pendingView?.description === 'string' ? pendingView.description : 'Description indisponible'}</Text>
            {typeof pendingView?.price === 'number' && <Text style={styles.descriptionText}>Prix d’origine : {formatPrice(pendingView.price)}.</Text>}
            {publishedArticleId && <Pressable onPress={() => {try {assertContext(); router.push({pathname: '/article/[id]', params: {id: publishedArticleId}}); } catch { /* Keep the original owner fence. */ }}}><Text style={styles.descriptionText}>Consulter l’annonce retrouvée</Text></Pressable>}
          </View>}
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
            {SHIPPING_LISTINGS_ENABLED && pricing.isShipping && (
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
        <Button
          testID="sell-publish-button"
          style={styles.publishButton}
          onPress={handlePublish}
          disabled={isPublishing || !draftReady}
          loading={isPublishing}
          haptic={false}
          leftIcon={<Ionicons name="send-outline" size={18} color={colors.foreground} />}
        >
          {hasPendingPublication ? 'REPRENDRE LA PUBLICATION' : childSafetyCategory(fields.categoryIds) === 'canonical_sleepwear' || childSafetyCategory(fields.categoryIds) === 'child_clothing' && (articleChildSafetyInput(fields.childSafetyDeclaration)?.intendedUse !== 'daywear_only' || articleChildSafetyInput(fields.childSafetyDeclaration)?.sleepwearStyle != null || articleChildSafetyInput(fields.childSafetyDeclaration)?.safetyConcern !== 'none_observed') ? 'SOUMETTRE POUR EXAMEN' : 'PUBLIER L’ANNONCE'}
        </Button>

        <Pressable
          style={({ pressed }) => [styles.modifyButton, pressed && { opacity: 0.7 }]}
          onPress={handleEdit}
          disabled={isPublishing}
        >
          <Text style={styles.modifyButtonText}>Modifier</Text>
        </Pressable>
      </View>

      {/* Success modal */}
      <SuccessModal
        visible={showSuccessModal && scope.focused && publicationObservation?.frame === scope.frame && publicationObservation.focus === scope.focusRevision}
        outcome={publicationObservation?.state ?? 'unknown'}
        articleTitle={fields.title}
        prepareShipping={SHIPPING_LISTINGS_ENABLED && pricing.isShipping === true}
        onViewArticle={() => {
          try { assertContext(); } catch { return; }
          setShowSuccessModal(false);
          if (publishedArticleId) {
            // Single replace into the article route so back navigation
            // bubbles up cleanly to (tabs). The previous flow had a
            // 100ms setTimeout between replace('/(tabs)') and push(...)
            // that raced with focus-effects re-firing in the sell tab,
            // dispatching an unhandled GO_BACK.
            if (publicationObservation?.state === 'online') router.replace({pathname: SHIPPING_LISTINGS_ENABLED && pricing.isShipping ? '/article/shipping/[id]' : '/article/[id]', params: {id: publishedArticleId}});
            else router.replace({pathname: '/product-review', params: {contextKind: 'article_listing', contextId: publishedArticleId}} as unknown as Href);
          } else {
            router.replace('/(tabs)');
          }
        }}
        onReturnHome={() => {
          try { assertContext(); } catch { return; }
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
    marginBottom: spacing.sm,
  },
  modifyButton: {
    ...components.button.container,
    ...components.button.secondary,
  },
  modifyButtonText: {
    ...components.button.label,
    ...components.button.secondaryLabel,
  },
});
