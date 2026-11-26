import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import AsyncStorage from '@/utils/environmentStorage';
/**
 * Edit Article Screen
 * Allows users to edit their own articles
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';

// Components
import EditableField from '@/features/sell/components/details/EditableField';
import CategoryDisplay from '@/features/sell/components/details/CategoryDisplay';
import ConditionSelector, { ConditionValue } from '@/features/sell/components/details/ConditionSelector';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/BrandSelectionSheet';
import NeighborhoodBottomSheet, { NeighborhoodBottomSheetRef } from '@/features/sell/components/pricing/NeighborhoodBottomSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { ChipSelector } from '@/features/sell';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { applyPendingEdits, PendingEdits } from '@/features/sell/utils/pendingEdits';

// Data
import { getColorItems, resolveColorLabel } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import { getSizesForCategory } from '@/data/sizes';
import { getCategoryInfoFromIds } from '@/data/categories-v2';

// Feature services
import { buildArticleUpdates as buildBaseArticleUpdates, buildLegacyArticleUpdates, getLegacyArticleBrandEditError, getArticleBrandEditError, getArticleDisclosureEditError, getArticleHygieneEditError, resolveTrackedDelivery } from '@/features/article/services/buildArticleUpdates';
import {
  resolveDeliveryFromArticle,
  resolveSizeAfterCategoryChange,
  validateArticleEditForm,
} from '@/features/article/services/editArticleForm';

// Services & Types
import { ArticleChildSafetyFields } from '@/components/ArticleChildSafetyFields';
import { articleChildSafetyInput, articleChildSafetyEditKey } from '@/utils/articleChildSafetyInput';
import { childSafetyCategory, childSafetyStatementProjection } from '@/functions/src/shared/articleChildSafety';
import { ChildSafetyReviewService } from '@/services/childSafetyReviewService';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';
import { isArticleSaleDeclarationInput, ArticlesService, isInventoryUnitDeclaration } from '@/services/articlesService';
import { isStorageUrl } from '@/utils/fixStorageUrl';
import { privateMediaPath } from '@/utils/privateMedia';
import { getCallableErrorCode } from '@/utils/callableError';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { auth, storage } from '@/config/firebaseConfig';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { Article, ArticleImage, MeetupNeighborhood } from '@/types';
import type { ArticleBrandStatus, ArticleCounterfeitStatus, ArticleInventoryUnitChoice, ArticleInventoryUnitView, ArticleSaleUnit, ArticleSaleDeclarationInput, ArticleSaleDeclarationView } from '@/types/article';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { SHIPPING_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { isValidArticlePrice } from '@/functions/src/shared/article';
import { automaticShippingEstimate } from '@/functions/src/shared/automaticShippingEstimate';
import { articleHygieneRequirement, articleHygieneInputFromStored, evaluateArticleHygieneInput, type ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';

type PackageSize = 'small' | 'medium' | 'large';

interface EditedFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: ConditionValue;
  hygieneDeclaration?: ArticleHygieneDeclarationInput | null;
  hygieneKind?: ArticleHygieneDeclarationInput['kind'] | null;
  hygieneChanged?: boolean;
  hygieneCategorySource?: string;
  hygieneConditionSource?: string;
  colors: string[];
  colorsSource?: string;
  materials: string[];
  materialsSource?: string;
  childSafetyDeclaration?: ArticleChildSafetyDraft | null;
  childSafetyChanged?: boolean;
  childSafetyContentSource?: string;
  childSafetyRequired?: boolean;
  expectedSaleDeclarationContentHash?: string;
  size: string | null;
  /** Sizing system of the original article — preserved so a US size is never republished as EU. */
  sizeSystem: import('@/types').SizeSystem;
  sizeChanged?: boolean;
  brand: string;
  brandChanged?: boolean;
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhoods: import('@/types').MeetupNeighborhood[];
  packageSize: PackageSize | null;
}

/** Historical intent fields are only read or replayed from their exact journal. */
interface JournalEditedFields extends EditedFields {
  quantity?: number;
  stock?: number;
  quantityChanged?: boolean;
  saleUnit?: ArticleSaleUnit | null;
  counterfeitStatus?: ArticleCounterfeitStatus | null;
  inventoryUnitDeclaration?: ArticleInventoryUnitChoice | null;
  expectedInventoryUnitRevision?: string;
  saleDeclaration?: ArticleSaleDeclarationInput;
  saleDeclarationReviewedFor?: string;
  brandStatus?: ArticleBrandStatus | null;
  hasAlterations?: boolean | null;
  alterationsDescription?: string | null;
  alterationsChanged?: boolean;
  hasKnownDefects?: boolean | null;
  defectsDescription?: string | null;
  defectsChanged?: boolean;
  defectReviewSource?: string;
  defectsReviewedFor?: string;
}

const historicalFieldKeys = ['quantity', 'stock', 'quantityChanged', 'saleUnit', 'counterfeitStatus',
  'inventoryUnitDeclaration', 'expectedInventoryUnitRevision', 'saleDeclaration', 'saleDeclarationReviewedFor',
  'brandStatus', 'hasAlterations', 'alterationsDescription', 'alterationsChanged',
  'hasKnownDefects', 'defectsDescription', 'defectsChanged', 'defectReviewSource', 'defectsReviewedFor'] as const;
function currentEditedFields(fields: JournalEditedFields): EditedFields {
  const current = {...fields};
  for (const key of historicalFieldKeys) delete current[key];
  return current;
}

