import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { ProductReviewSource } from '@/components/ProductReviewSource';
import { ProductReviewCommandPanel } from '@/components/ProductReviewCommandPanel';
import { ProductReviewEvidencePanel } from '@/components/ProductReviewEvidencePanel';
import { ProductReviewCorpus } from '@/components/ProductReviewCorpus';
import { ProductReviewEntries, PRODUCT_REVIEW_TOPIC_LABELS, PRODUCT_REVIEW_ROLE_LABELS, PRODUCT_REVIEW_KIND_LABELS,
  PRODUCT_REVIEW_FACT_LABELS, PRODUCT_REVIEW_OUTCOME_LABELS } from '@/components/ProductReviewEntries';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { colors, spacing, typography } from '@/constants/theme';
import { PRODUCT_REVIEW_FACT_LIMITS, PRODUCT_REVIEW_ROLES, PRODUCT_REVIEW_TOPICS, ProductReviewService } from '@/services/productReviewService';
import type { ProductReviewCommunicationView, ProductReviewCommunicationEntryV2, ProductReviewContext, ProductReviewCursor, ProductReviewFacts, ProductReviewFactKey,
  ProductReviewOutcome, ProductReviewRole, ProductReviewScope, ProductReviewTopic, ProductReviewWorkflowKind, ProductReviewWorkflowPreviewV2,
  ProductReviewContributionCommand, ProductReviewContributionEntry, ProductReviewWorkflowCommand } from '@/types/productReview';
