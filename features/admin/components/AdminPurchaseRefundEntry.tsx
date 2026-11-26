import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { PurchaseRefundTermsForm } from '@/components/PurchaseRefundTermsForm';
import { PurchaseRefundTermsSummary } from '@/components/PurchaseRefundTermsSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { PurchaseRefundService } from '@/services/purchaseRefundService';
import { TransactionService } from '@/services/transactionService';
import { productFinancialCaseId } from '@/services/adminProductFinancialSource';
import { readAdminFinancialAttempts, adminReturnToSenderFinancialReference, adminTransportFinancialReference, type AdminFinancialAttempt, type AdminFinancialPreview } from '@/services/adminFinancialDecisionJournal';
import { readDisputeResolutionAttempts, type DisputeResolutionAttempt } from '@/services/disputeResolutionJournal';
import { purchaseRefundEqual, purchaseRefundId, isPurchaseRefundAllocation, purchaseRefundTotal } from '@/utils/purchaseRefundContract';
import {PURCHASE_REFUND_COMPONENTS, type PurchaseRefundAllocation, type PurchaseRefundPreviewContext, type PurchaseRefundTerms, type PurchaseRefundTermsV2} from '@/types/purchaseRefund';
import {formatCents} from '@/utils/formatPrice';
import {ConvenienceReturnService} from '@/services/convenienceReturnService';
import {ConvenienceReturnJournal} from '@/services/convenienceReturnJournal';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {CONVENIENCE_RETURN_INCIDENT_CAPABILITY, type ConvenienceReturnCloseBasis, type ConvenienceReturnIncidentAttempt, type ConvenienceReturnIncidentCommand, type ConvenienceReturnIncidentReceipt} from '@/types/convenienceReturn';
import {buildConvenienceReturnIncidentCommand} from '@/utils/convenienceReturnContract';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminProductFinancialReview } from './AdminProductFinancialReview';
import { AdminReturnToSenderFinancialReview } from './AdminReturnToSenderFinancialReview';
import { AdminTransportFinancialReview } from './AdminTransportFinancialReview';
import { AdminPurchaseRefundHistory } from './AdminPurchaseRefundHistory';
type Kind = 'pure' | 'authenticity' | 'nonconformity' | 'parcel_delivery' | 'return_to_sender_cases' | 'transport_review';
interface Draft {key: string; requestId: string; preview: AdminFinancialPreview; context: PurchaseRefundPreviewContext; note: string; current: boolean; opened: boolean; examined: boolean; reauthenticated: boolean; accepted: boolean}
const enteredCents = (text: string): number | null => {if (!/^\d+(?:[,.]\d{1,2})?$/.test(text)) return null; const cents = Math.round(Number(text.replace(',', '.')) * 100); return Number.isSafeInteger(cents) ? cents : null;};
export function AdminPurchaseRefundEntry({uid, disabled, selection, blockedTransactions = [], onRecorded, material = false, parcel = false, showHistory = true}: {uid: string; disabled: boolean; selection?: {transactionId: string; disputeId: string}; blockedTransactions?: string[]; onRecorded: () => void; material?: boolean; parcel?: boolean; showHistory?: boolean}) {
  const frame = useLabelLifecycleContext(`admin-purchase-refund:${disabled}:${material}:${parcel}`, uid), client = useQueryClient();
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, disabled, material, parcel]);
  const [input, setInput] = useState<{key: string; transactionId: string; disputeId: string} | null>(null), currentInput = input?.key === key ? input : {key, transactionId: selection?.transactionId ?? '', disputeId: selection?.disputeId ?? ''};
  const readKey = JSON.stringify([key, currentInput.transactionId.trim(), currentInput.disputeId.trim()]);
  const [form, setForm] = useState<{key: string; mode: 'operator' | 'agreement' | 'resume' | 'convenience'; kind: Kind | null; target: 'claim' | 'agreement' | null; transportReviewId: string; arrival: 'not_arrived_declared' | 'unknown' | null; motivation: string; card: string; wallet: string} | null>(null);
  const [termsFrame, setTerms] = useState<{key: string; terms: PurchaseRefundTerms} | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null), lock = useRef<symbol | null>(null);
  const interactions = useRef(0);
  const sourceQuery = useQuery({queryKey: ['admin-purchase-refund-source', readKey], enabled: !disabled && frame.focused && purchaseRefundId(currentInput.transactionId.trim()), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(); return PurchaseRefundService.source(uid, currentInput.transactionId.trim(), () => frame.assertCurrent(op), true, purchaseRefundId(currentInput.disputeId.trim()) ? currentInput.disputeId.trim() : undefined);}});
  const source = !disabled && frame.focused && sourceQuery.isSuccess && !sourceQuery.isFetching && !sourceQuery.isError ? sourceQuery.data : null;
  const sourceKey = JSON.stringify([readKey, source?.sourceRevision, source?.sourceHash, source?.agreement?.contentHash, source?.reservedRefund, source?.returnReviewSource, source?.convenienceReturnSource, sourceQuery.dataUpdatedAt]);
  const currentForm = form?.key === sourceKey ? form : null, preparedTerms = termsFrame?.key === sourceKey ? termsFrame.terms : null;
  const journal = useQuery({queryKey: ['admin-purchase-refund-existing', key], enabled: !disabled && frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = frame.capture(); const result = await Promise.all([readAdminFinancialAttempts(uid, () => frame.assertCurrent(op)), readDisputeResolutionAttempts(uid, () => frame.assertCurrent(op)), ConvenienceReturnJournal.readIncidents(uid, () => frame.assertCurrent(op))]); frame.assertCurrent(op); return result;}});
  const journalReady = !disabled && frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const blocked = [...blockedTransactions, ...(journalReady ? journal.data.flatMap(rows => rows.map(a => a.transactionId)) : [])];
  const canRead = !!source && source.qualification === 'native_initial_and_cumulative' && !!source.sourceRevision && journalReady && !blocked.includes(source.transactionId);
  const canNew = canRead && (!source?.reservedRefund || source.reservedRefund.fundsAppliedRecorded && source.reservedRefund.state === 'succeeded');
  const current = frame.focused && !disabled && draft?.key === sourceKey ? draft : null;
  const incidentQueryKey = ['admin-convenience-return-incident', readKey];
  const incidentQuery = useQuery({queryKey: incidentQueryKey, enabled: !disabled && frame.focused && purchaseRefundId(currentInput.transactionId.trim()), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(); return ConvenienceReturnService.incidentPreview(uid, currentInput.transactionId.trim(), 'operator', () => frame.assertCurrent(op));}});
  const incidentReady = !disabled && frame.focused && journalReady && incidentQuery.isSuccess && incidentQuery.fetchStatus === 'idle' && !incidentQuery.isError && client.getQueryState(incidentQueryKey)?.isInvalidated === false;
  const incident = incidentReady ? incidentQuery.data : null, incidentKey = JSON.stringify([readKey, incidentQuery.dataUpdatedAt, incident]);
  const [incidentForm, setIncidentForm] = useState<{key: string; action: ConvenienceReturnIncidentCommand['action']; basis: ConvenienceReturnCloseBasis | null; risk: boolean; note: string; reauthenticated: boolean; accepted: boolean} | null>(null);
  const activeIncidentForm = incidentForm?.key === incidentKey ? incidentForm : null;
  const [incidentResult, setIncidentResult] = useState<{key: string; receipt: ConvenienceReturnIncidentReceipt} | null>(null);
  const incidentInteraction = useRef(0);
  const changeIncident = (patch: Partial<NonNullable<typeof incidentForm>>) => {if (!activeIncidentForm) return; try {frame.capture(); incidentInteraction.current++; setIncidentForm(old => old?.key === incidentKey ? {...old, ...patch, reauthenticated: patch.reauthenticated ?? false, accepted: patch.accepted ?? false} : old);} catch { /* Old choices cannot authorize an incident. */ }};
  const selectIncident = (action: ConvenienceReturnIncidentCommand['action']) => {try {frame.capture(); if (!incident || blocked.includes(incident.transactionId) || !(action === 'close_unfurnished_return' ? incident.canClose : incident.canAdopt)) return; incidentInteraction.current++; setIncidentForm({key: incidentKey, action, basis: null, risk: false, note: '', reauthenticated: false, accepted: false});} catch { /* No stale incident admission. */ }};
  const live = useRef({key: sourceKey, frame}); useLayoutEffect(() => {live.current = {key: sourceKey, frame};}, [sourceKey, frame]);
  const onRead = useCallback((valid: boolean, opened: boolean) => {if (valid || opened) {try {if (live.current.key !== sourceKey) return; live.current.frame.capture();} catch {return;}} setDraft(old => !old || old.key !== sourceKey || old.current === valid && old.opened === opened ? old : {...old, current: valid, opened, examined: false, accepted: false});}, [sourceKey, setDraft]);
  const onPrepared = (terms: PurchaseRefundTerms | null) => {if (live.current.key !== sourceKey) return; if (terms) {try {frame.capture();} catch {return;}} interactions.current++; setTerms(old => terms ? {key: sourceKey, terms} : old?.key === sourceKey ? null : old); setDraft(old => old?.key === sourceKey ? null : old);};
  const choose = (mode: 'operator' | 'agreement' | 'resume' | 'convenience') => {try {frame.capture(); if (!canRead || mode !== 'resume' && !canNew) return; interactions.current++; setForm({key: sourceKey, mode, kind: mode === 'convenience' ? 'pure' : null, target: null, transportReviewId: '', arrival: null, motivation: '', card: '', wallet: ''}); setTerms(null); setDraft(null); setNotice(null);} catch { /* Active exact sources are required. */ }};
  const change = (patch: Partial<NonNullable<typeof form>>) => {if (!currentForm) return; try {frame.capture(); interactions.current++; setForm(old => old?.key === sourceKey && old.mode === currentForm.mode ? {...old, ...patch, key: sourceKey} : old); setDraft(null);} catch { /* Old activity cannot change an instruction. */ }};
  const open = async () => {
    if (!canRead || !source || !currentForm || currentForm.mode !== 'resume' && !canNew || lock.current) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return; const token = Symbol(); lock.current = token; setBusy(key); setNotice(null); setDraft(null);
    const interaction = ++interactions.current;
    const assertCurrent = () => {frame.assertCurrent(op); if (live.current.key !== sourceKey || interactions.current !== interaction) throw new Error('La lecture ou votre choix financier a changé.');};
    try {
      const reread = await PurchaseRefundService.source(uid, source.transactionId, assertCurrent, true, purchaseRefundId(currentInput.disputeId.trim()) ? currentInput.disputeId.trim() : undefined); assertCurrent();
      if (!purchaseRefundEqual(reread, source)) throw new Error('La source, le restant ou les acceptations ont changé. Relisez-les explicitement.');
      let allocation: PurchaseRefundAllocation, context: PurchaseRefundPreviewContext, disputeId: string;
      if (currentForm.mode === 'resume') {
        const r = source.reservedRefund;
        if (!r || r.sourceQualification !== 'native_allocation_reservation' || r.fundsAppliedRecorded || ['failed', 'canceled', 'succeeded'].includes(r.state) || !r.basisHash || !r.cumulativeHash || r.allocation.agreement && (!r.bilateralAgreementVerified || !purchaseRefundEqual(r.bilateralAcceptance, r.allocation.agreement))) throw new Error('Cette intention exige un rapprochement ou une réparation distincte. Aucun nouveau remboursement ou retry n’est créé ici.');
        allocation = r.allocation;
        if (allocation.basisHash !== r.basisHash || allocation.cumulativeHash !== r.cumulativeHash) throw new Error('L’allocation d’origine ne correspond plus aux sources de sa propre réserve.');
        disputeId = r.expectedDisputeId;
        context = {decisionContext: r.contexts.productReview ? 'product_review' : r.contexts.returnToSender ? 'return_to_sender_cases' : r.contexts.transportReview ? 'transport_review' : 'purchase_refund_allocation',
          ...(r.contexts.productReview ? {productReview: r.contexts.productReview} : {}), ...(r.contexts.transportReview ? {transportReviewId: r.contexts.transportReview.reviewId} : {}), resume: {refundIntentId: r.refundIntentId, refundAttemptId: r.refundAttemptId}};
      } else if (currentForm.mode === 'convenience') {
        const native = source.convenienceReturnSource, financing = native?.effectiveFinancingTerms ?? native?.financingTerms, reference = native?.reference;
        const cardCents = enteredCents(currentForm.card), walletCents = enteredCents(currentForm.wallet);
        if (native?.qualification !== 'native_received_return' || !financing || !reference || !source.remaining || !source.basisHash || !source.cumulativeHash ||
            reference.proposalId !== currentInput.disputeId.trim() || cardCents === null || walletCents === null || cardCents + walletCents !== financing.netRefundCents ||
            source.remainingCardCents === null || cardCents > source.remainingCardCents || source.remainingWalletCents === null || walletCents > source.remainingWalletCents ||
            financing.grossArticleCents > source.remaining.articleCents || source.remainingSellerCents === null || financing.grossArticleCents > source.remainingSellerCents) throw new Error('La réception et le financement natifs doivent être qualifiés. Répartissez explicitement le net exact entre les moyens initiaux disponibles.');
        const refund = {articleCents: financing.grossArticleCents, buyerFeeCents: 0, shippingCents: 0, gstCents: 0, qstCents: 0};
        const retained = Object.fromEntries(PURCHASE_REFUND_COMPONENTS.map(k => [k, source.remaining![k] - refund[k]])) as typeof refund;
        const terms: PurchaseRefundTermsV2 = {protocol: 'purchase_refund_terms_v2', currency: 'CAD', settlementKind: purchaseRefundTotal(retained) === 0 ? 'full_remaining' : 'partial',
          refund, retained, cardCents, walletCents, sellerDebitCents: financing.grossArticleCents, platformArticleCostCents: 0,
          articleHandling: 'return_separately', caseHandling: 'settle_selected_case', paymentDeadline: {qualification: 'unknown', date: null},
          provenance: {kind: 'in_app', statement: null, evidenceReferences: []},
          returnLabelDeduction: {protocol: 'buyer_return_label_deduction_v1', financingTermsHash: reference.financingTermsHash, requestId: financing.requestId, amountCents: financing.returnLabelCostCents}};
        allocation = {protocol: 'purchase_refund_allocation_v2', terms, basisHash: source.basisHash, cumulativeHash: source.cumulativeHash, agreement: null, convenienceReturn: reference};
        disputeId = reference.proposalId; context = {decisionContext: 'purchase_refund_allocation'};
      } else {
        const terms = currentForm.mode === 'agreement' ? source.bilateralAgreementVerified && source.agreement && source.bilateralAcceptance ? source.agreement.terms : null : preparedTerms;
        if (!terms || terms.protocol !== 'purchase_refund_terms_v1' || !source.basisHash || !source.cumulativeHash || !currentForm.kind || currentForm.mode === 'agreement' && !currentForm.target) throw new Error('Les termes, la cible et le contexte natif doivent être choisis explicitement.');
        disputeId = currentForm.mode === 'agreement' && currentForm.target === 'agreement' ? source.bilateralAcceptance!.agreementId : currentInput.disputeId.trim();
        if (!purchaseRefundId(disputeId)) throw new Error('Une cible native exacte est requise.');
        const product = ['authenticity', 'nonconformity', 'parcel_delivery'].includes(currentForm.kind), review = source.returnReviewSource;
        context = {decisionContext: product ? 'product_review' : currentForm.kind === 'pure' ? 'purchase_refund_allocation' : currentForm.kind as 'return_to_sender_cases' | 'transport_review', ...(currentForm.kind === 'transport_review' ? {transportReviewId: currentForm.transportReviewId.trim()} : {})};
        if (product) {
          const native = review?.qualification === 'native_current_documentary_source' ? review.productReview : null;
          if (native && native.topic !== currentForm.kind) throw new Error('Le sujet choisi diffère du dossier documentaire natif.');
          if (native) context.productReview = native;
        }
        allocation = {protocol: 'purchase_refund_allocation_v1', terms, basisHash: source.basisHash, cumulativeHash: source.cumulativeHash, agreement: currentForm.mode === 'agreement' ? source.bilateralAcceptance : null};
        if (currentForm.mode === 'agreement' && currentForm.target === 'agreement' && product) {if (!purchaseRefundId(currentInput.disputeId.trim())) throw new Error('La réclamation produit examinée doit rester explicitement identifiée.'); allocation.reviewedDisputeId = currentInput.disputeId.trim();}
        if (source.returnContext.qualification !== 'not_applicable') {
          const p = context.productReview, r = source.returnContext;
          if (r.qualification !== 'native_committed_return' || !r.requestId || !r.sourceHash || !p || !review || !purchaseRefundEqual(review.returnContext, r) || !currentForm.arrival || !currentForm.motivation.trim()) throw new Error('Le retour et le corpus natifs courants exigent une appréciation motivée explicite. Aucun constat de réception n’est inféré.');
          allocation.returnDisposition = {protocol: 'purchase_return_financial_review_v1', requestId: r.requestId, sourceHash: r.sourceHash, caseId: p.caseId, issueId: p.issueId, issueHash: p.issueHash, membersHash: p.membersHash, authorizationSourceHash: p.authorizationSourceHash, arrivalAssessment: currentForm.arrival, motivation: currentForm.motivation.trim(), financialTreatment: 'settle_return_commercially', physicalContentsVerified: false, faultEstablished: false, costDecisionGranted: false};
        }
      }
      if (!isPurchaseRefundAllocation(allocation)) throw new Error('L’allocation complète doit être qualifiée.');
      const p = context.productReview, kind = currentForm.kind;
      const productCaseId = context.decisionContext === 'product_review' ? p?.caseId ?? await productFinancialCaseId(source.transactionId) : undefined; assertCurrent();
      const topic = p?.topic ?? (kind === 'nonconformity' || kind === 'parcel_delivery' ? kind : 'authenticity');
      const preview = await TransactionService.previewAdminFinancialDecision(source.transactionId, disputeId, uid, allocation.terms.settlementKind === 'retain_remaining' ? 'dismissed' : 'refund_without_return', assertCurrent, context.decisionContext, context.resume, context.transportReviewId, productCaseId, topic,
        context.decisionContext === 'product_review' && (p ? !!p.materialCapability : material), context.decisionContext === 'product_review' && (p ? !!p.parcelCapability : parcel), allocation); assertCurrent();
      if (p && !purchaseRefundEqual(preview.productReview, p)) throw new Error('La référence documentaire examinée a changé.');
      setDraft({key: sourceKey, requestId: randomUUID(), preview, context, note: '', current: !preview.productReview, opened: !preview.productReview, examined: false, reauthenticated: false, accepted: false});
    } catch (e) {if (frame.isCurrent(op) && live.current.key === sourceKey && interactions.current === interaction) setNotice({key, text: e instanceof Error ? e.message : 'L’aperçu doit être qualifié.'});}
    finally {frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const updateDraft = (patch: Partial<Draft>) => {if (current) {try {frame.capture(); interactions.current++; setDraft(old => old?.key === sourceKey && old.requestId === current.requestId ? {...old, ...patch, key: sourceKey} : old);} catch { /* Old activity grants no financial confirmation. */ }}};
  const submit = async () => {
    if (!current || !current.current || !current.opened || !current.examined || !current.reauthenticated || !current.accepted || !current.note.trim() || lock.current || !canRead) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return; const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    const interaction = interactions.current;
    const assertCurrent = () => {frame.assertCurrent(op); if (live.current.key !== sourceKey || interactions.current !== interaction) throw new Error('La lecture ou votre choix financier a changé.');};
    try {
      const p = current.preview, product = p.productReview;
      const fresh = await TransactionService.previewAdminFinancialDecision(p.transactionId, p.expectedDisputeId, uid, p.decisionType, assertCurrent, p.decisionContext, p.resume, p.transportReview?.review.reviewId, product?.caseId, product?.topic ?? 'authenticity', !!product?.materialCapability, !!product?.parcelCapability, p.allocation); assertCurrent();
      if (!purchaseRefundEqual(fresh, p)) throw new Error('L’aperçu natif a changé avant cette instruction.');
      if (p.decisionType === 'dismissed') {
        const a: DisputeResolutionAttempt = {version: 1, adminUid: uid, transactionId: p.transactionId, disputeId: p.expectedDisputeId, requestId: current.requestId, note: current.note.trim(), previewId: p.previewId, expectedSourceHash: p.sourceHash, previewMonetaryContext: p.monetaryContext, expectedSettledRefundIntentId: p.refundIntentId ?? null, allocation: p.allocation!, ...(product ? {productReview: product} : {})};
        const receipt = await TransactionService.resolveDispute(a, assertCurrent, 'confirm'); assertCurrent();
        setNotice({key, text: receipt.outcome === 'dismissed' ? 'La résolution motivée de ce seul dossier est enregistrée. Aucun remboursement nul ni constat physique n’a été créé.' : 'La résolution n’est pas confirmée ; relisez la même intention dans le suivi propre.'});
      } else {
        const a: AdminFinancialAttempt = {version: 1, adminUid: uid, transactionId: p.transactionId, disputeId: p.expectedDisputeId, requestId: current.requestId, note: current.note.trim(), previewId: p.previewId, expectedSourceHash: p.sourceHash, expectedTotalCents: p.totalCents, expectedCardCents: p.cardCents, expectedWalletCents: p.walletCents, expectedSellerDebitCents: p.sellerDebitCents, decisionType: 'refund_without_return', allocation: p.allocation!, ...(product ? {productReview: product} : {}), ...(p.returnToSender ? {returnToSender: adminReturnToSenderFinancialReference(p.returnToSender, current.note.trim())} : {}), ...(p.transportReview ? {transportReview: adminTransportFinancialReference(p.transportReview, current.note.trim())} : {}), ...(p.resume ? {resume: p.resume} : {})};
        const receipt = await TransactionService.adminRefundTransaction(a, assertCurrent, 'confirm'); assertCurrent();
        setNotice({key, text: receipt.outcome === 'reserved' ? receipt.financial.success ? 'Le règlement de cette allocation est vérifié par son reçu financier natif. L’arrivée bancaire reste non vérifiée.' : 'Cette allocation est réservée. Le règlement de la même intention reste à suivre ; aucun deuxième remboursement n’est proposé.' : 'Cette intention n’a pas de règlement confirmé ; relisez son reçu propre.'});
      }
      setDraft(null); await journal.refetch(); assertCurrent(); onRecorded();
    } catch (e) {if (frame.isCurrent(op)) {if (live.current.key === sourceKey && interactions.current === interaction) {setDraft(null); setNotice({key, text: `${e instanceof Error ? e.message : 'Résultat inconnu.'} Le journal exact reste conservé avant tout nouvel envoi ; relisez son reçu.`}); onRecorded();} void journal.refetch();}}
    finally {frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const submitIncident = async () => {
    if (!incident?.source || !activeIncidentForm?.accepted || !activeIncidentForm.reauthenticated || !activeIncidentForm.note.trim() || lock.current || blocked.includes(incident.transactionId)) return;
    const selected = activeIncidentForm;
    if (selected.action === 'close_unfurnished_return' ? !incident.canClose || !selected.basis || selected.basis === 'operator_platform_risk_assumption' && !selected.risk : !incident.canAdopt || !incident.variance || !selected.risk) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return; const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    const revision = incidentInteraction.current, current = () => {frame.assertCurrent(op); const state = client.getQueryState(incidentQueryKey);
      if (incidentInteraction.current !== revision || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== incidentQuery.data || state.dataUpdatedAt !== incidentQuery.dataUpdatedAt) throw new Error('L’aperçu de l’incident ou votre choix a changé.');};
    try {
      current(); const command = buildConvenienceReturnIncidentCommand(incident, {action: selected.action, basis: selected.basis,
        platformRiskAccepted: selected.risk, note: selected.note});
      const attempt: ConvenienceReturnIncidentAttempt = {version: 1, uid, transactionId: incident.transactionId, requestId: randomUUID(), capability: CONVENIENCE_RETURN_INCIDENT_CAPABILITY, scope: 'operator', command, payloadHash: await productReviewHash(command)}; current();
      const receipt = await ConvenienceReturnJournal.executeIncident(attempt, current, async () => {const fresh = await ConvenienceReturnService.incidentPreview(uid, incident.transactionId, 'operator', current); current(); if (!productReviewEqual(fresh, incident)) throw new Error('L’aperçu natif a changé ; cette intention reste à relire.');}); current();
      setIncidentResult({key, receipt}); setIncidentForm(null); setNotice({key, text: receipt.state === 'committed' ? 'L’instruction d’incident est enregistrée. Aucun remboursement ni nouveau mouvement de fonds n’est exécuté par elle.' : 'Le résultat de cette même instruction doit être relu dans votre journal ; aucun nouvel envoi automatique.'}); onRecorded();
    } catch (e) {if (frame.isCurrent(op)) {setIncidentForm(null); setNotice({key, text: `${e instanceof Error ? e.message : 'Résultat inconnu.'} Votre intention exacte reste dans le journal, sans renvoi automatique.`});}}
    finally {if (frame.isCurrent(op)) {void journal.refetch(); void incidentQuery.refetch(); void sourceQuery.refetch();} frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  if (disabled) return showHistory ? <AdminPurchaseRefundHistory uid={uid} refreshKey={journal.dataUpdatedAt} /> : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Remboursement intégral du restant, partiel ou accord déclaré</Text><Text style={styles.caption}>Les cinq composantes, les rails et la prise en charge concernent cette seule commande. Aucune répartition au prorata, faute, indemnisation, réception ou remise en vente n’est déduite.</Text>
    <TextInput accessibilityLabel="Commande du remboursement restant" value={currentInput.transactionId} editable={!disabled && frame.focused && busy !== key} style={styles.input} placeholder="Référence exacte de la commande" placeholderTextColor={colors.muted} autoCapitalize="none" onChangeText={transactionId => {try {frame.capture(); interactions.current++; setInput({...currentInput, transactionId}); setDraft(null); setForm(null);} catch { /* No stale selection. */ }}} />
    <TextInput accessibilityLabel="Cible native de la décision" value={currentInput.disputeId} editable={!disabled && frame.focused && busy !== key} style={styles.input} placeholder="Réclamation native ou accord de retour cr_…" placeholderTextColor={colors.muted} autoCapitalize="none" onChangeText={disputeId => {try {frame.capture(); interactions.current++; setInput({...currentInput, disputeId}); setDraft(null); setForm(null);} catch { /* No stale selection. */ }}} />
    <Button variant="secondary" disabled={disabled || !frame.focused || sourceQuery.isFetching} onPress={() => {try {frame.capture(); interactions.current++; setForm(null); setDraft(null); setTerms(null); void sourceQuery.refetch();} catch { /* Current activity is required. */ }}}>Relire les sources monétaires natives</Button>
    <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Incident de préparation du retour</Text>
      <Button variant="secondary" disabled={disabled || !frame.focused || busy === key || incidentQuery.isFetching} onPress={() => {try {frame.capture(); incidentInteraction.current++; setIncidentForm(null); void incidentQuery.refetch();} catch { /* No stale incident read. */ }}}>Relire l’incident natif de cette commande</Button>
      {incidentQuery.isError ? <Text style={styles.caption}>L’incident ne peut pas être qualifié. Les propres intentions restent consultables dans le journal, même après perte du rôle.</Text> : null}
      {incident ? <><Text style={styles.caption}>État natif : {incident.state}. Aucune absence d’achat, faute, restitution ou possession n’est déduite d’un résultat inconnu.</Text>
        {incident.terminal ? <Text selectable style={styles.caption}>Clôture {incident.terminal.terminalId} · retour {incident.terminal.returnRequestId}. {incident.terminal.providerOutcome === 'purchased_unfurnished' ? 'L’acquisition est prouvée, le document non fourni ; Seconde assume le coût de cette étiquette.' : incident.terminal.providerOutcome === 'unknown' ? 'Le résultat fournisseur reste inconnu et Seconde assume le risque du coût éventuel.' : 'La qualification de clôture appartient à ce seul reçu.'}</Text> : null}
        {incident.variance ? <Text style={styles.caption}>Prix article G : {formatCents(incident.variance.grossArticleCents)} · plafond accepté : {formatCents(incident.variance.acceptedCostCents)} · coût réel qualifié : {formatCents(incident.variance.actualCostCents)} · déduction effective : {formatCents(incident.variance.deductionCents)} · net acheteur : {formatCents(incident.variance.netRefundCents)} · débit vendeur : {formatCents(incident.variance.grossArticleCents)} · écart Seconde : {formatCents(incident.variance.platformVarianceCents)}. L’adoption reste distincte du remboursement ; aucun supplément utilisateur n’est autorisé.</Text> : null}
        <Button variant="secondary" disabled={!incident.canClose || blocked.includes(incident.transactionId) || busy === key} onPress={() => selectIncident('close_unfurnished_return')}>Préparer la clôture sans nouvelle étiquette</Button>
        <Button variant="secondary" disabled={!incident.canAdopt || blocked.includes(incident.transactionId) || busy === key} onPress={() => selectIncident('adopt_label_cost_variance')}>Examiner l’adoption du coût réel</Button>
      </> : null}
      {activeIncidentForm ? <>
        {activeIncidentForm.action === 'close_unfurnished_return' ? <>
          {([['native_before_purchase', 'Clôture native avant achat', incident?.closeBasis.nativeBeforePurchase], ['native_post_validation_rejected', 'Clôture du seul rejet de validation prouvé', incident?.closeBasis.nativePostValidationRejected], ['operator_platform_risk_assumption', 'Seconde assume la charge ou le risque de l’étiquette', incident?.closeBasis.operatorPlatformRiskAssumption]] as const).map(([basis, label, permitted]) => <Button key={basis} variant={activeIncidentForm.basis === basis ? 'primary' : 'secondary'} disabled={!permitted || busy === key} onPress={() => changeIncident({basis, risk: false})}>{label}</Button>)}
          {activeIncidentForm.basis === 'operator_platform_risk_assumption' ? <Checkbox checked={activeIncidentForm.risk} disabled={busy === key} onToggle={() => changeIncident({risk: !activeIncidentForm.risk})}><Text style={styles.caption}>Seconde prend en charge le coût de l’étiquette si son acquisition est prouvée et son risque financier tant que le résultat fournisseur reste inconnu. Je n’atteste aucune absence d’achat.</Text></Checkbox> : null}
        </> : null}
        {activeIncidentForm.action === 'adopt_label_cost_variance' && incident?.variance ? <Checkbox checked={activeIncidentForm.risk} disabled={busy === key} onToggle={() => changeIncident({risk: !activeIncidentForm.risk})}><Text style={styles.caption}>Je confirme la prise en charge par Seconde de l’écart de coût affiché ({formatCents(incident.variance.platformVarianceCents)}). La déduction de l’acheteur reste plafonnée au coût accepté ; aucun supplément n’est imposé à l’acheteur ou au vendeur.</Text></Checkbox> : null}
        <TextInput accessibilityLabel="Motivation de l’instruction d’incident" value={activeIncidentForm.note} multiline maxLength={2000} editable={busy !== key} style={styles.input} placeholder="Motivation obligatoire de cette seule instruction" placeholderTextColor={colors.muted} onChangeText={note => changeIncident({note})} />
        <AdminFinancialReauthentication uid={uid} sourceKey={JSON.stringify([incidentKey, activeIncidentForm.action, activeIncidentForm.basis, activeIncidentForm.risk, activeIncidentForm.note])} purpose="commercial" parcel disabled={busy === key || !activeIncidentForm.note.trim()} onVerified={() => changeIncident({reauthenticated: true})} />
        <Checkbox checked={activeIncidentForm.accepted} disabled={busy === key || !activeIncidentForm.reauthenticated || !activeIncidentForm.note.trim() || (activeIncidentForm.action === 'adopt_label_cost_variance' || activeIncidentForm.basis === 'operator_platform_risk_assumption') && !activeIncidentForm.risk || activeIncidentForm.action === 'close_unfurnished_return' && !activeIncidentForm.basis} onToggle={() => changeIncident({accepted: !activeIncidentForm.accepted, reauthenticated: activeIncidentForm.reauthenticated})}><Text style={styles.caption}>Je confirme cette instruction exacte et sa qualification. Elle ne crée aucun remboursement, nouveau paiement, étiquette supplémentaire ou remise en vente.</Text></Checkbox>
        <Button disabled={busy === key || !activeIncidentForm.accepted || !activeIncidentForm.reauthenticated || (activeIncidentForm.action === 'adopt_label_cost_variance' || activeIncidentForm.basis === 'operator_platform_risk_assumption') && !activeIncidentForm.risk || activeIncidentForm.action === 'close_unfurnished_return' && !activeIncidentForm.basis} onPress={() => void submitIncident()}>Enregistrer cette seule instruction d’incident</Button>
      </> : null}
      {incidentResult?.key === key ? <Text selectable style={styles.caption}>Reçu {incidentResult.receipt.requestId} · {incidentResult.receipt.state}. Le journal conserve la référence exacte jusqu’à acquittement après une nouvelle lecture.</Text> : null}
    </View>
    {sourceQuery.isError || journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les sources ou les journaux ne sont pas qualifiés. Aucun nouveau mouvement n’est permis ; vos reçus propres restent disponibles.</Text> : null}
    {source ? <><PurchaseRefundTermsSummary source={source} />
      <Button variant="secondary" disabled={!canNew} onPress={() => choose('operator')}>Préparer une instruction opérateur distincte</Button>
      <Button variant="secondary" disabled={!canNew || !source.bilateralAgreementVerified} onPress={() => choose('agreement')}>Examiner les deux acceptations natives actuelles</Button>
      {source.convenienceReturnSource ? <><Text style={styles.caption}>Retour pour changement d’avis : {source.convenienceReturnSource.qualification === 'native_received_return' ? 'déclaration vendeur et financement natifs qualifiés pour cette lecture' : 'réception ou financement à rapprocher'}. Le scan du transporteur ne remplace pas la déclaration du vendeur et aucune somme n’est exécutée par cette lecture.</Text><Button variant="secondary" disabled={!canNew || source.convenienceReturnSource.qualification !== 'native_received_return'} onPress={() => choose('convenience')}>Préparer l’instruction du retour avec frais déduits</Button></> : null}
      <Button variant="secondary" disabled={!canRead || !source.reservedRefund} onPress={() => choose('resume')}>Examiner la reprise de l’allocation d’origine</Button>
      {currentForm?.mode === 'operator' ? <PurchaseRefundTermsForm source={source} sourceKey={sourceKey} enabled={canRead} operator assertCurrent={() => {frame.capture();}} onPrepared={onPrepared} /> : null}
      {currentForm?.mode === 'agreement' && source.agreement ? <><PurchaseRefundTermsSummary source={source} terms={source.agreement.terms} /><Text style={styles.caption}>Seule la preuve des deux UID natifs qualifie l’accord actuel. Choisissez sa cible ; la conservation sans remboursement exige une vraie réclamation.</Text>
        <Button variant={currentForm.target === 'claim' ? 'primary' : 'secondary'} onPress={() => change({target: 'claim'})}>Régler la réclamation sélectionnée</Button>
        <Button variant={currentForm.target === 'agreement' ? 'primary' : 'secondary'} disabled={source.agreement.terms.settlementKind === 'retain_remaining'} onPress={() => change({target: 'agreement'})}>Examiner cet accord pour une nouvelle tranche du restant</Button></> : null}
      {currentForm?.mode === 'resume' && source.reservedRefund ? <><PurchaseRefundTermsSummary terms={source.reservedRefund.terms} /><Text selectable style={styles.caption}>Intention {source.reservedRefund.refundIntentId} · tentative {source.reservedRefund.refundAttemptId} · autorisation {source.reservedRefund.authorizationDecisionId}. Montants, allocation native et clé d’origine conservés ; aucun retry terminal n’est créé.</Text></> : null}
      {currentForm?.mode === 'convenience' && source.convenienceReturnSource?.financingTerms ? <>
        <Text style={styles.caption}>Prix article : {formatCents(source.convenienceReturnSource.financingTerms.grossArticleCents)} · plafond de frais accepté : {formatCents(source.convenienceReturnSource.financingTerms.returnLabelCostCents)} · déduction effective : {formatCents((source.convenienceReturnSource.effectiveFinancingTerms ?? source.convenienceReturnSource.financingTerms).returnLabelCostCents)} · net acheteur : {formatCents((source.convenienceReturnSource.effectiveFinancingTerms ?? source.convenienceReturnSource.financingTerms).netRefundCents)} · débit vendeur : {formatCents(source.convenienceReturnSource.financingTerms.grossArticleCents)}.</Text>
        {source.convenienceReturnSource.costResolution ? <Text style={styles.caption}>Coût réel qualifié : {formatCents(source.convenienceReturnSource.costResolution.actualCostCents)} · écart pris en charge par Seconde : {formatCents(source.convenienceReturnSource.costResolution.platformVarianceCents)}. Aucun supplément n’est débité à l’acheteur ou au vendeur.</Text> : null}
        <Text style={styles.caption}>Saisissez explicitement les deux parts du net sur les moyens de paiement initiaux, y compris zéro. Aucun prorata ou moyen de remplacement n’est choisi automatiquement.</Text>
        <TextInput accessibilityLabel="Part nette vers la carte d’origine en CAD" value={currentForm.card} style={styles.input} keyboardType="decimal-pad" placeholder="Part nette carte d’origine (CAD)" placeholderTextColor={colors.muted} onChangeText={card => change({card})} />
        <TextInput accessibilityLabel="Part nette vers le solde acheteur en CAD" value={currentForm.wallet} style={styles.input} keyboardType="decimal-pad" placeholder="Part nette solde acheteur (CAD)" placeholderTextColor={colors.muted} onChangeText={wallet => change({wallet})} />
      </> : null}
      {currentForm && currentForm.mode !== 'resume' && currentForm.mode !== 'convenience' ? <><Text style={styles.caption}>Choisir le contexte natif de l’examen financier</Text>
        {([['pure', 'Accord ou réclamation sans dossier produit'], ['authenticity', 'Dossier d’authenticité'], ...(material ? [['nonconformity', 'Dossier de comparaison matérielle']] : []), ...(parcel ? [['parcel_delivery', 'Dossier de colis']] : []), ['return_to_sender_cases', 'Dossiers de retour à l’expéditeur'], ['transport_review', 'Enquête de transport']] as [Kind, string][]).map(([kind, label]) => <Button key={kind} variant={currentForm.kind === kind ? 'primary' : 'secondary'} onPress={() => change({kind})}>{label}</Button>)}
        {currentForm.kind === 'transport_review' ? <TextInput accessibilityLabel="Enquête transport native" value={currentForm.transportReviewId} style={styles.input} placeholder="Référence case_… native" placeholderTextColor={colors.muted} autoCapitalize="none" onChangeText={transportReviewId => change({transportReviewId})} /> : null}
        {source.returnContext.qualification !== 'not_applicable' ? <><Text style={styles.caption}>Retour : {source.returnContext.qualification}. Un règlement commercial exige le retour et l’issue documentaire natifs actuels ; il ne crée aucun scan, constat de réception ou responsabilité.</Text>
          {(['not_arrived_declared', 'unknown'] as const).map(arrival => <Button key={arrival} variant={currentForm.arrival === arrival ? 'primary' : 'secondary'} onPress={() => change({arrival})}>{arrival === 'not_arrived_declared' ? 'Non-arrivée déclarée, non certifiée' : 'Arrivée inconnue'}</Button>)}
          <TextInput accessibilityLabel="Motivation de l’examen financier du retour" value={currentForm.motivation} multiline maxLength={2000} style={styles.input} placeholder="Motivation du traitement commercial de ce retour exact" placeholderTextColor={colors.muted} onChangeText={motivation => change({motivation})} />
          <Text selectable style={styles.caption}>Retour {source.returnContext.requestId ?? 'inconnu'} · issue {source.returnReviewSource?.productReview?.issueId ?? 'non qualifiée'}. Aucune donnée privée ou adresse n’est reconstituée.</Text></> : null}</> : null}
      {currentForm ? <Button disabled={!canRead || busy === key} onPress={() => {void open();}}>Qualifier l’aperçu financier exact de ce choix</Button> : null}</> : null}
    {current ? <><PurchaseRefundTermsSummary source={source} terms={current.preview.allocation!.terms} />
      <Text selectable style={styles.caption}>Acheteur {current.preview.buyerId} · vendeur {current.preview.sellerId} · cible {current.preview.expectedDisputeId}. Autres dossiers : {current.preview.remainingOpenDisputeIds.join(', ') || 'aucun'} · obligations retenues : {current.preview.retainedObligations.join(', ') || 'aucune'}.</Text>
      {current.preview.productReview ? <AdminProductFinancialReview uid={uid} preview={current.preview} enabled={busy !== key} onCurrentReadChange={onRead} /> : null}
      {current.preview.returnToSender ? <AdminReturnToSenderFinancialReview source={current.preview.returnToSender} allocation={current.preview.allocation} /> : null}
      {current.preview.transportReview ? <AdminTransportFinancialReview source={current.preview.transportReview} allocation={current.preview.allocation} /> : null}
      <TextInput accessibilityLabel="Motivation de cette seule décision financière" value={current.note} editable={busy !== key} multiline maxLength={500} style={styles.input} placeholder="Motivation obligatoire (500 caractères maximum)" placeholderTextColor={colors.muted} onChangeText={note => updateDraft({note, examined: false, accepted: false})} />
      <Checkbox checked={current.examined} disabled={!current.current || !current.opened || !current.note.trim() || busy === key} onToggle={() => updateDraft({examined: !current.examined, accepted: false})}><Text style={styles.caption}>J’ai examiné ces termes, ce restant, les sources et pièces requises, ces parties et cette seule cible. Les autres obligations restent distinctes.</Text></Checkbox>
      <AdminFinancialReauthentication uid={uid} sourceKey={current.preview.previewId} disabled={busy === key} parcel onVerified={() => updateDraft({reauthenticated: true, accepted: false})} />
      <Checkbox checked={current.accepted} disabled={!current.examined || !current.reauthenticated || busy === key} onToggle={() => updateDraft({accepted: !current.accepted})}><Text style={styles.caption}>Je confirme cette allocation exacte, ses rails, son débit vendeur, son coût plateforme et cette motivation, sans permission physique ou de stock.</Text></Checkbox>
      <Button disabled={!current.accepted || !current.examined || !current.reauthenticated || !current.opened || !current.current || busy === key} onPress={() => {void submit();}}>{current.preview.decisionType === 'dismissed' ? 'Enregistrer cette résolution sans remboursement' : 'Enregistrer cette seule instruction financière'}</Button>
      <Button variant="ghost" disabled={busy === key} onPress={() => {try {frame.capture(); interactions.current++; setDraft(null);} catch { /* A stale reading cannot change the current choice. */ }}}>Fermer cet aperçu</Button></> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    {showHistory ? <AdminPurchaseRefundHistory uid={uid} refreshKey={journal.dataUpdatedAt} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