interface EditContext { uid: string | undefined; generation: number; articleId: string; operation: ReturnType<ReturnType<typeof useLabelLifecycleContext>['capture']> | null }
type InventoryUpdateReceipt = Awaited<ReturnType<typeof ArticlesService.updateArticleWithInventory>>;
interface EditAttempt {
  context: EditContext;
  updates: Record<string, unknown>;
  images: ArticleImage[];
  uploaded: ArticleImage[];
  selected: ArticleImage[];
  fields: JournalEditedFields;
  sourceFingerprint: string;
}
type SavedEditAttempt = Omit<EditAttempt, 'context'>;
/** Additive inventory controls never change the historic descriptive update builder. */
function buildJournalArticleUpdates(fields: JournalEditedFields, images: ArticleImage[]): Record<string, unknown> {
  const updates = buildLegacyArticleUpdates(fields, images);
  if (fields.inventoryUnitDeclaration !== undefined && fields.inventoryUnitDeclaration !== null) {
    if (!isInventoryUnitDeclaration(fields.inventoryUnitDeclaration) || typeof fields.expectedInventoryUnitRevision !== 'string' || !/^[a-f0-9]{64}$/.test(fields.expectedInventoryUnitRevision))
      throw new Error('Choisissez le bien et relisez sa révision native avant cette adoption.');
    updates.inventoryUnitDeclaration = fields.inventoryUnitDeclaration;
    updates.expectedInventoryUnitRevision = fields.expectedInventoryUnitRevision;
  }
  return updates;
}
function buildArticleUpdates(fields: EditedFields, images: ArticleImage[]): Record<string, unknown> {
  return buildBaseArticleUpdates(fields, images);
}
const legacyUpdateKeys = ['saleDeclaration', 'inventoryUnitDeclaration', 'expectedInventoryUnitRevision', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription'];
const hasContentReceipt = (updates: Record<string, unknown>) => updates.saleDeclaration !== undefined || typeof updates.expectedSaleDeclarationContentHash === 'string';
interface EditJournalRead {
  context: EditContext;
  version: number;
  status: 'ready' | 'error';
  saved: SavedEditAttempt | null;
}

function applyArticlePendingEdits(fields: EditedFields, pending: PendingEdits): EditedFields {
  const applied = applyPendingEdits(fields, pending);
  // Number consumes the complete draft; parseFloat would accept "12abc" as 12.
  const edited = pending.price !== undefined
    ? { ...applied, price: Number(pending.price.trim().replace(',', '.')) }
    : applied;
  // A pending brand name is an explicit edit, including an empty name.
  return pending.brand !== undefined && edited.brand !== fields.brand.trim()
    ? { ...edited, brandChanged: true }
    : edited;
}
const editAttemptKey = (uid: string, articleId: string) => `@article_edit:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;

function isJournalObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sameJournalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJournalValue(value, right[index]));
  }
  if (!isJournalObject(left) || !isJournalObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) && sameJournalValue(left[key], right[key]));
}
const isJournalStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isJournalImages = (value: unknown): value is ArticleImage[] => Array.isArray(value) && value.every(image =>
  isJournalObject(image) && typeof image.url === 'string' && image.url.length > 0 &&
  (image.blurhash === undefined || typeof image.blurhash === 'string'));

function validEditJournal(value: unknown): value is SavedEditAttempt {
  if (!isJournalObject(value) || !isJournalObject(value.fields) || !isJournalObject(value.updates)) return false;
  const f = value.fields;
  if (f.inventoryUnitDeclaration !== undefined && f.inventoryUnitDeclaration !== null && (!isInventoryUnitDeclaration(f.inventoryUnitDeclaration) ||
    typeof f.expectedInventoryUnitRevision !== 'string' || !/^[a-f0-9]{64}$/.test(f.expectedInventoryUnitRevision)) ||
    f.expectedInventoryUnitRevision !== undefined && (!isInventoryUnitDeclaration(f.inventoryUnitDeclaration) || typeof f.expectedInventoryUnitRevision !== 'string' || !/^[a-f0-9]{64}$/.test(f.expectedInventoryUnitRevision))) return false;
  if (f.saleDeclaration !== undefined && (!isArticleSaleDeclarationInput(f.saleDeclaration) || f.quantity !== 1 || f.stock !== 1 ||
    ['personal_item_v2', 'personal_item_v3'].includes(f.saleDeclaration.version) && 'saleUnit' in f.saleDeclaration && f.saleUnit !== f.saleDeclaration.saleUnit ||
    f.saleDeclaration.version === 'personal_item_v3' && f.counterfeitStatus !== f.saleDeclaration.counterfeitStatus ||
    typeof f.expectedSaleDeclarationContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(f.expectedSaleDeclarationContentHash) ||
    typeof f.saleDeclarationReviewedFor !== 'string')) return false;
  if (f.childSafetyChanged !== undefined && typeof f.childSafetyChanged !== 'boolean' || f.childSafetyRequired !== undefined && typeof f.childSafetyRequired !== 'boolean' || f.childSafetyContentSource !== undefined && typeof f.childSafetyContentSource !== 'string' || f.childSafetyDeclaration != null && (!isJournalObject(f.childSafetyDeclaration) || !articleChildSafetyInput(f.childSafetyDeclaration))) return false;
  if (f.saleUnit !== undefined && f.saleUnit !== null && f.saleUnit !== 'single_article' && f.saleUnit !== 'set_as_one') return false;
  if (f.counterfeitStatus !== undefined && f.counterfeitStatus !== null && f.counterfeitStatus !== 'not_counterfeit' && f.counterfeitStatus !== 'declared_counterfeit') return false;
  const display = f.categoryDisplay;
  if (typeof f.title !== 'string' || typeof f.description !== 'string' || typeof f.condition !== 'string' ||
      typeof f.brand !== 'string' || typeof f.price !== 'number' || !Number.isFinite(f.price) ||
      !isJournalStrings(f.categoryIds) || !isJournalStrings(f.colors) || !isJournalStrings(f.materials) ||
      !isJournalObject(display) || !['icon', 'name', 'context'].every(key => typeof display[key] === 'string') ||
      !(f.size === null || typeof f.size === 'string') || !(f.sizeSystem === 'EU' || f.sizeSystem === 'US') ||
      typeof f.isHandDelivery !== 'boolean' || typeof f.isShipping !== 'boolean' ||
      !(f.packageSize === null || typeof f.packageSize === 'string') || !Array.isArray(f.neighborhoods) ||
      !f.neighborhoods.every(item => isJournalObject(item) && ['id', 'name', 'borough'].every(key => typeof item[key] === 'string')) ||
      !isJournalImages(value.images) || value.images.length === 0 || !isJournalImages(value.selected) ||
      value.selected.length !== value.images.length || !isJournalImages(value.uploaded) || typeof value.sourceFingerprint !== 'string') return false;
  if ((f.brandChanged !== undefined && typeof f.brandChanged !== 'boolean') ||
      (f.brandStatus !== undefined && f.brandStatus !== null &&
        !['known', 'unbranded', 'unknown'].includes(String(f.brandStatus)))) return false;
  if (['defectsChanged', 'alterationsChanged', 'sizeChanged', 'hygieneChanged', 'quantityChanged'].some(key => f[key] !== undefined && typeof f[key] !== 'boolean')
      || ['defectReviewSource', 'defectsReviewedFor', 'hygieneCategorySource', 'hygieneConditionSource', 'colorsSource', 'materialsSource', 'saleDeclarationReviewedFor', 'expectedSaleDeclarationContentHash'].some(key => f[key] !== undefined && typeof f[key] !== 'string')
      || (f.hygieneKind !== undefined && f.hygieneKind !== null && !['underwear', 'cosmetic', 'not_applicable'].includes(String(f.hygieneKind)))
      || ['hasKnownDefects', 'hasAlterations'].some(key => f[key] !== undefined && f[key] !== null && typeof f[key] !== 'boolean')
      || ['defectsDescription', 'alterationsDescription'].some(key => f[key] !== undefined && f[key] !== null && typeof f[key] !== 'string')) return false;

  // Validate the producer's complete constraints, not one arbitrary matching
  // field. Delivery fields are checked when recorded, independently of today's
  // flag, so this does not rewrite or re-admit an older commercial intention.
  const fields = f as unknown as JournalEditedFields;
  const historical = legacyUpdateKeys.some(key => Object.prototype.hasOwnProperty.call(value.updates, key)) ||
    ['hasKnownDefects', 'defectsDescription', 'defectsChanged', 'defectReviewSource', 'defectsReviewedFor'].some(key => Object.prototype.hasOwnProperty.call(f, key));
  if ((historical ? getLegacyArticleBrandEditError(fields) : getArticleBrandEditError(fields)) ||
    historical && getArticleDisclosureEditError(fields) || getArticleHygieneEditError(fields)) return false;
  const expected = historical ? buildJournalArticleUpdates(fields, value.images) : buildArticleUpdates(fields, value.images);
  // Old journals always recorded brand alone. They remain readable solely
  // for reconciliation; handleSave never dispatches a restored attempt again.
  if (f.brandChanged === undefined) expected.brand = fields.brand.trim() || null;
  delete expected.isHandDelivery; delete expected.isShipping; delete expected.packageSize;
  const updates = value.updates;
  if (Object.keys(updates).length === 0 || !Object.entries(expected).every(([key, constraint]) =>
    Object.prototype.hasOwnProperty.call(updates, key) && sameJournalValue(updates[key], constraint))) return false;
  const deliveryKeys = ['isHandDelivery', 'isShipping', 'packageSize'];
  if (!Object.keys(updates).every(key => Object.prototype.hasOwnProperty.call(expected, key) || deliveryKeys.includes(key))) return false;
  const hasDelivery = 'isHandDelivery' in updates || 'isShipping' in updates;
  if (hasDelivery && (updates.isHandDelivery !== f.isHandDelivery || updates.isShipping !== f.isShipping)) return false;
  if ('packageSize' in updates && (!hasDelivery || f.packageSize === null || updates.packageSize !== f.packageSize)) return false;

  const uploads: ArticleImage[] = [];
  for (let index = 0; index < value.selected.length; index++) {
    const selected = value.selected[index];
    const prepared = value.images[index];
    if (!isStorageUrl(selected.url) && !selected.url.startsWith('https://')) {
      if (!isStorageUrl(prepared.url)) return false;
      uploads.push(prepared);
    } else if (!sameJournalValue(selected, prepared)) return false;
  }
  if (!sameJournalValue(uploads, value.uploaded)) return false;
  try {
    const fingerprint: unknown = JSON.parse(value.sourceFingerprint);
    return isJournalObject(fingerprint) && Object.keys(fingerprint).length === 2 &&
      sameJournalValue(fingerprint.fields, f) && sameJournalValue(fingerprint.images, value.selected);
  } catch { return false; }
}

function parseEditJournal(raw: string | null): SavedEditAttempt | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validEditJournal(value)) throw new Error('Journal de modification illisible');
  return value;
}

export default function EditArticleScreen() {
  const router = useRouter();
  const showAdmissionError = useTradeAdmissionError();
  const insets = useSafeAreaInsets();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const editSource: 'article_detail' | 'my_articles' =
    source === 'my_articles' ? 'my_articles' : 'article_detail';
  const authenticatedUid = useAuthenticatedUid();
  const editScope = useLabelLifecycleContext(`article-edit:${id}`, authenticatedUid);
  const queryClient = useQueryClient();
  const privateBucket = storage?.app?.options.storageBucket;

  const [article, setArticle] = useState<Article | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [preparationReadFailed, setPreparationReadFailed] = useState<EditContext | null>(null);
  const [hasUnknownSave, setHasUnknownSave] = useState(false);
  const [attemptDisplay, setAttemptDisplay] = useState<SavedEditAttempt | null>(null);
  const mountedRef = useRef(true);
  const generation = useAuthStore(getAuthSessionGeneration);
  const context = useMemo<EditContext>(() => {
    let operation = null;
    try {if (editScope.focused) operation = editScope.capture();} catch { /* No current SDK session. */ }
    return {uid: authenticatedUid ?? undefined, generation, articleId: id, operation};
  }, [authenticatedUid, generation, id, editScope.frame, editScope.focusRevision, editScope.focused]);
  const contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; }, [context]);
  const isCurrentContext = (captured: typeof context) => !!captured.operation && editScope.isCurrent(captured.operation) && mountedRef.current && contextRef.current === captured &&
    !!captured.uid && auth.currentUser?.uid === captured.uid &&
    useAuthStore.getState().authenticatedUid === captured.uid &&
    getAuthSessionGeneration() === captured.generation;
  const assertContext = (captured: typeof context) => {
    if (!isCurrentContext(captured)) throw new Error('La session ou l’article a changé.');
  };
  const attemptRef = useRef<EditAttempt | null>(null);
  const [journalVersion, setJournalVersion] = useState(0);
  const [journalRead, setJournalRead] = useState<EditJournalRead | null>(null);
  const journalRequestRef = useRef<symbol | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const readJournal = async (captured: EditContext): Promise<SavedEditAttempt | null> => {
    assertContext(captured);
    const raw = await AsyncStorage.getItem(editAttemptKey(captured.uid!, captured.articleId));
    assertContext(captured);
    return parseEditJournal(raw);
  };
  // Durable intent is independent of article cache freshness. Every mounting
  // context reads it before fields or mutation controls can become available.
  useEffect(() => {
    const request = Symbol('edit-journal-read');
    journalRequestRef.current = request;
    const restore = async () => {
      try {
        const saved = await readJournal(context);
        assertContext(context);
        if (journalRequestRef.current !== request) return;
        setJournalRead({ context, version: journalVersion, status: 'ready', saved });
      } catch {
        if (isCurrentContext(context) && journalRequestRef.current === request) {
          setJournalRead({ context, version: journalVersion, status: 'error', saved: null });
        }
      }
    };
    void restore();
  }, [context, journalVersion]);
  const journalCurrent = journalRead?.context === context && journalRead.version === journalVersion;
  const journalReady = journalCurrent && journalRead.status === 'ready';

  // Form fields
  const [fields, setFields] = useState<EditedFields>({
    title: '',
    description: '',
    categoryIds: [],
    categoryDisplay: { icon: 'pricetag-outline', name: '', context: '' },
    condition: 'très bon état',
    hygieneDeclaration: null,
    hygieneKind: null,
    hygieneChanged: false,
    colors: [],
    materials: [],
    size: null,
    sizeSystem: 'EU',
    sizeChanged: false,
    brand: '',
    brandChanged: false,
    price: 0,
    // Quand le shipping est désactivé, on force le main-à-main par défaut.
    isHandDelivery: !SHIPPING_ENABLED,
    isShipping: SHIPPING_ENABLED,
    neighborhoods: [],
    packageSize: null,
  });

  // Editable photos state
  const [editedImages, setEditedImages] = useState<{ url: string }[]>([]);

  // Track initial values for unsaved-changes detection
  const [initialFields, setInitialFields] = useState<EditedFields | null>(null);
  const [initialImages, setInitialImages] = useState<{ url: string }[]>([]);

  // Bottom sheet refs
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);
  const neighborhoodSheetRef = useRef<NeighborhoodBottomSheetRef>(null);
  // Le KeyboardAvoidingView rétrécirait la feuille pleine page dès que sa
  // recherche ouvre le clavier : on le neutralise tant qu'elle est ouverte.
  const [isNeighborhoodSheetOpen, setIsNeighborhoodSheetOpen] = useState(false);
  const navigation = useNavigation();
  // Set right before a deliberate exit, so the leave guard lets it through.
  const allowLeaveRef = useRef(false);
  const savingRef = useRef<EditContext | null>(null);

  // Typed in a field but not « Confirmé » yet: applied on save, and counted as
  // an unsaved change (see applyPendingEdits).
  const [pendingEdits, setPendingEdits] = useState<PendingEdits>({});
  const [priceDisplay, setPriceDisplay] = useState<string | null>(null);
  const trackPending = (key: keyof PendingEdits) => (draft: string | null) =>
    setPendingEdits((prev) => {
      const next = { ...prev };
      if (draft === null) delete next[key];
      else next[key] = draft;
      return next;
    });

  // Each query is scoped to the concrete account generation and dossier.
  const articleQuery = useQuery({
    queryKey: [...queryKeys.articles.detail(id), 'edit', context.uid, context.generation, editScope.focusRevision],
    enabled: !!id && !!context.uid && editScope.focused && journalReady,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      assertContext(context);
      const data = await ArticlesService.getArticleById(id, context.uid);
      assertContext(context);
      const historical = !!journalRead?.saved;
      const preparation = data?.isActive === false && !historical ? await ChildSafetyReviewService.publicationPreview(context.uid!, id, () => assertContext(context)) : null;
      assertContext(context);
      return {article: data?.isActive === false && !historical && preparation?.canCorrectPreparationNow !== true ? null : data, preparation};
    },
  });
  const saleQuery = useQuery({queryKey: ['article-sale-declaration', id, context.uid, context.generation, editScope.focusRevision],
    enabled: !!id && !!context.uid && editScope.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => ArticlesService.readSaleDeclaration(id, () => assertContext(context))});
  const saleView = editScope.focused && preparationReadFailed !== context && saleQuery.isSuccess && !saleQuery.isFetching && !saleQuery.error ? saleQuery.data : null;
  const isLoading = articleQuery.isPending || !journalCurrent;
  const [loadedContext, setLoadedContext] = useState<EditContext | null>(null);
  const [loadedJournalVersion, setLoadedJournalVersion] = useState(-1);
  const articleData = articleQuery.data?.article;
  // Adjust this screen's editable state once when a new query context arrives.
  // Subsequent refetches do not overwrite the seller's ongoing edits.
  if (articleData && journalReady && !articleQuery.isPending && !articleQuery.isError &&
      (loadedContext !== context || loadedJournalVersion !== journalVersion) &&
      articleData.id === id && articleData.sellerId === context.uid && (!articleData.isSold || !!journalRead.saved)) {
    const firstContextLoad = loadedContext !== context;
    if (firstContextLoad || journalRead.saved) setPriceDisplay(null);
    setLoadedContext(context);
    setLoadedJournalVersion(journalVersion);
    setHasUnknownSave(!!journalRead.saved);
    setAttemptDisplay(journalRead.saved);
    setIsSaving(false);
    if (firstContextLoad || journalRead.saved) setPendingEdits({});
    setArticle(articleData);
    const loadedImages = articleData.images || [];
    if (firstContextLoad) setEditedImages(loadedImages);

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

    const storedHygiene = articleHygieneInputFromStored(articleData.categoryIds, articleData.sellerId, articleData.hygieneDeclaration);
    const loadedDelivery = resolveDeliveryFromArticle(articleData);
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
      hygieneDeclaration: storedHygiene,
      hygieneKind: storedHygiene?.kind ?? null,
      hygieneChanged: false,
      hygieneCategorySource: JSON.stringify(articleData.categoryIds ?? []),
      hygieneConditionSource: articleData.condition,
      colors: loadedColors,
      colorsSource: JSON.stringify(loadedColors),
      materials: loadedMaterials,
      materialsSource: JSON.stringify(loadedMaterials),
      childSafetyDeclaration: childSafetyStatementProjection(articleData.childSafetyDeclaration),
      childSafetyChanged: false,
      childSafetyRequired: articleQuery.data?.preparation?.canCorrectPreparationNow === true,
      size: typeof articleData.size === 'string' ? articleData.size : articleData.size?.value || null,
      // Keep the article's original sizing system so US sizes are never silently rewritten as EU.
      sizeSystem: articleData.size?.system || 'EU',
      sizeChanged: false,
      brand: articleData.brand || '',
      brandChanged: false,
      price: articleData.price || 0,
      ...loadedDelivery,
      neighborhoods: articleData.neighborhoods || (articleData.neighborhood ? [articleData.neighborhood] : []),
      packageSize: (articleData.packageSize as PackageSize) ||
        (loadedDelivery.isShipping ? automaticShippingEstimate({categoryIds: articleData.categoryIds}).profileSize : null),
    };

    loadedFields.childSafetyContentSource = articleChildSafetyEditKey(loadedFields as unknown as Record<string, unknown>, loadedImages);
    if (firstContextLoad) setFields(loadedFields);

    // Capture initial state for unsaved-changes detection
    if (firstContextLoad) {
      setInitialFields(loadedFields);
      setInitialImages(loadedImages);
    }
    if (journalRead.saved) {
      const saved = journalRead.saved;
      setFields(saved.fields);
      setEditedImages(saved.selected);
      setHasUnknownSave(true);
    }
  }
  const attemptContextRef = useRef<{ context: EditContext; version: number } | null>(null);
  useLayoutEffect(() => {
    if (!journalReady || loadedContext !== context ||
        (attemptContextRef.current?.context === context && attemptContextRef.current.version === journalVersion)) return;
    attemptContextRef.current = { context, version: journalVersion };
    attemptRef.current = journalRead.saved ? { ...journalRead.saved, context } : null;
  }, [loadedContext, context, journalReady, journalRead, journalVersion]);

  const openedContextRef = useRef<EditContext | null>(null);
  useEffect(() => {
    if (!isCurrentContext(context) || !journalReady || articleQuery.isPending || openedContextRef.current === context) return;
    openedContextRef.current = context;
    if (articleQuery.isError) {
      Alert.alert('Erreur', 'Impossible de charger l’article. Revenez à cet écran pour réessayer.');
    } else if (!articleData || articleData.id !== id) {
      Alert.alert('Erreur', 'Article introuvable');
      router.back();
    } else if (articleData.sellerId !== context.uid) {
      Alert.alert('Erreur', 'Vous ne pouvez pas modifier cet article');
      router.back();
    } else if (articleData.isSold && !journalRead.saved) {
      Alert.alert('Article vendu', 'Cet article est vendu et ne peut plus être modifié.', [
        { text: 'OK', onPress: () => { if (isCurrentContext(context)) router.back(); } },
      ]);
    } else {
      track('article_edit_opened', { article_id: id, outcome: 'loaded', source: editSource });
    }
  }, [articleData, articleQuery.isPending, articleQuery.isError, context, journalReady, journalRead?.saved]);

  const updateField = <K extends keyof EditedFields>(
    key: K,
    value: EditedFields[K]
  ) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleBrandSave = (value: string) => {
    const brand = value.trim();
    setFields(prev => brand === prev.brand.trim() ? prev
      : { ...prev, brand, brandChanged: true });
  };

  const handleCategorySelect = (categoryIds: string[]) => {
    updateField('categoryIds', categoryIds);
    track('sell_field_edited', {
      screen: 'edit',
      field: 'category',
      value: categoryIds[categoryIds.length - 1],
    });
    const categoryInfo = getCategoryInfoFromIds(categoryIds);
    if (categoryInfo) {
      updateField('categoryDisplay', {
        icon: categoryInfo.icon || 'pricetag-outline',
        name: categoryInfo.displayName || '',
        context: categoryInfo.fullLabel?.split(' > ').slice(0, -1).join(' · ') || '',
      });
    }
    // La grille de tailles dépend de la catégorie : une taille devenue
    // impossible disparaît, comme à la publication.
    setFields(prev => {
      const size = resolveSizeAfterCategoryChange(prev.size, categoryIds, prev.sizeSystem);
      return { ...prev, size, sizeChanged: prev.sizeChanged || size !== prev.size,
        packageSize: SHIPPING_LISTINGS_ENABLED && prev.isShipping ? automaticShippingEstimate({categoryIds}).profileSize : prev.packageSize,
        hygieneDeclaration: null, hygieneKind: null, hygieneChanged: true };
    });
  };

  const currentFormRef = useRef({ fields, pendingEdits, editedImages });
  useLayoutEffect(() => { currentFormRef.current = { fields, pendingEdits, editedImages }; }, [fields, pendingEdits, editedImages]);
  const fingerprintForm = (f: EditedFields, images: ArticleImage[]) => JSON.stringify({ fields: f, images });
  const preserveAttempt = (attempt: EditAttempt) => {
    const { context: captured, ...saved } = attempt;
    return AsyncStorage.setItem(editAttemptKey(captured.uid!, captured.articleId), JSON.stringify(saved));
  };

  const matchesRecordedUpdate = (stored: Article, attempt: EditAttempt, inventoryReceipt = false): boolean => {
    if (!validEditJournal(attempt)) return false;
    const entries = Object.entries(attempt.updates).filter(([key]) => !inventoryReceipt || !['inventoryUnitDeclaration', 'expectedInventoryUnitRevision'].includes(key));
    if (entries.length === 0) return false;
    return entries.every(([key, value]) => {
      const recorded = (stored as unknown as Record<string, unknown>)[key];
      if (value === null) return recorded == null || recorded === '';
      if (Array.isArray(value) && value.length === 0) return recorded == null || (Array.isArray(recorded) && recorded.length === 0);
      return JSON.stringify(recorded) === JSON.stringify(value);
    });
  };

  const reportSaved = async (attempt: EditAttempt, receipt: ArticleSaleDeclarationView | InventoryUpdateReceipt | 'own_success') => {
    assertContext(attempt.context);
    const inventoryReceipt = typeof receipt === 'object' && 'inventoryUnitReceipt' in receipt ? receipt : null;
    const ownReceipt = inventoryReceipt ? inventoryReceipt.saleDeclarationView : receipt as ArticleSaleDeclarationView | 'own_success';
    const technicalReceipt = ownReceipt !== 'own_success' &&
      (ownReceipt.declaration?.version === 'listing_content_v1' || ownReceipt.declaration?.version === 'listing_content_v2');
    const contentReceipt = hasContentReceipt(attempt.updates) || technicalReceipt;
    let freshInventory: ArticleInventoryUnitView | null = null;
    if (attempt.updates.inventoryUnitDeclaration !== undefined && !technicalReceipt) {
      if (!inventoryReceipt) throw new Error('Le reçu natif de cette adoption doit être relu ; son journal est conservé.');
      freshInventory = await ArticlesService.readInventoryUnit(attempt.context.articleId, () => assertContext(attempt.context));
      assertContext(attempt.context);
      if (freshInventory.qualification !== 'native_current' || freshInventory.inventoryUnitId !== inventoryReceipt.inventoryUnitReceipt.unitId || !freshInventory.memberArticleIds.includes(attempt.context.articleId))
        throw new Error('Le groupe natif ne qualifie plus le reçu de cette adoption. Le journal est conservé.');
    }
    // The journal is not acknowledged until a fresh native observation still
    // qualifies this own receipt. A read failure or another edit retains it.
    const fresh = await ArticlesService.readSaleDeclaration(attempt.context.articleId, () => assertContext(attempt.context));
    assertContext(attempt.context);
    if (contentReceipt && (ownReceipt === 'own_success' ||
      fresh.currentContentHash !== ownReceipt.currentContentHash ||
      fresh.declaration?.requestHash !== ownReceipt.declaration?.requestHash ||
      fresh.declaration?.previousContentHash !== ownReceipt.declaration?.previousContentHash ||
      !await ArticlesService.saleDeclarationMatchesUpdate(fresh, attempt.updates, () => assertContext(attempt.context)))) {
      throw new Error('La source native ne qualifie plus le reçu de cette intention. Son journal est conservé.');
    }
    const stored = await ArticlesService.getArticleById(attempt.context.articleId, attempt.context.uid);
    assertContext(attempt.context);
    if (!stored || stored.id !== attempt.context.articleId || stored.sellerId !== attempt.context.uid) throw new Error('Le contenu actuel doit être relu avant de confirmer cet enregistrement.');
    if (contentReceipt) {
      const outsideStatement = ['price', 'isHandDelivery', 'isShipping', 'neighborhoods', 'neighborhood', 'packageSize', 'isActive'];
      if (stored.saleDeclaration?.contentHash !== fresh.currentContentHash || stored.saleDeclaration.requestHash !== fresh.declaration?.requestHash ||
        stored.saleDeclaration.previousContentHash !== fresh.declaration?.previousContentHash ||
        outsideStatement.some(key => Object.prototype.hasOwnProperty.call(attempt.updates, key) &&
          !sameJournalValue((stored as unknown as Record<string, unknown>)[key], attempt.updates[key]))) {
        throw new Error('Une autre modification empêche de rapprocher le contenu actuel de cette intention. Son journal est conservé.');
      }
    } else if ((ownReceipt !== 'own_success' && !inventoryReceipt) || !matchesRecordedUpdate(stored, attempt, !!inventoryReceipt)) {
      throw new Error('La lecture du contenu actuel ne suffit pas à prouver cet ancien enregistrement. Son journal est conservé.');
    }
    const saved = await readJournal(attempt.context);
    const {context: _context, ...original} = attempt;
    if (!saved || !sameJournalValue(saved, original)) throw new Error('Le journal de cette intention a changé. Aucun acquittement n’a été effectué.');
    assertContext(attempt.context);
    await AsyncStorage.removeItem(editAttemptKey(attempt.context.uid!, attempt.context.articleId));
    assertContext(attempt.context);
    const latest = currentFormRef.current;
    const unchanged = fingerprintForm({...applyArticlePendingEdits(latest.fields, latest.pendingEdits),
      expectedSaleDeclarationContentHash: attempt.fields.expectedSaleDeclarationContentHash}, latest.editedImages) === attempt.sourceFingerprint;
    queryClient.invalidateQueries({ queryKey: queryKeys.articles.all, refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: queryKeys.articles.userList(attempt.context.uid!), refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: queryKeys.articles.detail(attempt.context.articleId) });
    attemptRef.current = null;
    setAttemptDisplay(null);
    setHasUnknownSave(false);
    setFields(previous => previous.expectedSaleDeclarationContentHash === attempt.fields.expectedSaleDeclarationContentHash ? {
      ...currentEditedFields(previous), expectedSaleDeclarationContentHash: undefined,
    } : previous);
    queryClient.setQueryData(['article-sale-declaration', id, attempt.context.uid, attempt.context.generation, editScope.focusRevision], fresh);
    if (freshInventory) queryClient.setQueryData(['article-inventory-unit', id, attempt.context.uid, attempt.context.generation, editScope.focusRevision], freshInventory);
    if (!unchanged) {
      Alert.alert('Modification enregistrée', 'Votre nouvelle saisie a été conservée. Elle n’a pas été envoyée avec cet enregistrement.');
      return;
    }
    const savedFields = { ...currentEditedFields(attempt.fields), brandChanged: false, sizeChanged: false,
      childSafetyChanged: false,
      childSafetyContentSource: articleChildSafetyEditKey(attempt.fields as unknown as Record<string, unknown>, attempt.images),
      expectedSaleDeclarationContentHash: undefined,
      colorsSource: JSON.stringify(attempt.fields.colors), materialsSource: JSON.stringify(attempt.fields.materials) };
    setFields(savedFields);
    setPendingEdits({});
    setEditedImages(attempt.images);
    setInitialFields(savedFields);
    setInitialImages(attempt.images);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Succès', 'Article modifié avec succès', [{ text: 'OK', onPress: () => {
      if (!isCurrentContext(attempt.context)) return;
      allowLeaveRef.current = true;
      router.back();
    } }]);
  };

  const reconcileSave = async (attempt: EditAttempt): Promise<boolean> => {
    assertContext(attempt.context);
    try {
      if (hasContentReceipt(attempt.updates) || attempt.updates.inventoryUnitDeclaration !== undefined) {
        const view = await ArticlesService.readSaleDeclaration(attempt.context.articleId, () => assertContext(attempt.context));
        assertContext(attempt.context);
        // A legacy inventory intent may now have a technical V5 receipt. Its
        // exact request and precondition qualify it without an inventory group.
        if ((view.declaration?.version === 'listing_content_v1' || view.declaration?.version === 'listing_content_v2' || hasContentReceipt(attempt.updates)) &&
          await ArticlesService.saleDeclarationMatchesUpdate(view, attempt.updates, () => assertContext(attempt.context))) {
          await reportSaved(attempt, view); return true;
        }
        // A historical inventory receipt still needs its explicit exact replay.
        setHasUnknownSave(true); return false;
      }
      const stored = await ArticlesService.getArticleById(attempt.context.articleId, attempt.context.uid);
      assertContext(attempt.context);
      if (stored && stored.id === attempt.context.articleId && stored.sellerId === attempt.context.uid &&
          matchesRecordedUpdate(stored, attempt)) {
        // Without an own native receipt, identical current fields cannot
        // certify that this historical intention committed.
        setHasUnknownSave(true);
        Alert.alert('Intention non certifiée', 'Le contenu actuel correspond aux champs conservés, mais aucun reçu propre à cette ancienne intention ne permet de confirmer son enregistrement. Le journal et vos saisies sont conservés.');
        return false;
      }
    } catch (error) {
      if (!isCurrentContext(attempt.context)) return false;
      if (__DEV__) console.warn('Impossible de rapprocher la modification', error);
    }
    if (!isCurrentContext(attempt.context)) return false;
    setHasUnknownSave(true);
    Alert.alert('Enregistrement à vérifier',
      'Le résultat ne peut pas être confirmé. Vos saisies et photos sont conservées. Vérifiez cet enregistrement avant une nouvelle modification.',
      [{ text: 'OK' }]);
    return false;
  };

  const handleSave = async () => {
    if (!journalReady || loadedContext !== context || savingRef.current === context || !article || !id) return;
    const captured = context;
    try { assertContext(captured); } catch { return; }
    if (article.id !== captured.articleId || article.sellerId !== captured.uid) return;
    savingRef.current = captured;
    setIsSaving(true);
    if (attemptRef.current) {
      // The native declaration receipt permits only this exact explicit replay.
      // Older intentions remain read-only reconciliation.
      try {
        const previous = attemptRef.current;
        if (previous.updates.inventoryUnitDeclaration !== undefined) {
          const receipt = await ArticlesService.updateArticleWithInventory(captured.articleId, previous.updates, () => assertContext(captured));
          assertContext(captured); await reportSaved(previous, receipt);
        } else if (hasContentReceipt(previous.updates)) {
          const receipt = await ArticlesService.updateArticleWithDeclaration(captured.articleId, previous.updates, () => assertContext(captured));
          assertContext(captured); await reportSaved(previous, receipt);
        } else await reconcileSave(previous);
      } catch (error) {if (isCurrentContext(captured)) Alert.alert('Intention à vérifier', error instanceof Error ? error.message : 'Le résultat reste à rapprocher.');}
      finally { if (savingRef.current === captured) savingRef.current = null; if (isCurrentContext(captured)) setIsSaving(false); }
      return;
    }
    // An own historical intent was handled first. A failed NEW qualification
    // must neither strand the spinner nor discard the form or exact journal.
    if (useAuthStore.getState().user?.id !== captured.uid) {
      if (savingRef.current === captured) savingRef.current = null;
      setIsSaving(false);
      Alert.alert('Profil à relire', 'Votre intention et son reçu restent accessibles avec votre compte connecté. Relisez votre profil avant une nouvelle modification.');
      return;
    }
    if (preparationReadFailed === captured) {
      if (savingRef.current === captured) savingRef.current = null;
      setIsSaving(false);
      return;
    }
    if (article.isActive === false) {
      let qualified = false;
      try {
        const freshPreparation = await ChildSafetyReviewService.publicationPreview(captured.uid!, captured.articleId, () => assertContext(captured));
        assertContext(captured);
        if (!freshPreparation.canCorrectPreparationNow || freshPreparation.source.sourceHash !== articleQuery.data?.preparation?.source.sourceHash)
          throw new Error('La préparation ou ses gardes ont changé. Relisez le dossier avant de corriger.');
        qualified = true;
      } catch (error) {
        if (isCurrentContext(captured)) {
          setPreparationReadFailed(captured);
          Alert.alert('Préparation à relire', error instanceof Error ? error.message : 'La qualification actuelle a échoué. Vos saisies et votre journal sont conservés.');
        }
      } finally {
        if (!qualified) {
          if (savingRef.current === captured) savingRef.current = null;
          if (isCurrentContext(captured)) setIsSaving(false);
        }
      }
      if (!qualified) return;
    }
    const f: EditedFields = {...currentEditedFields(JSON.parse(JSON.stringify(applyArticlePendingEdits(fields, pendingEdits)))), expectedSaleDeclarationContentHash: saleView?.currentContentHash};
    const selected: ArticleImage[] = JSON.parse(JSON.stringify(editedImages));
    const failure = validateArticleEditForm(f, selected.length);
    const brandError = getArticleBrandEditError(f);
    const hygieneError = getArticleHygieneEditError(f);
    const childRequired = f.childSafetyRequired || ['child_clothing', 'canonical_sleepwear'].includes(childSafetyCategory(f.categoryIds));
    const childError = childRequired && (f.childSafetyChanged || f.childSafetyContentSource !== articleChildSafetyEditKey(f as unknown as Record<string, unknown>, selected)) && !articleChildSafetyInput(f.childSafetyDeclaration) ? 'Complétez les observations de sécurité sur le contenu modifié.' : null;
    const saleError = !saleView ? 'Relisez le contenu actuel de cette annonce avant d’enregistrer.' : null;
    if (failure || brandError || hygieneError || saleError || childError) {
      if (savingRef.current === captured) savingRef.current = null; setIsSaving(false);
      Alert.alert('Erreur', failure?.message ?? brandError ?? hygieneError ?? saleError ?? childError ?? 'Le contenu doit être relu.');
      return;
    }
    let uploaded: ArticleImage[] = [];
    let dispatched = false;
    let mutationConfirmed = false;
    let journalProblem = true;
    let attempt: EditAttempt | null = null;
    try {
      assertContext(captured);
      const saved = await readJournal(captured);
      journalProblem = false;
      if (saved) {
        const previous = { ...saved, context: captured };
        attemptRef.current = previous;
        setAttemptDisplay(saved);
        setHasUnknownSave(true);
        await reconcileSave(previous);
        return;
      }
      const freshContent = await ArticlesService.readSaleDeclaration(captured.articleId, () => assertContext(captured)); assertContext(captured);
      if (!saleView || freshContent.currentContentHash !== saleView.currentContentHash)
        throw new Error('Le contenu de cette annonce a changé. Relisez-le avant une nouvelle modification.');
      const locals = selected.map((img, idx) => ({ uri: img.url, idx }))
        .filter(({ uri }) => !isStorageUrl(uri) && !uri.startsWith('https://'));
      if (locals.length) {
        // Staging remains private until the existing writer promotes it.
        // Capture owner/article/attempt once; retries of unknown results use
        // the prepared references already preserved in the journal.
        const folder = `drafts/${captured.uid}/edit_${encodeURIComponent(captured.articleId)}_${randomUUID()}`;
        uploaded = await ArticlesService.uploadImagesReactNative(locals.map(({ uri }) => uri), folder, () => assertContext(captured));
        assertContext(captured);
        if (uploaded.length !== locals.length) throw new Error('Toutes les photos doivent être préparées avant l’enregistrement.');
      }
      const finalImages = selected.map((image, idx) => {
        const local = locals.findIndex(entry => entry.idx === idx);
        return local >= 0 ? uploaded[local] : image;
      });
      const updates = JSON.parse(JSON.stringify(buildArticleUpdates(f, finalImages))) as Record<string, unknown>;
      attempt = { context: captured, updates, images: finalImages, uploaded, selected, fields: f,
        sourceFingerprint: fingerprintForm(f, selected) };
      assertContext(captured);
      journalProblem = true;
      const pendingJournal = await readJournal(captured);
      if (pendingJournal) {
        const previous = { ...pendingJournal, context: captured };
        attemptRef.current = previous;
        setAttemptDisplay(pendingJournal);
        setHasUnknownSave(true);
        await reconcileSave(previous);
        return;
      }
      attemptRef.current = attempt;
      const {context: _context, ...display} = attempt;
      setAttemptDisplay(display);
      await preserveAttempt(attempt);
      assertContext(captured);
      journalProblem = false;
      dispatched = true;
      const ownReceipt = await ArticlesService.updateArticleWithDeclaration(captured.articleId, updates, () => assertContext(captured));
      mutationConfirmed = true;
      assertContext(captured);
      track('article_updated', { article_id: captured.articleId, outcome: 'saved',
        price_cents: Math.round(f.price * 100), photo_count: finalImages.length,
        local_photos_uploaded_count: uploaded.length, ...resolveTrackedDelivery(updates, article) });
      await reportSaved(attempt, ownReceipt);
    } catch (error) {
      if (!isCurrentContext(captured)) return;
      if (!dispatched) {
        // A journal read/write failure never proves that a different pending
        // intent is absent. Retain it and all media, block a new mutation.
        if (journalProblem) {
          attemptRef.current = null;
          setJournalRead({ context: captured, version: journalVersion, status: 'error', saved: null });
        } else {
          Alert.alert('Erreur', error instanceof Error ? error.message : 'Impossible de préparer les photos');
        }
        return;
      }
      const code = getCallableErrorCode(error);
      const refused = !mutationConfirmed && !!code && ['failed-precondition', 'invalid-argument', 'permission-denied',
        'unauthenticated', 'not-found', 'resource-exhausted'].includes(code);
      if (dispatched && attempt && !refused) {
        setHasUnknownSave(true);
        await reconcileSave(attempt);
        return;
      }
      // A definitive callable refusal precedes adoption in the real writer.
      // Fresh generated uploads are private to this attempt; re-read the only
      // article namespace that the writer can adopt them into before cleanup.
      if (uploaded.length) {
        try {
          const stored = await ArticlesService.getArticleById(captured.articleId);
          assertContext(captured);
          if (stored?.id === captured.articleId && stored.sellerId === captured.uid) {
            const referenced = new Set(stored.images.map(image => image.url));
            for (const image of uploaded) {
              assertContext(captured);
              if (!referenced.has(image.url)) await ArticlesService.deleteImage(image.url);
              assertContext(captured);
            }
          }
        } catch { /* Unreadable or changed context: retain every remaining upload. */ }
      }
      if (!isCurrentContext(captured)) return;
      await AsyncStorage.removeItem(editAttemptKey(captured.uid!, captured.articleId));
      if (!isCurrentContext(captured)) return;
      attemptRef.current = null;
      setAttemptDisplay(null);
      setHasUnknownSave(false);
      if (showAdmissionError(error, { isCurrent: () => isCurrentContext(captured), publication: {uid: captured.uid!} })) return;
      const serverMessage = refused && error instanceof Error ? error.message : 'Impossible de modifier l’article';
      Alert.alert('Erreur', serverMessage);
    } finally {
      if (savingRef.current === captured) savingRef.current = null;
      if (isCurrentContext(captured)) setIsSaving(false);
    }
  };

  const hasUnsavedChanges = useMemo(() => {
    if (!initialFields) return false;
    const init = initialFields;
    const fieldsChanged =
      fields.title !== init.title ||
      fields.description !== init.description ||
      fields.price !== init.price ||
      fields.condition !== init.condition ||
      JSON.stringify(fields.hygieneDeclaration) !== JSON.stringify(init.hygieneDeclaration) ||
      fields.hygieneKind !== init.hygieneKind ||
      fields.hygieneChanged !== init.hygieneChanged ||
      !sameJournalValue(fields.childSafetyDeclaration, init.childSafetyDeclaration) ||
      fields.childSafetyChanged !== init.childSafetyChanged ||
      fields.brand !== init.brand ||
      fields.brandChanged !== init.brandChanged ||
      fields.size !== init.size ||
      fields.sizeSystem !== init.sizeSystem ||
      fields.sizeChanged !== init.sizeChanged ||
      fields.isHandDelivery !== init.isHandDelivery ||
      fields.isShipping !== init.isShipping ||
      fields.packageSize !== init.packageSize ||
      JSON.stringify(fields.categoryIds) !== JSON.stringify(init.categoryIds) ||
      JSON.stringify(fields.colors) !== JSON.stringify(init.colors) ||
      JSON.stringify(fields.materials) !== JSON.stringify(init.materials) ||
      JSON.stringify(fields.neighborhoods) !== JSON.stringify(init.neighborhoods);
    const imagesChanged =
      JSON.stringify(editedImages) !== JSON.stringify(initialImages);
    const typingUnconfirmed = Object.keys(pendingEdits).length > 0;
    return fieldsChanged || imagesChanged || typingUnconfirmed;
  }, [fields, editedImages, pendingEdits, initialFields, initialImages]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (hasUnsavedChanges) {
      Alert.alert(
        'Modifications non enregistrées',
        'Voulez-vous vraiment quitter sans enregistrer ?',
        [
          {
            text: 'Rester',
            style: 'cancel',
            onPress: () =>
              track('sell_exit_prompted', {
                flow_step: 'edit',
                confirmed_leave: false,
                has_unsaved_changes: true,
              }),
          },
          {
            text: 'Quitter',
            style: 'destructive',
            onPress: () => {
              track('sell_exit_prompted', {
                flow_step: 'edit',
                confirmed_leave: true,
                has_unsaved_changes: true,
              });
              allowLeaveRef.current = true;
              router.back();
            },
          },
        ]
      );
    } else {
      router.back();
    }
  }, [router, hasUnsavedChanges]);

  // The iOS back swipe and the Android back button bypassed `handleBack` and
  // its « Modifications non enregistrées » alert: the edits were lost.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (allowLeaveRef.current || !hasUnsavedChanges) return;
        e.preventDefault();
        Alert.alert(
          'Modifications non enregistrées',
          'Voulez-vous vraiment quitter sans enregistrer ?',
          [
            { text: 'Rester', style: 'cancel' },
            {
              text: 'Quitter',
              style: 'destructive',
              onPress: () => {
                allowLeaveRef.current = true;
                navigation.dispatch(e.data.action);
              },
            },
          ],
        );
      }),
    [navigation, hasUnsavedChanges],
  );

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
      screen: 'edit',
      field: 'colors',
      value: colorId,
      selected_count_after: countAfter,
    });
  }, []);

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
      screen: 'edit',
      field: 'materials',
      value: matId,
      selected_count_after: countAfter,
    });
  }, []);

  const allColorItems = getColorItems();
  const allMaterialItems = getMaterialItems();

  // Photo management
  const handleAddPhoto = useCallback(async () => {
    const remainingSlots = 5 - editedImages.length;
    if (remainingSlots <= 0) return;
    const captured = context;
    if (!isCurrentContext(captured) || savingRef.current === captured || attemptRef.current) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
        selectionLimit: remainingSlots,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!isCurrentContext(captured)) return;
      if (!result.canceled && result.assets.length > 0) {
        const newImages = result.assets.map((asset) => ({ url: asset.uri }));
        const added = newImages.slice(0, remainingSlots);
        setEditedImages((prev) => [...prev, ...added]);
        track('sell_photo_added', {
          screen: 'edit',
          method: 'gallery',
          count_added: added.length,
          photo_count_after: editedImages.length + added.length,
        });
      } else if (result.canceled) {
        track('sell_photo_added', {
          screen: 'edit',
          method: 'gallery',
          count_added: 0,
          photo_count_after: editedImages.length,
          cancelled: true,
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  }, [editedImages.length]);

  const handleRemovePhoto = useCallback((index: number) => {
    setEditedImages((prev) => prev.filter((_, i) => i !== index));
    track('sell_photo_removed', {
      screen: 'edit',
      photo_index: index,
      photo_count_after: Math.max(0, editedImages.length - 1),
    });
  }, [editedImages.length]);

  const handleMakePrimary = useCallback((index: number) => {
    if (index === 0) return;
    setEditedImages((prev) => {
      const newImages = [...prev];
      const [image] = newImages.splice(index, 1);
      newImages.unshift(image);
      return newImages;
    });
  }, []);

  // Delivery management — la feuille remonte la sélection complète à la validation.
  const handleNeighborhoodsConfirm = useCallback((neighborhoods: MeetupNeighborhood[]) => {
    setFields((prev) => ({ ...prev, neighborhoods }));
    track('sell_field_edited', {
      screen: 'edit',
      field: 'neighborhoods',
      selected_count_after: neighborhoods.length,
    });
  }, []);

  const openNeighborhoodSheet = useCallback(() => {
    Keyboard.dismiss();
    neighborhoodSheetRef.current?.show();
  }, []);

  // Même source que le message d'erreur : le bouton ne peut plus être grisé
  // pour une raison que l'écran refuse d'énoncer.
  const isFormValid = preparationReadFailed !== context &&
    validateArticleEditForm(applyArticlePendingEdits(fields, pendingEdits), editedImages.length) === null &&
    getArticleBrandEditError(applyArticlePendingEdits(fields, pendingEdits)) === null &&
    getArticleHygieneEditError(applyArticlePendingEdits(fields, pendingEdits)) === null;
  const hygieneRequirement = articleHygieneRequirement(fields.categoryIds);
  const hygieneDecision = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration);
  const hygieneIsMixed = hygieneRequirement === 'mixed_underwear' || hygieneRequirement === 'mixed_cosmetic';
  const hygieneKind = hygieneRequirement === 'underwear' || hygieneRequirement === 'cosmetic'
    ? hygieneRequirement : fields.hygieneKind;
  const hygieneConfirmation = hygieneKind === 'underwear' ? 'Je confirme que ce sous-vêtement n’a jamais été porté.'
    : 'Je confirme que ce cosmétique est neuf, encore scellé et n’a jamais été ouvert.';

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Modifier l'article" onBack={handleBack} />
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

  if (!journalReady) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Modifier l'article" onBack={handleBack} />
        <View style={styles.content}>
          <Text style={styles.emptyPhotoText} accessibilityRole="alert">
            Impossible de relire votre enregistrement. Réessayez avant d’envoyer une modification.
          </Text>
          <Pressable style={styles.saveButton} accessibilityRole="button" onPress={() => setJournalVersion(value => value + 1)}>
            <Text style={styles.saveButtonText}>Réessayer le chargement</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!article || article.id !== id || article.sellerId !== authenticatedUid || loadedContext !== context) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={!isNeighborhoodSheetOpen}
    >
      {/* Header */}
      <ScreenHeader title="Modifier l'article" onBack={handleBack} />

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
                {privateMediaPath(editedImages[0]?.url, privateBucket) ? (
                  <PrivateStorageImage
                    uri={editedImages[0]?.url}
                    style={styles.mainPhoto}
                    contentFit="cover"
                  />
                ) : (
                  <Image
                    source={{ uri: editedImages[0]?.url }}
                    style={styles.mainPhoto}
                    contentFit="cover"
                  />
                )}
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
                    {privateMediaPath(img.url, privateBucket) ? (
                      <PrivateStorageImage
                        uri={img.url}
                        style={styles.thumbnail}
                        contentFit="cover"
                      />
                    ) : (
                      <Image
                        source={{ uri: img.url }}
                        style={styles.thumbnail}
                        contentFit="cover"
                      />
                    )}
                    <Pressable
                      style={styles.thumbnailRemove}
                      onPress={() => handleRemovePhoto(index)}
                      accessibilityRole="button"
                      accessibilityLabel="Retirer cette photo"
                      hitSlop={{ top: 12, right: 12, bottom: 4, left: 4 }}
                    >
                      <Ionicons name="close" size={12} color={colors.white} />
                    </Pressable>
                  </Pressable>
                ))}
                {editedImages.length < 5 && (
                  <Pressable style={styles.addPhotoButton} onPress={handleAddPhoto} accessibilityRole="button" accessibilityLabel="Ajouter des photos">
                    <Ionicons name="add" size={24} color={colors.muted} />
                  </Pressable>
                )}
              </ScrollView>
            </>
          )}
          {editedImages.length === 0 && (
            <Pressable style={styles.emptyPhotoButton} onPress={handleAddPhoto} accessibilityRole="button" accessibilityLabel="Ajouter des photos">
              <Ionicons name="camera-outline" size={32} color={colors.muted} />
              <Text style={styles.emptyPhotoText}>Ajouter des photos</Text>
            </Pressable>
          )}
        </View>

        {/* Form fields */}
        <View style={styles.formSection}>
          {preparationReadFailed === context ? <>
            <Text style={styles.sectionDescription}>La qualification actuelle de cette préparation est masquée. Vos saisies et votre journal sont conservés ; relisez avant un nouvel envoi.</Text>
            <Button variant="secondary" disabled={isSaving} onPress={() => {
              const captured = context;
              void (async () => {
                assertContext(captured);
                const fresh = await articleQuery.refetch(); assertContext(captured);
                if (fresh.error || !fresh.data?.article || fresh.data.article.isActive === false && fresh.data.preparation?.canCorrectPreparationNow !== true)
                  throw new Error('Cette préparation ne qualifie pas une nouvelle correction.');
                const declaration = await saleQuery.refetch(); assertContext(captured);
                if (declaration.error || !declaration.data) throw new Error('La déclaration actuelle doit aussi être relue.');
                setPreparationReadFailed(previous => previous === captured ? null : previous);
              })().catch(error => {if (isCurrentContext(captured)) Alert.alert('Préparation à relire', error instanceof Error ? error.message : 'La lecture reste inconnue.');});
            }}>Relire la qualification actuelle</Button>
          </> : null}
          <ArticleChildSafetyFields categoryIds={fields.categoryIds} value={fields.childSafetyDeclaration} required={fields.childSafetyRequired} disabled={isSaving || hasUnknownSave || preparationReadFailed === context} onChange={childSafetyDeclaration => {try {assertContext(context); if (attemptRef.current) return; setFields(previous => ({...previous, childSafetyDeclaration, childSafetyChanged: true, expectedSaleDeclarationContentHash: undefined}));} catch { /* No choice from a stale preparation. */ }}} />
          {/* Title */}
          <EditableField
            label="Titre"
            value={fields.title}
            onSave={(value) => updateField('title', value)}
            onDraftChange={trackPending('title')}
            placeholder="Ex: Robe d'été fleurie Zara"
            maxLength={80}
            required
          />

          {/* Description */}
          <EditableField
            label="Description"
            value={fields.description}
            onSave={(value) => updateField('description', value)}
            onDraftChange={trackPending('description')}
            placeholder="Décrivez votre article en détail..."
            multiline
            maxLength={500}
            required
          />

          {/* Price */}
          <EditableField
            label="Prix"
            value={priceDisplay ?? (fields.price > 0 ? fields.price.toString() : '')}
            onSave={(value) => { setPriceDisplay(value); updateField('price', Number(value.trim().replace(',', '.'))); }}
            onDraftChange={trackPending('price')}
            placeholder="0"
            keyboardType="decimal-pad"
            suffix="$"
            required
          />
          {!isValidArticlePrice(applyArticlePendingEdits(fields, pendingEdits).price) ?
            <Text accessibilityRole="alert" style={styles.priceError}>Indiquez un prix entre 0,01 $ et 10 000 $, avec au plus deux décimales. Votre saisie est conservée ; aucun arrondi automatique n’est appliqué.</Text> : null}

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
            onChange={(value) => {
              updateField('condition', value);
              track('sell_field_edited', { screen: 'edit', field: 'condition', value });
            }}
          />

          {hygieneRequirement !== 'none' && hygieneRequirement !== 'invalid' && (
            <>
              <Text style={styles.declarationTitle}>Règle d’hygiène</Text>
              <Text style={styles.brandGuidance}>
                Seuls les sous-vêtements jamais portés et les cosmétiques neufs encore scellés sont admis.
                {' '}{fields.hygieneDeclaration == null && fields.hygieneChanged !== true
                  ? 'Cette ancienne annonce reste à compléter avant une nouvelle vente. Les autres corrections restent possibles.'
                  : 'Cette déclaration sera visible par les acheteurs. Un changement de catégorie demande une nouvelle confirmation.'}
              </Text>
              {hygieneIsMixed && (
                <View style={styles.brandChoices} accessibilityRole="radiogroup" accessibilityLabel="Nature de l’article">
                  {([
                    { kind: hygieneRequirement === 'mixed_underwear' ? 'underwear' : 'cosmetic', label: hygieneRequirement === 'mixed_underwear' ? 'C’est un sous-vêtement' : 'C’est un cosmétique' },
                    { kind: 'not_applicable', label: hygieneRequirement === 'mixed_underwear' ? 'C’est un autre article, pas un sous-vêtement' : 'C’est un accessoire ou un autre article, pas un cosmétique' },
                  ] as const).map(choice => (
                    <Pressable key={choice.kind} accessibilityRole="radio" disabled={isSaving}
                      accessibilityState={{ checked: fields.hygieneKind === choice.kind, disabled: isSaving }}
                      style={[styles.brandChoice, fields.hygieneKind === choice.kind && styles.brandChoiceSelected]}
                      onPress={() => {
                        if (!isCurrentContext(context) || savingRef.current === context) return;
                        setFields(prev => ({ ...prev, hygieneChanged: true, hygieneKind: choice.kind,
                          hygieneDeclaration: choice.kind === 'not_applicable' ? { schemaVersion: 1, kind: 'not_applicable' } : null }));
                      }}>
                      <Text style={styles.brandChoiceText}>{choice.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {(hygieneKind === 'underwear' || hygieneKind === 'cosmetic') && (
                <Pressable accessibilityRole="checkbox" accessibilityLabel={hygieneConfirmation} disabled={isSaving}
                  accessibilityState={{ checked: fields.hygieneDeclaration?.kind === hygieneKind, disabled: isSaving }}
                  style={[styles.brandChoice, fields.hygieneDeclaration?.kind === hygieneKind && styles.brandChoiceSelected]}
                  onPress={() => {
                    if (!isCurrentContext(context) || savingRef.current === context) return;
                    setFields(prev => ({ ...prev, hygieneChanged: true,
                      hygieneDeclaration: prev.hygieneDeclaration?.kind === hygieneKind ? null
                        : hygieneKind === 'underwear' ? { schemaVersion: 1, kind: 'underwear', neverWorn: true }
                          : { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true } }));
                  }}>
                  <Text style={styles.brandChoiceText}>{hygieneConfirmation}</Text>
                </Pressable>
              )}
              {!hygieneDecision.allowed && <Text accessibilityRole="alert" style={styles.brandGuidance}>{hygieneDecision.message}</Text>}
            </>
          )}

          {/* Separator */}
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>Optionnel</Text>
            <View style={styles.separatorLine} />
          </View>

          <Pressable style={styles.sizeSelector} onPress={() => brandSheetRef.current?.show()} disabled={isSaving}>
            <Text style={styles.sizeSelectorLabel}>Marque</Text>
            <Text style={[styles.sizeSelectorValue, !fields.brand && styles.sizeSelectorPlaceholder]}>{fields.brand || 'Sans marque'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>

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
              {fields.size ? `${fields.size} ${fields.sizeSystem}` : 'Sélectionner une taille'}
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
            // Le flag des annonces ne donne aucun accès au rail d’achat.
            disabled={!SHIPPING_LISTINGS_ENABLED}
            onPress={() => {
              const enabled = !fields.isHandDelivery;
              updateField('isHandDelivery', enabled);
              track('sell_field_edited', { screen: 'edit', field: 'hand_delivery', enabled });
            }}
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
              onPress={openNeighborhoodSheet}
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
          {SHIPPING_LISTINGS_ENABLED && (
            <Pressable
              style={styles.deliveryToggle}
              onPress={() => {
                const enabled = !fields.isShipping;
                setFields(previous => ({...previous, isShipping: enabled,
                  packageSize: enabled ? automaticShippingEstimate({categoryIds: previous.categoryIds}).profileSize : previous.packageSize}));
                track('sell_field_edited', { screen: 'edit', field: 'shipping', enabled });
              }}
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
          )}

          {SHIPPING_LISTINGS_ENABLED && fields.isShipping && (
            <View style={styles.parcelEstimate}>
              <Text style={styles.parcelEstimateLabel}>Colis estimé</Text>
              <Text style={styles.parcelEstimateValue}>{automaticShippingEstimate({categoryIds: fields.categoryIds}).label}</Text>
            </View>
          )}
          {SHIPPING_LISTINGS_ENABLED && articleData?.isShipping && !articleData.isSold ? <Button variant="secondary" onPress={() => {
            if (isSaving) return;
            router.push({ pathname: '/article/shipping/[id]', params: { id } });
          }}>Préparer le colis et l’adresse d’envoi</Button> : null}
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
          disabled={isSaving || preparationReadFailed === context && !hasUnknownSave}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text
              style={[
                styles.saveButtonText,
                !isFormValid && styles.saveButtonTextDisabled,
              ]}
            >
              {hasUnknownSave ? attemptDisplay?.updates.saleDeclaration ? 'Reprendre l’enregistrement exact' : 'Vérifier l’enregistrement' : 'Enregistrer les modifications'}
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
        items={getSizesForCategory(fields.categoryIds, fields.sizeSystem).map((s) => ({
          value: s,
          label: s,
        }))}
        selectedValue={fields.size}
        onSelect={(value) => {
          setFields(prev => ({ ...prev, size: value, sizeChanged: true }));
          track('sell_field_edited', { screen: 'edit', field: 'size', value });
        }}
        type="size"
        sizeSystem={fields.sizeSystem}
        onSizeSystemChange={sizeSystem => {if (!isCurrentContext(context) || savingRef.current === context) return; setFields(prev => prev.sizeSystem === sizeSystem ? prev : {...prev, sizeSystem, size: null, sizeChanged: true});}}
      />

      <BrandSelectionSheet ref={brandSheetRef} singleSelect selectedBrand={fields.brand || null}
        onSelectSingle={brand => {if (!isCurrentContext(context) || savingRef.current === context) return; handleBrandSave(brand);}}
        onSelectNoBrand={() => {if (!isCurrentContext(context) || savingRef.current === context) return; handleBrandSave('');}} />

      <NeighborhoodBottomSheet
        ref={neighborhoodSheetRef}
        selectedNeighborhoods={fields.neighborhoods}
        onConfirm={handleNeighborhoodsConfirm}
        onVisibilityChange={setIsNeighborhoodSheetOpen}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fieldSection: {gap: spacing.sm, paddingVertical: spacing.md},
  sectionTitle: {...typography.h3, color: colors.foreground},
  sectionDescription: {...typography.body, color: colors.foregroundSecondary},
  priceError: { ...typography.bodySmall, color: colors.danger, marginBottom: spacing.md },
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
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
    // La pastille de retrait déborde en haut de la vignette : sans marge, la
    // ScrollView horizontale la rognait.
    paddingTop: spacing.sm,
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
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.overlay,
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
  brandChoices: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  brandChoice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  brandChoiceSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  brandChoiceText: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  brandGuidance: {
    ...typography.bodySmall,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  declarationTitle: {
    ...typography.bodySmall,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceWarm,
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
    fontFamily: fonts.sansMedium,
    color: colors.white,
    fontSize: 16,
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
  parcelEstimate: {gap: spacing.xs, marginLeft: spacing.xl, marginBottom: spacing.md},
  parcelEstimateLabel: {...typography.labelUppercase, color: colors.muted},
  parcelEstimateValue: {...typography.bodySmall, color: colors.foreground},
});