import type { ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { ProductMaterialDraftForm } from '@/components/ProductMaterialDraftForm';
import { ProductMaterialComparison } from '@/components/ProductMaterialComparison';
import type { ProductMaterialStatement } from '@/types/productMaterialReview';
import { ProductParcelDraftForm } from '@/components/ProductParcelDraftForm';
import { ProductParcelComparison } from '@/components/ProductParcelComparison';
import { ProductParcelAssessmentFields } from '@/components/ProductParcelAssessmentFields';
import { ProductParcelOperatorRoutes } from '@/components/ProductParcelOperatorRoutes';
import { createProductRoutingInteraction } from '@/utils/productRoutingStatement';
import { PRODUCT_ROUTING_REVIEW_ENABLED,PRODUCT_MIXED_ORDERS_REVIEW_ENABLED } from '@/config/featureFlags';
import {ProductMixedOrdersPanel} from '@/components/ProductMixedOrdersPanel';
import type {ProductMixedOrderStatement} from '@/types/productMixedOrders';
import type { ProductRoutingStatement } from '@/types/productRoutingReview';
import type { ProductParcelAssessment, ProductParcelStatement } from '@/types/productParcelReview';

type Form = {key: string; role: ProductReviewRole | null; topic: ProductReviewTopic | null; facts: ProductReviewFacts; text: string;
  kind: ProductReviewWorkflowKind | null; targetRoles: ProductReviewRole[]; privateNote: string; result: ProductReviewOutcome | null; references: string[]; evidenceReferences: string[]; acknowledged: boolean; parcelReviewRequested: boolean};
const empty = (key: string): Form => ({key, role: null, topic: null, facts: Object.fromEntries(Object.keys(PRODUCT_REVIEW_FACT_LIMITS).map(k => [k, null])) as ProductReviewFacts,
  text: '', kind: null, targetRoles: [], privateNote: '', result: null, references: [], evidenceReferences: [], acknowledged: false, parcelReviewRequested: false});
const topicFacts: Record<ProductReviewTopic, ProductReviewFactKey[]> = {
  authenticity: ['brand', 'model', 'productReference', 'provenance', 'expertiseSummary'],
  recall: ['brand', 'model', 'productReference', 'lot', 'recallReference', 'officialSourceDeclared'],
  child_safety: ['category', 'intendedUse', 'childSafetyObservation', 'officialSourceDeclared'],
  hygiene: ['conditionObserved', 'sealOrUseObservation', 'hygieneObservation'],
  animal_material: ['species', 'provenance', 'expertiseSummary', 'officialSourceDeclared'],
  nonconformity: [],
  parcel_delivery: [],
};
const contributionId = (e: import('@/types/productReview').ProductReviewContributionEntry) => e.qualification === 'unknown' ? e.contributionId : e.contribution.contributionId;
const communicationId = (e: ProductReviewCommunicationEntryV2) => e.qualification === 'unknown' ? e.eventId : e.communication.eventId;
type OwnOrderAction = {contributions: ProductReviewContributionEntry[]; sourceHash: string | null; enabled: boolean; onRecorded: () => void; nativeAdmission: ProductPhysicalDocumentaryAdmission | null};

/** Native admission supplies every private view. The independent own journal is always serviceable. */
export function ProductReviewCasePanel({uid, context, scope, renderOwnOrderAction, renderOrderPhysical, renderOrderCommercial, renderLateTransportRecovery, renderOrderRouting, renderReauthentication, assertRoutingSelection, material = false, parcel = false, routeAmendment = false, routingReview = false,mixedOrders=false}: {
  uid: string; context: ProductReviewContext; scope: ProductReviewScope; renderOwnOrderAction?: (state: OwnOrderAction) => ReactNode;
  renderOrderPhysical?: (nativeAdmission: ProductPhysicalDocumentaryAdmission | null) => ReactNode;
  renderOrderCommercial?: (nativeAdmission: ProductPhysicalDocumentaryAdmission | null) => ReactNode;
  renderLateTransportRecovery?: (nativeAdmission: ProductPhysicalDocumentaryAdmission | null) => ReactNode;
  renderOrderRouting?: (nativeAdmission: ProductPhysicalDocumentaryAdmission | null) => ReactNode;
  material?: boolean; parcel?: boolean; routeAmendment?: boolean; routingReview?: boolean;mixedOrders?:boolean;
  assertRoutingSelection?: () => void;
  renderReauthentication?: (props: {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; parcel?: boolean}) => ReactNode;
}) {
  const client = useQueryClient();
  const invalidatePhysical = () => {if (context.kind === 'order') void client.invalidateQueries({queryKey: ['product-physical-preview', uid, context.id]});};
  const materialActive = material && context.kind === 'order';
  const parcelActive = parcel && context.kind === 'order';
  const routeActive = parcelActive && routeAmendment;
  const base = useProductParcelContext(JSON.stringify(['product-review-case', context, scope, ...(materialActive ? ['product_review_material_v1'] : []), ...(parcelActive ? ['product_review_parcel_v1'] : []), ...(routeActive ? ['label_route_amendment_v1'] : [])]), uid, parcelActive);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context, scope, base.focusRevision, ...(materialActive ? ['product_review_material_v1'] : []), ...(parcelActive ? ['product_review_parcel_v1'] : []), ...(routeActive ? ['label_route_amendment_v1'] : [])]);
  const [readerAuthentication, setReaderAuthentication] = useState<string | null>(null);
  const [selection, setSelection] = useState<{key: string; item: ProductReviewCommunicationView} | null>(null);
  const [attachment, setAttachment] = useState<{key: string; contributionId: string} | null>(null);
  const [fileSelection, setFileSelection] = useState<{key: string; reference: ProductReviewEvidenceReference; sequence: number} | null>(null);
  const [evidenceRead, setEvidenceRead] = useState<{key: string; allowed: boolean} | null>(null);
  const [formState, setForm] = useState<Form | null>(null);
  const [materialPrepared, setMaterialPrepared] = useState<{key: string; value: {statement: string; materialStatement: ProductMaterialStatement}} | null>(null);
  const [parcelInteraction] = useState(createProductRoutingInteraction);
  const [parcelPrepared, setParcelPrepared] = useState<{key: string; value: {statement: string; parcelStatement: ProductParcelStatement; routingStatement?: ProductRoutingStatement;mixedOrderStatement?:ProductMixedOrderStatement}} | null>(null);
  const [mixedContest,setMixedContest]=useState<{key:string;reference:NonNullable<ProductMixedOrderStatement['contestedDecision']>}|null>(null);
  const [assessmentPrepared, setAssessmentPrepared] = useState<{key: string; value: ProductParcelAssessment} | null>(null);
  const readerAllowed = base.focused && (!parcelActive || scope === 'own' || readerAuthentication === key);
  const preview = useQuery<ProductReviewWorkflowPreviewV2>({queryKey: ['product-review-source', key], enabled: readerAllowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return ProductReviewService.workflowPreview(uid, context, scope, null, () => base.assertCurrent(op), true, materialActive, parcelActive, null, routeActive);}});
  const previewReady = base.focused && preview.isSuccess && !preview.isFetching && !preview.isError;
  const rawSource = previewReady ? preview.data.source : null;
  const readKey = JSON.stringify([key, rawSource?.sourceHash, rawSource?.readAt, previewReady ? preview.data.documentaryCorpusHash : null]);
  const selected = selection?.key === readKey ? selection.item : null;
  const parent = selected ? {id: selected.eventId, contentHash: selected.contentHash} : null;
  const parentContext = useProductParcelContext(JSON.stringify(['product-review-parent', readKey, parent]), uid, parcelActive);
  const parentPreview = useQuery({queryKey: ['product-review-parent', readKey, parent], enabled: scope === 'own' && previewReady && !!parent && parentContext.focused,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = parentContext.capture(); return ProductReviewService.workflowPreview(uid, context, 'own', parent, () => {base.capture(); parentContext.assertCurrent(op);}, true, materialActive, parcelActive, null, routeActive);}});
  const contributions = useInfiniteQuery({queryKey: ['product-review-contributions', readKey], enabled: previewReady && rawSource?.caseSource.present === true,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as ProductReviewCursor | null,
    queryFn: ({pageParam}) => {const op = base.capture(); if (!rawSource) throw new Error('Source à relire.');
      return ProductReviewService.page(uid, context, scope, 'contributions', pageParam, () => base.assertCurrent(op), rawSource.sourceHash, true, preview.data?.documentaryCorpusHash, materialActive, parcelActive, parcelActive,parcelActive);},
    getNextPageParam: page => page.nextCursor ?? undefined});
  const communications = useInfiniteQuery({queryKey: ['product-review-communications', readKey], enabled: previewReady && rawSource?.caseSource.present === true,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as ProductReviewCursor | null,
    queryFn: ({pageParam}) => {const op = base.capture(); if (!rawSource) throw new Error('Source à relire.');
      return ProductReviewService.page(uid, context, scope, 'communications', pageParam, () => base.assertCurrent(op), rawSource.sourceHash, true, preview.data?.documentaryCorpusHash, materialActive, parcelActive);},
    getNextPageParam: page => page.nextCursor ?? undefined});
  const historyReady = !!rawSource && (!rawSource.caseSource.present || contributions.isSuccess && communications.isSuccess && !contributions.isFetching && !communications.isFetching && !contributions.isError && !communications.isError);
  const contributionRows = historyReady ? contributions.data?.pages.flatMap(page => page.entries) ?? [] : [];
  const communicationRows = historyReady ? communications.data?.pages.flatMap(page => page.entries) ?? [] : [];
  const unique = new Set(contributionRows.map(contributionId)).size === contributionRows.length && new Set(communicationRows.map(communicationId)).size === communicationRows.length;
  const admittedSource = historyReady && unique ? rawSource : null;
  const source = admittedSource && (evidenceRead?.key !== readKey || evidenceRead.allowed) ? admittedSource : null;
  const parcelContributionsRead = !parcelActive || !!source && (!source.caseSource.present ||
    contributions.isSuccess && !contributions.isFetching && !contributions.isError && !contributions.hasNextPage && contributions.data.pages.at(-1)?.nextCursor === null&&communications.isSuccess&&!communications.isFetching&&!communications.isError&&!communications.hasNextPage&&communications.data.pages.at(-1)?.nextCursor===null);
  const documentaryKey = source && parcelContributionsRead && (!source.caseSource.present || evidenceRead?.key === readKey && evidenceRead.allowed) ? readKey : null;
  const documentaryLive = useRef<string | null>(null);
  useLayoutEffect(() => {documentaryLive.current = documentaryKey; return () => {documentaryLive.current = null;};}, [documentaryKey]);
  const nativeAdmission: ProductPhysicalDocumentaryAdmission | null = context.kind === 'order' && documentaryKey && source && preview.data ? {
    key: documentaryKey, uid, context: {kind: 'order', id: context.id}, scope, sourceHash: source.sourceHash, corpusHash: preview.data.documentaryCorpusHash,
    ...(materialActive ? {materialCapability: 'product_review_material_v1' as const} : {}),
    ...(parcelActive ? {parcelCapability: 'product_review_parcel_v1' as const} : {}),
    assertCurrent: () => {base.capture(); if (documentaryLive.current !== documentaryKey) throw new Error('La lecture documentaire actuelle doit être qualifiée.');},
    revalidate: async () => {
      const operation = base.capture(), assertCurrent = () => {base.assertCurrent(operation); if (documentaryLive.current !== documentaryKey) throw new Error('La lecture documentaire actuelle doit être qualifiée.');};
      assertCurrent(); const current = await ProductReviewService.workflowPreview(uid, context, scope, null, assertCurrent, true, materialActive, parcelActive, null, routeActive); assertCurrent();
      if (current.source.sourceHash !== source.sourceHash || current.documentaryCorpusHash !== preview.data.documentaryCorpusHash) throw new Error('Les sources ou le corpus documentaires ont changé. Relisez le dossier.');
    },
  } : null;
  const adminPreview = source && scope === 'admin' ? preview.data : null;
  const ownerPreview = source && selected && parentContext.focused && parentPreview.isSuccess && !parentPreview.isFetching && !parentPreview.isError &&
    parentPreview.data.source.sourceHash === source.sourceHash && parentPreview.data.documentaryCorpusHash === preview.data?.documentaryCorpusHash ? parentPreview.data : null;
  const workflow = adminPreview ?? ownerPreview;
  const formKey = JSON.stringify([readKey, selected?.eventId, selected?.contentHash, workflow?.source.sourceHash, workflow?.source.readAt, workflow?.documentaryCorpusHash]);
  const form = formState?.key === formKey ? formState : empty(formKey);
  const materialSources = source?.protocol === 'product_review_source_v3' || source?.protocol === 'product_review_source_v4' ? source.materialAttributes : null;
  const parcelSources = source?.protocol === 'product_review_source_v4' ? source.parcelSources : null;
  const materialValue = materialPrepared?.key === formKey ? materialPrepared.value : null;
  const prepareMaterial = (value: {statement: string; materialStatement: ProductMaterialStatement} | null) => {
    if (value && parcelActive) {try {base.capture();} catch {return;}}
    parcelInteraction.invalidate();
    setMaterialPrepared(previous => value ? {key: formKey, value} : previous?.key === formKey ? null : previous);
  };
  const parcelValue = parcelPrepared?.key === formKey ? parcelPrepared.value : null, assessment = assessmentPrepared?.key === formKey && form.parcelReviewRequested ? assessmentPrepared.value : null;
  const prepareParcel = (value: {statement: string; parcelStatement: ProductParcelStatement; routingStatement?: ProductRoutingStatement;mixedOrderStatement?:ProductMixedOrderStatement} | null) => {
    if (value) {try {base.capture();} catch {return;}}
    parcelInteraction.invalidate();
    setParcelPrepared(previous => value ? {key: formKey, value} : previous?.key === formKey ? null : previous);
  };
  const prepareAssessment = (value: ProductParcelAssessment | null) => {
    if (value) {try {base.capture();} catch {return;}}
    parcelInteraction.invalidate();
    setAssessmentPrepared(previous => value ? {key: formKey, value} : previous?.key === formKey ? null : previous);
  };
  const update = (patch: Partial<Form>) => {if (source && base.focused && (!selected || !!ownerPreview)) {try {if (parcelActive) base.capture(); parcelInteraction.invalidate(); setForm({...form, ...patch, key: formKey});} catch { /* Old activity grants no confirmation. */ }}};
  let draft: {type: 'contribution'; command: ProductReviewContributionCommand} | {type: 'workflow'; command: ProductReviewWorkflowCommand} | null = null;
  if (source && parcelActive && form.topic === 'parcel_delivery' && parcelSources && scope === 'own' && !selected && parcelValue && form.role && form.role !== 'reporter' && source.actorRoles.includes(form.role)) {
    draft = {type: 'contribution', command: {context, sourceHash: source.sourceHash, actorRole: form.role, topic: 'parcel_delivery', statement: parcelValue.statement,
      facts: Object.fromEntries(Object.keys(PRODUCT_REVIEW_FACT_LIMITS).map(k => [k, null])) as ProductReviewFacts, observedAt: null, parcelStatement: parcelValue.parcelStatement, ...(parcelValue.routingStatement ? {routingStatement: parcelValue.routingStatement} : {}),...(parcelValue.mixedOrderStatement?{mixedOrderStatement:parcelValue.mixedOrderStatement}:{})}};
  } else if (source && materialActive && form.topic === 'nonconformity' && materialSources && scope === 'own' && !selected && materialValue && form.role && form.role !== 'reporter' && source.actorRoles.includes(form.role)) {
    draft = {type: 'contribution', command: {context, sourceHash: source.sourceHash, actorRole: form.role, topic: 'nonconformity', statement: materialValue.statement,
      facts: Object.fromEntries(Object.keys(PRODUCT_REVIEW_FACT_LIMITS).map(k => [k, null])) as ProductReviewFacts, observedAt: null, materialStatement: materialValue.materialStatement}};
  } else if (source && form.topic !== 'parcel_delivery' && (!materialActive || form.topic !== 'nonconformity') && scope === 'own' && !selected && form.role && source.actorRoles.includes(form.role) && form.topic && form.text.trim()) {
    draft = {type: 'contribution', command: {context, sourceHash: source.sourceHash, actorRole: form.role, topic: form.topic, statement: form.text.trim(),
      facts: Object.fromEntries(Object.entries(form.facts).map(([k, v]) => [k, v?.trim() || null])) as ProductReviewFacts, observedAt: null}};
  } else if (source && workflow && form.kind && workflow.options.includes(form.kind) && form.text.trim() && (!form.parcelReviewRequested || form.kind !== 'issue_outcome' || assessment && workflow.parcelReview?.integrityQualified)) {
    if (scope === 'admin' ? form.privateNote.trim() && form.acknowledged && form.targetRoles.length > 0 && form.targetRoles.every(r => workflow.recipientRoles.includes(r)) &&
      (form.kind !== 'ask_details' || form.targetRoles.length === 1) && (form.kind !== 'issue_outcome' || form.result &&
        (form.result !== 'review_documented' || workflow.coverage.documentaryCompleteCurrentCaseSet && workflow.documentaryEvidenceBoundAtPreview)) : !!parent) {
      const completeReview = form.kind === 'issue_outcome' && (form.result === 'review_documented' || !!assessment);
      draft = {type: 'workflow', command: {context, sourceHash: workflow.source.sourceHash, kind: form.kind, text: form.text.trim(), targetRoles: scope === 'admin' ? [...form.targetRoles].sort() : [],
        privateNote: scope === 'admin' ? form.privateNote.trim() : null, result: form.kind === 'issue_outcome' ? form.result : null,
        contributionReferences: scope === 'admin' ? workflow.contributionReferences.filter(r => (completeReview || form.references.includes(r.id)) && r.contentHash !== null).map(r => ({id: r.id, contentHash: r.contentHash!})) : [],
        documentaryCorpus: {hash: workflow.documentaryCorpusHash, evidenceReferences: workflow.evidenceReferences.flatMap(r => r.qualification === 'native_stored_file' &&
          (completeReview || form.evidenceReferences.includes(r.evidence.id)) ? [r.evidence] : [])},
        parent: scope === 'admin' ? null : parent, acknowledged: scope === 'admin', ...(assessment && form.kind === 'issue_outcome' ? {parcelAssessment: assessment} : {})}};
    }
  }
  const choose = (item: ProductReviewCommunicationView) => {if (source && base.focused && scope === 'own') {try {base.capture(); parcelInteraction.invalidate(); setForm(null); setSelection({key: readKey, item});} catch { /* Stale private view. */ }}};
  const refresh = () => {try {if (parcelActive) base.capture(); parcelInteraction.invalidate(); setSelection(null); invalidatePhysical(); void preview.refetch();} catch { /* Private reads need a current activity epoch. */ }};
  const assertFormInteraction = parcelInteraction.capture();
  const assertNewCurrent = () => {base.capture(); assertFormInteraction();};
  const verifyParcelNew = async () => {
    if (!nativeAdmission || !draft) throw new Error('Relisez les sources et le corpus actuels.');
    const routingNew = draft.type === 'contribution' && !!draft.command.routingStatement,mixedNew=draft.type==='contribution'&&!!draft.command.mixedOrderStatement, assertInteraction = parcelInteraction.capture(), selectionFence = assertRoutingSelection;
    const assertCurrent = () => {nativeAdmission.assertCurrent(); if (routingNew||mixedNew) {selectionFence?.(); assertInteraction();} if (routingNew && !PRODUCT_ROUTING_REVIEW_ENABLED||mixedNew&&!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED) throw new Error('Le constat a changé ou son nouveau parcours reste fermé.');};
    assertCurrent(); await nativeAdmission.revalidate(); assertCurrent(); return assertCurrent;
  };
  return <View style={styles.section}>
    <Text style={styles.body}>Déclarations, demandes de précisions et réponses motivées restent privées. Vos observations brutes ne sont pas communiquées automatiquement aux autres parties.</Text>
    {parcelActive && scope === 'admin' ? renderReauthentication?.({uid, sourceKey: key, disabled: !base.focused || preview.isFetching, parcel: true, onVerified: () => {try {base.capture(); parcelInteraction.invalidate(); setReaderAuthentication(key); setForm(null); setAssessmentPrepared(null); void preview.refetch();} catch { /* A prior activity epoch grants no read admission. */ }}}) : null}
    <Button variant="secondary" disabled={preview.isFetching || contributions.isFetching || communications.isFetching} onPress={refresh}>Relire explicitement les sources actuelles</Button>
    {preview.isFetching || contributions.isFetching || communications.isFetching ? <Text style={styles.caption}>Lecture actuelle du dossier…</Text> : null}
    {preview.isError || contributions.isError || communications.isError || !unique ? <Text accessibilityRole="alert" style={styles.caption}>Le dossier privé ne peut pas être qualifié dans cette lecture. Les anciennes données sont masquées. Votre intention personnelle conservée reste consultable ci-dessous.</Text> : null}
    {admittedSource && !source ? <Text accessibilityRole="alert" style={styles.caption}>La lecture des pièces ou du corpus doit être qualifiée. Les références privées et les nouvelles démarches sont masquées jusqu’à une lecture concordante ou une relecture explicite des sources.</Text> : null}
    {source ? <><ProductReviewSource source={source} />
      <Text accessibilityRole="header" style={styles.title}>{scope === 'admin' ? 'Contributions privées et échanges du dossier' : 'Mes contributions et échanges qui me sont adressés'}</Text>
      <ProductReviewEntries contributions={contributionRows} communications={communicationRows} materialSources={materialSources} parcelSources={parcelSources} admin={scope === 'admin'} onChoose={choose} onAttach={id => {
        if (source && scope === 'own' && contributionRows.some(r => r.qualification === 'native_actor_contribution' && r.contribution.actorId === uid && r.contribution.contributionId === id)) {
          try {base.capture(); setAttachment({key: readKey, contributionId: id});} catch { /* Stale source cannot select a new piece. */ }
        }
      }} />
      <Text style={styles.caption}>Pages parcourues : contributions {contributions.data?.pages.length ?? 0}, échanges {communications.data?.pages.length ?? 0}. Cet historique accessible ne certifie pas un historique exhaustif.</Text>
      {parcelActive && !parcelContributionsRead ? <Text style={styles.caption}>Parcourez toutes les pages de constats et d’échanges, y compris les observations de routage et de mélange, avant une nouvelle instruction liée au corpus ou financière. Une page visible vide avec un curseur ne termine pas cette lecture ; le bouton suivant reste disponible. Les sources et les propres reçus restent consultables.</Text> : null}
      {contributions.hasNextPage ? <Button variant="secondary" onPress={() => {void contributions.fetchNextPage();}}>Lire les contributions suivantes</Button> : null}
      {communications.hasNextPage ? <Button variant="secondary" onPress={() => {void communications.fetchNextPage();}}>Lire les échanges suivants</Button> : null}
      {scope === 'own' && selected ? <><Text selectable style={styles.body}>Échange ciblé : {selected.text}</Text>
        {parentPreview.isError || parentPreview.isSuccess && !ownerPreview ? <Text accessibilityRole="alert" style={styles.caption}>La demande ou les sources ont changé. Relisez le dossier puis choisissez à nouveau l’échange exact.</Text> : null}
        <Button variant="secondary" onPress={() => {parcelInteraction.invalidate(); setSelection(null); setForm(null);}}>Revenir à une nouvelle contribution</Button></> : null}
      {scope === 'own' && !selected && context.kind === 'order' && (form.topic === 'recall' || form.topic === 'hygiene') ? <Text style={styles.body}>Ce dépôt explicite de rappel ou d’hygiène enregistre un signal conservatoire pour les nouveaux transports. Votre récit reste une déclaration à vérifier ; il ne prouve pas un danger ou un état sanitaire et ne crée pas de gel de fonds. Les instructions physiques et les recours commerciaux sont examinés séparément.</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{scope === 'own' && !selected ? 'Déposer une déclaration personnelle' : 'Préparer un échange pour les sources examinées'}</Text>
      {workflow ? <ProductReviewCorpus preview={workflow} contributionSelection={form.references} evidenceSelection={form.evidenceReferences}
        selectAll={form.kind === 'issue_outcome' && (form.result === 'review_documented' || form.parcelReviewRequested)}
        onToggleContribution={scope === 'admin' ? id => update({references: form.references.includes(id) ? form.references.filter(r => r !== id) : [...form.references, id], acknowledged: false}) : undefined}
        onToggleEvidence={id => update({evidenceReferences: form.evidenceReferences.includes(id) ? form.evidenceReferences.filter(r => r !== id) : [...form.evidenceReferences, id], acknowledged: false})} onSelect={reference => {
        if (source && base.focused && (scope === 'admin' || reference.actorId === uid)) {try {base.capture(); setFileSelection(previous => ({key: readKey, reference, sequence: (previous?.sequence ?? 0) + 1}));} catch { /* Exact current native corpus only. */ }}
      }} /> : null}
      {scope === 'own' && !selected ? <>
        <Text style={styles.caption}>Choisissez explicitement votre rôle et le sujet. Toutes les informations ci-dessous sont déclarées, sans certification.</Text>
        {PRODUCT_REVIEW_ROLES.filter(r => source.actorRoles.includes(r)).map(role => <Button key={role} variant={form.role === role ? 'primary' : 'secondary'} onPress={() => update({role})}>{PRODUCT_REVIEW_ROLE_LABELS[role]}</Button>)}
        {([...PRODUCT_REVIEW_TOPICS, ...(materialActive ? ['nonconformity' as const] : []), ...(parcelActive ? ['parcel_delivery' as const] : [])]).map(topic => <Button key={topic} variant={form.topic === topic ? 'primary' : 'secondary'} onPress={() => {update({topic}); setMaterialPrepared(null); setParcelPrepared(null);}}>{PRODUCT_REVIEW_TOPIC_LABELS[topic]}</Button>)}
        {materialActive && materialSources && form.topic === 'nonconformity' ? <ProductMaterialDraftForm uid={uid} transactionId={context.id} sourceKey={formKey} sourceHash={source.sourceHash} sources={materialSources}
          actorRole={form.role === 'buyer' || form.role === 'seller' ? form.role : null} enabled={!!source && base.focused} onPrepared={prepareMaterial} /> : null}
        {parcelActive && parcelSources && form.topic === 'parcel_delivery' ? <ProductParcelDraftForm uid={uid} transactionId={context.id} sourceKey={formKey} sourceHash={source.sourceHash} sources={parcelSources} routingReview={routingReview} mixedOrders={mixedOrders} contestedMixedDecision={mixedContest?.key===readKey?mixedContest.reference:null} actorRole={form.role === 'buyer' || form.role === 'seller' ? form.role : null} enabled={!!source && base.focused} onPrepared={prepareParcel} /> : null}
        {form.topic && form.topic !== 'nonconformity' && form.topic !== 'parcel_delivery' ? topicFacts[form.topic].map(field => <View key={field} style={styles.section}><Text style={styles.caption}>{PRODUCT_REVIEW_FACT_LABELS[field]} — information déclarée, facultative</Text>
          <TextInput accessibilityLabel={PRODUCT_REVIEW_FACT_LABELS[field]} value={form.facts[field] ?? ''} maxLength={PRODUCT_REVIEW_FACT_LIMITS[field]} multiline style={styles.input}
            onChangeText={value => update({facts: {...form.facts, [field]: value}})} /></View>) : null}
        {form.topic !== 'nonconformity' ? <Text style={styles.caption}>La date de votre observation reste inconnue dans ce dépôt. Vous pouvez préciser ce que vous savez dans le récit ; la date d’enregistrement sera conservée séparément.</Text> : null}
      </> : workflow ? <>
        {workflow.options.map(kind => <Button key={kind} variant={form.kind === kind ? 'primary' : 'secondary'} onPress={() => update({kind, result: null, acknowledged: false})}>{PRODUCT_REVIEW_KIND_LABELS[kind]}</Button>)}
        {scope === 'admin' ? <>
          <Text style={styles.caption}>Destinataires natifs de ce texte communicable. Une demande de précisions vise une seule partie.</Text>
          {workflow.recipientRoles.map(role => <Checkbox key={role} accessibilityLabel={PRODUCT_REVIEW_ROLE_LABELS[role]} checked={form.targetRoles.includes(role)} onToggle={() => update({targetRoles:
            form.targetRoles.includes(role) ? form.targetRoles.filter(r => r !== role) : [...form.targetRoles, role], acknowledged: false})}><Text style={styles.body}>{PRODUCT_REVIEW_ROLE_LABELS[role]}</Text></Checkbox>)}
          {form.kind === 'issue_outcome' ? (Object.keys(PRODUCT_REVIEW_OUTCOME_LABELS) as ProductReviewOutcome[]).map(result => <Button key={result} variant={form.result === result ? 'primary' : 'secondary'}
            disabled={result === 'review_documented' && !workflow.coverage.documentaryCompleteCurrentCaseSet} onPress={() => update({result, acknowledged: false})}>{PRODUCT_REVIEW_OUTCOME_LABELS[result]}</Button>) : null}
          {parcelActive && parcelSources && form.kind === 'issue_outcome' ? <><Checkbox checked={form.parcelReviewRequested} onToggle={() => {update({parcelReviewRequested: !form.parcelReviewRequested, acknowledged: false}); setAssessmentPrepared(null);}}><Text style={styles.body}>Ajouter une appréciation documentaire explicite du colis à cette issue</Text></Checkbox>
            {workflow.operatorParcelRoutes ? <ProductParcelOperatorRoutes routes={workflow.operatorParcelRoutes} /> : null}
            {form.parcelReviewRequested ? <ProductParcelAssessmentFields sourceKey={formKey} sources={parcelSources} operatorRoutes={workflow.operatorParcelRoutes ?? null} enabled={!!source && base.focused} onPrepared={prepareAssessment} /> : null}</> : null}
          <Text style={styles.caption}>{workflow.coverage.documentaryCompleteCurrentCaseSet ? 'Un examen documentaire complet liera TOUTES les contributions et pièces du corpus natif affiché, dans leur ordre exact.' :
            'Les inconnus, absences, pièces à rapprocher, intentions en attente ou limites de lecture empêchent un examen documentaire complet. Les demandes de précisions et issues d’information incomplète restent disponibles.'}</Text>
          <Text style={styles.caption}>Aperçu : {workflow.coverage.contributionsInspected} contributions et {workflow.coverage.communicationsInspected} échanges inspectés ; {workflow.coverage.completeCurrentCaseSet ? 'ensemble courant qualifié dans les limites de cette lecture' : 'ensemble courant incomplet ou non qualifié'}.</Text>
          <Text style={styles.caption}>Pour les autres échanges, choisissez explicitement les références de contributions et pièces dans le corpus affiché ci-dessus. Elles seront liées à ce texte exact.</Text>
          <Text style={styles.caption}>Motivation privée obligatoire, visible uniquement par l’équipe :</Text><TextInput accessibilityLabel="Motivation privée" multiline maxLength={4000} value={form.privateNote}
            style={styles.input} onChangeText={privateNote => update({privateNote, acknowledged: false})} />
        </> : null}
      </> : null}
      {scope === 'own' && !selected && form.topic !== 'nonconformity' && form.topic !== 'parcel_delivery' || workflow ? <><Text style={styles.caption}>{scope === 'admin' ? 'Texte explicitement communicable aux destinataires choisis' : 'Mon récit déclaré'}</Text>
        <TextInput accessibilityLabel="Récit ou texte communicable" multiline maxLength={4000} value={form.text} style={styles.input} onChangeText={text => update({text, acknowledged: false})} />
        {scope === 'admin' ? <Checkbox accessibilityLabel="Confirmation de l’examen documentaire exact" checked={form.acknowledged} onToggle={() => update({acknowledged: !form.acknowledged})}>
          <Text style={styles.body}>J’ai examiné ces sources et je confirme le texte, ses destinataires et cette issue documentaire. Aucun effet financier, de stock ou d’expédition n’est autorisé.</Text></Checkbox> : null}</> : null}
      <Text style={styles.caption}>Une contribution personnelle peut recevoir une image privée préparée séparément. Ne publiez pas de lien public vers une preuve ni de document d’identité dans votre récit.</Text>
    </> : null}
    {source && materialActive && materialSources && scope === 'admin' ? <ProductMaterialComparison sources={materialSources} statement={null} statementState="none" /> : null}
    {source && parcelActive && parcelSources && scope === 'admin' ? <ProductParcelComparison sources={parcelSources} statement={null} /> : null}
    <ProductReviewCommandPanel uid={uid} context={context} sourceKey={formKey} draft={draft} enabled={!!source && !!draft}
      material={materialActive}
      parcel={parcelActive} routeAmendment={routeActive} verifyNew={parcelActive ? verifyParcelNew : undefined} assertNewCurrent={assertNewCurrent}
      onSubmitted={invalidatePhysical} onRecorded={() => {setForm(null); refresh();}} />
    <ProductReviewEvidencePanel uid={uid} context={context} scope={scope} sourceHash={admittedSource?.sourceHash ?? null}
      material={materialActive}
      parcel={parcelActive}
      corpusHash={admittedSource ? preview.data?.documentaryCorpusHash ?? null : null} enabled={!!admittedSource?.caseSource.present}
      contributionId={admittedSource && attachment?.key === readKey ? attachment.contributionId : null}
      selectedReference={admittedSource && fileSelection?.key === readKey ? fileSelection.reference : null}
      selectedReferenceKey={admittedSource && fileSelection?.key === readKey ? JSON.stringify([readKey, fileSelection.sequence]) : null}
      onCurrentReadChange={allowed => {if (allowed && parcelActive) {try {base.capture();} catch {return;}} setEvidenceRead(previous => previous?.key === readKey && previous.allowed === allowed ? previous : {key: readKey, allowed});}}
      onRecorded={() => {setForm(null); refresh();}} />
    {scope === 'own' && context.kind === 'order' ? renderOwnOrderAction?.({contributions: source ? contributionRows : [],
      sourceHash: source?.sourceHash ?? null, enabled: !!source, nativeAdmission, onRecorded: () => {setForm(null); refresh();}}) : null}
    {context.kind === 'order' ? renderOrderPhysical?.(nativeAdmission) : null}
    {context.kind === 'order' && materialActive ? renderOrderCommercial?.(nativeAdmission) : null}
    {context.kind === 'order' && parcelActive ? renderLateTransportRecovery?.(nativeAdmission) : null}
    {context.kind === 'order' && parcelActive && routingReview ? renderOrderRouting?.(nativeAdmission) : null}
    {context.kind==='order'&&parcelActive&&mixedOrders?<ProductMixedOrdersPanel uid={uid} context={{kind:'order',id:context.id}} scope={scope} nativeAdmission={nativeAdmission} enabled={!!source} renderReauthentication={renderReauthentication} assertSelection={assertRoutingSelection} onRecorded={()=>{parcelInteraction.invalidate();setForm(null);refresh();}} onContest={reference=>{try{base.capture();assertRoutingSelection?.();parcelInteraction.invalidate();setSelection(null);setParcelPrepared(null);setMixedContest({key:readKey,reference});setForm({...empty(formKey),topic:'parcel_delivery'});}catch{/* Only the current addressed decision may prepare a new explicit statement. */}}}/>:null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
