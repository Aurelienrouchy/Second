import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import { Button, Checkbox } from '@/components/ui';
import { ProductReviewCommandPanel } from '@/components/ProductReviewCommandPanel';
import { ProductCommercialReturnContestPanel } from '@/components/ProductCommercialReturnContestPanel';
import { ProductCommercialReturnService } from '@/services/productCommercialReturnService';
import { ProductReviewJournal } from '@/services/productReviewJournal';
import { TransactionService } from '@/services/transactionService';
import { productReviewEqual } from '@/services/productReviewService';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { PRODUCT_COMMERCIAL_RETURN_ACTIONS, PRODUCT_COMMERCIAL_RETURN_LABELS } from '@/utils/productCommercialReturnContract';
import { formatPrice } from '@/utils/formatPrice';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { ProductCommercialReturnCommand } from '@/types/productCommercialReturn';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { ProductReviewCursor, ProductReviewScope } from '@/types/productReview';
import type { ReturnRequestReason } from '@/types/transaction';
export interface ProductCommercialReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; parcel?: boolean}
interface Form {key: string; action: ProductCommercialReturnCommand['action'] | null; privateNote: string; partyMessage: string; acknowledged: boolean}
const reasons: Record<ReturnRequestReason, string> = {not_as_described: 'Différence par rapport à la description', wrong_item: 'Article différent', damaged: 'Article endommagé', other: 'Autre motif déclaré'};
/** Commercial instruction, paid label and financial decision have distinct native receipts. */
export function ProductCommercialReturnPanel({uid, transactionId, scope, nativeAdmission, renderReauthentication, onRecorded}: {
  uid: string; transactionId: string; scope: ProductReviewScope; nativeAdmission: ProductPhysicalDocumentaryAdmission | null;
  renderReauthentication?: (props: ProductCommercialReauthenticationProps) => ReactNode; onRecorded?: () => void;
}) {
  const documentary = nativeAdmission?.uid === uid && nativeAdmission.context.id === transactionId && nativeAdmission.scope === scope && nativeAdmission.materialCapability === 'product_review_material_v1' ? nativeAdmission : null;
  const frame = useProductParcelContext(JSON.stringify(['product-commercial-return', transactionId, scope, documentary?.key ?? null]), uid,
    !nativeAdmission || nativeAdmission.parcelCapability === 'product_review_parcel_v1'), router = useRouter(), navigation = useNavigation(), client = useQueryClient();
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, scope, frame.focusRevision, documentary?.key ?? null]);
  const [reauthenticated, setReauthenticated] = useState<string | null>(null), [failed, setFailed] = useState<string | null>(null);
  const [formState, setForm] = useState<Form | null>(null), [reasonState, setReason] = useState<{key: string; reason: ReturnRequestReason} | null>(null);
  const [consent, setConsent] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null), [busy, setBusy] = useState<string | null>(null);
  const lock = useRef<symbol | null>(null), allowLeave = useRef<string | null>(null);
  const sourceRead = () => {const operation = frame.capture(), current = () => {frame.assertCurrent(operation); if (!documentary) throw new Error('La lecture documentaire doit être qualifiée.'); documentary.assertCurrent();}; current(); return {current};};
  const preview = useQuery({queryKey: ['product-commercial-return-preview', key], enabled: !!documentary && frame.focused && (scope === 'own' || reauthenticated === key), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const {current} = sourceRead(); const disputeId = await ProductCommercialReturnService.dispute(uid, transactionId, scope, current, documentary?.parcelCapability === 'product_review_parcel_v1'); current();
      if (!disputeId) return null; const value = await ProductCommercialReturnService.preview(uid, transactionId, disputeId, scope, current, documentary?.parcelCapability === 'product_review_parcel_v1'); current();
      if (value.sourceHash !== documentary!.sourceHash || value.corpusHash !== documentary!.corpusHash) throw new Error('Les sources documentaires ont changé.'); return value;}});
  const admitted = documentary && frame.focused && failed !== key && preview.isSuccess && !preview.isFetching && !preview.isError ? preview.data : null;
  const sourceKey = admitted ? JSON.stringify([key, admitted.sourceHash, admitted.source.readAt, admitted.semanticSourceHash, admitted.corpusHash, admitted.membersHash, admitted.previewId]) : '';
  const history = useInfiniteQuery({queryKey: ['product-commercial-return-history', sourceKey], enabled: !!admitted, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as ProductReviewCursor | null,
    queryFn: ({pageParam}) => {if (!admitted) throw new Error('Relisez l’instruction native.'); const {current} = sourceRead(); return ProductCommercialReturnService.page(uid, transactionId, scope, pageParam, admitted, current);}, getNextPageParam: page => page.nextCursor ?? undefined});
  const entries = history.data?.pages.flatMap(p => p.entries) ?? [], ids = entries.map(e => e.qualification === 'unknown' ? e.instructionId : e.instruction.instructionReference.instructionId);
  const current = admitted && history.isSuccess && !history.isFetching && !history.isError && new Set(ids).size === ids.length ? admitted : null;
  const form = formState?.key === sourceKey && sourceKey ? formState : {key: sourceKey, action: null, privateNote: '', partyMessage: '', acknowledged: false};
  const original = useQuery({queryKey: ['product-commercial-original-intent', uid, getAuthSessionGeneration(), transactionId, frame.focusRevision], enabled: scope === 'admin' && frame.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return ProductReviewJournal.pending(uid, {kind: 'order', id: transactionId}, () => frame.assertCurrent(op));}});
  const originalCommand = scope === 'admin' && frame.focused && original.isSuccess && !original.isFetching && !original.isError && original.data?.type === 'commercial_return' ? original.data.command : null;
  const canReexamine = !!current && !!originalCommand && current.previewId === originalCommand.previewId && current.returnRequestId === originalCommand.returnRequestId && current.sourceHash === originalCommand.sourceHash &&
    current.semanticSourceHash === originalCommand.semanticSourceHash && current.caseVersion === originalCommand.caseVersion && current.corpusHash === originalCommand.corpusHash && current.membersHash === originalCommand.membersHash &&
    productReviewEqual(current.contributionReferences, originalCommand.contributionReferences) && productReviewEqual(current.evidenceReferences, originalCommand.evidenceReferences) &&
    ((originalCommand.parcelCapability ?? null) === (current.parcelCapability ?? null) && (originalCommand.action !== 'instruct_return' || current.canInstruct && current.documentaryComplete));
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (allowLeave.current === key || scope !== 'admin' || !frame.focused || !current || !form.privateNote.trim() && !form.partyMessage.trim()) return;
    event.preventDefault(); Alert.alert('Quitter l’instruction préparée ?', 'Les textes non envoyés ne sont pas enregistrés. Une intention déjà soumise reste conservée séparément avec ses références exactes.',
      [{text: 'Rester', style: 'cancel'}, {text: 'Quitter', onPress: () => {try {frame.capture(); allowLeave.current = key; navigation.dispatch(event.data.action);} catch { /* A changed account cannot expose this draft. */ }}}]);
  }), [navigation, frame, key, scope, current, form.privateNote, form.partyMessage]);
  const change = (patch: Partial<Form>) => {if (current) {try {frame.capture(); setForm({...form, ...patch, acknowledged: false});} catch { /* An earlier activity epoch grants no draft. */ }}};
  const draft: ProductCommercialReturnCommand | null = scope === 'admin' && current?.previewId && current.caseVersion > 0 && form.action && form.acknowledged && form.privateNote.trim() && form.partyMessage.trim() &&
    (form.action !== 'instruct_return' || current.canInstruct && current.documentaryComplete) ? {transactionId, disputeId: current.disputeId, returnRequestId: current.returnRequestId, previewId: current.previewId,
    sourceHash: current.sourceHash, semanticSourceHash: current.semanticSourceHash, caseVersion: current.caseVersion, corpusHash: current.corpusHash, membersHash: current.membersHash,
    contributionReferences: current.contributionReferences, evidenceReferences: current.evidenceReferences, action: form.action, privateNote: form.privateNote.trim(), partyMessage: form.partyMessage.trim(), acknowledged: true, ...(documentary?.parcelCapability ? {parcelCapability: documentary.parcelCapability} : {})} : null;
  const refresh = () => {try {frame.capture(); setConsent(null); setForm(null); setFailed(null); if (scope === 'own' || reauthenticated === key) void preview.refetch();} catch { /* Private sources require current activity. */ }};
  const verify = async () => {
    if (!current || !documentary) throw new Error('Relisez les sources et les pièces privées.');
    const {current: fence} = sourceRead(); await documentary.revalidate(); fence();
    const fresh = await ProductCommercialReturnService.preview(uid, transactionId, current.disputeId, scope, fence, documentary?.parcelCapability === 'product_review_parcel_v1'); fence();
    if (fresh.sourceHash !== current.sourceHash || fresh.semanticSourceHash !== current.semanticSourceHash || fresh.corpusHash !== current.corpusHash || fresh.membersHash !== current.membersHash ||
      fresh.caseVersion !== current.caseVersion || fresh.previewId !== current.previewId || fresh.returnRequestId !== current.returnRequestId || !productReviewEqual(fresh.admission, current.admission) ||
      !productReviewEqual(fresh.contributionReferences, current.contributionReferences) || !productReviewEqual(fresh.evidenceReferences, current.evidenceReferences)) throw new Error('L’instruction ou les sources ont changé.');
    return fence;
  };
  // The private return journal remains readable when documentary admission fails.
  const returnQuery = useQuery({queryKey: ['product-commercial-owner-return', uid, getAuthSessionGeneration(), transactionId, frame.focusRevision], enabled: scope === 'own' && frame.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return TransactionService.readReturnRequest(transactionId, uid, () => frame.assertCurrent(op));}});
  const owner = scope === 'own' && frame.focused && returnQuery.isSuccess && !returnQuery.isFetching && !returnQuery.isError ? returnQuery.data : null;
  const buyer = owner?.transaction.buyerId === uid, result = owner?.result, quote = result?.quote;
  const quoteKey = current && owner && quote ? JSON.stringify([sourceKey, quote, owner.attempt, current.admission.reference]) : null;
  const selectedReason = reasonState?.key === sourceKey ? reasonState.reason : null;
  const admissionCurrentForReader = !!current?.admission.allowed && (!documentary?.parcelCapability || current.admission.basis?.parcelCapability === documentary.parcelCapability);
  const canPrepare = admissionCurrentForReader && !!current?.admission.reference && !!buyer && !owner?.attempt && !result && !!selectedReason;
  const canConfirm = admissionCurrentForReader && !!current?.admission.reference && !!buyer && !!quote && result?.status === 'quoted' && result.fundsFrozen && owner?.attempt?.phase !== 'confirm_submitted' &&
    owner?.transaction.status === (owner.transaction.returnRequest?.commercialReturnBasis?.commercialStatusAtInstruction ?? 'disputed') && !!owner.transaction.returnRequest?.commercialReturn;
  const performReturn = async (action: 'prepare' | 'confirm') => {
    if (lock.current || !current || !owner || action === 'prepare' && !canPrepare || action === 'confirm' && (!canConfirm || !quote || consent !== quoteKey)) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return; const token = Symbol(); lock.current = token; setBusy(key); setNotice(null); setConsent(null);
    try {const fence = await verify(), assertCurrent = () => {frame.assertCurrent(op); fence();}; assertCurrent();
      if (!admissionCurrentForReader || !current.admission.reference) throw new Error('L’instruction actuelle ne permet pas de préparer ce retour pour cette lecture explicite.');
      const receipt = action === 'prepare' ? await TransactionService.requestReturn(transactionId, selectedReason!, uid, assertCurrent, current.admission.reference, documentary?.parcelCapability === 'product_review_parcel_v1') : await TransactionService.confirmReturn(transactionId, quote!, uid, assertCurrent); assertCurrent();
      setNotice({key, text: receipt.labelCommitted ? 'L’étiquette est historiquement enregistrée. Relisez la permission native avant tout transport ; la réception, le contenu et le remboursement restent distincts.' :
        receipt.quote ? 'Le devis de cette même demande est prêt. Examinez son coût avant de confirmer l’étiquette.' : 'Le résultat de cette demande reste à vérifier avec la même identité.'});
      await returnQuery.refetch(); assertCurrent(); void client.invalidateQueries({queryKey: ['product-review-source']}); onRecorded?.();
    } catch (e) {if (frame.isCurrent(op)) {setFailed(key); setNotice({key, text: `${e instanceof Error ? e.message : 'Résultat inconnu.'} Relisez la même demande conservée ; aucune autre création n’est envoyée.`}); void returnQuery.refetch();}}
    finally {frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Instruction commerciale de retour</Text>
    <Text style={styles.caption}>L’examen du produit, l’admission physique du colis et la décision financière restent séparés. Une instruction historique ne qualifie pas la permission actuelle.</Text>
    {scope === 'admin' && documentary ? renderReauthentication?.({uid, sourceKey: key, disabled: !frame.focused || busy === key, parcel: documentary.parcelCapability === 'product_review_parcel_v1', onVerified: () => {try {frame.capture(); setReauthenticated(key); setForm(null); setFailed(null); void preview.refetch();} catch { /* Reauthentication from a prior activity grants no admission. */ }}}) : null}
    {documentary ? <Button variant="secondary" disabled={preview.isFetching || scope === 'admin' && reauthenticated !== key} onPress={refresh}>Relire l’instruction et ses sources actuelles</Button> : null}
    {preview.isError || history.isError || failed === key || !documentary ? <Text accessibilityRole="alert" style={styles.caption}>Les sources et les pièces ne qualifient pas une nouvelle instruction ou étiquette. Le suivi personnel de la demande reste consultable.</Text> : null}
    {preview.isSuccess && preview.data === null ? <Text style={styles.caption}>Aucune plainte matérielle native liée ne peut être qualifiée. Une déclaration personnelle doit être reliée explicitement au recours avant l’examen commercial.</Text> : null}
    {current ? <>
      <Text style={styles.caption}>{admissionCurrentForReader ? 'Une instruction commerciale actuelle est qualifiée pour ce dossier. L’étiquette et l’admission physique exigent leurs propres contrôles.' : 'Aucune instruction actuelle ne permet de créer une étiquette de retour dans cette lecture. Une instruction d’origine conservée reste historique ; une nouvelle lecture ne remplace pas sa version.'}</Text>
      {entries.map(e => <View key={e.qualification === 'unknown' ? e.instructionId : e.instruction.instructionReference.instructionId} style={styles.section}>{e.qualification === 'unknown' ? <Text style={styles.caption}>Une instruction historique ne peut pas être qualifiée.</Text> : <>
        <Text style={styles.body}>{PRODUCT_COMMERCIAL_RETURN_LABELS[e.instruction.action]} — {new Date(e.instruction.recordedAt).toLocaleString(APP_LOCALE)}.</Text><Text selectable style={styles.body}>{e.instruction.partyMessage}</Text>
        {scope === 'admin' ? <Text selectable style={styles.caption}>Motivation privée : {e.instruction.privateNote}</Text> : null}<Text style={styles.caption}>Ce reçu historique ne donne aucune permission actuelle.</Text></>}</View>)}
      {history.hasNextPage ? <Button variant="secondary" onPress={() => {void history.fetchNextPage();}}>Lire les instructions suivantes</Button> : null}
      {scope === 'admin' ? <>
        {originalCommand && canReexamine ? <Button variant="secondary" onPress={() => {try {frame.capture(); setForm({key: sourceKey, action: originalCommand.action, privateNote: originalCommand.privateNote, partyMessage: originalCommand.partyMessage, acknowledged: false});} catch { /* Original texts need a current private reading. */ }}}>Réexaminer les textes d’origine de mon intention conservée</Button> : originalCommand ? <Text style={styles.caption}>Les sources actuelles ne correspondent plus à l’intention conservée. Son reçu reste consultable ; aucune reprise avec de nouvelles sources n’est proposée.</Text> : null}
        <Text style={styles.caption}>Choisissez une issue pour ces sources, puis motivez le texte communiqué aux deux parties.</Text>
        {PRODUCT_COMMERCIAL_RETURN_ACTIONS.map(action => <Button key={action} variant={form.action === action ? 'primary' : 'secondary'} disabled={action === 'instruct_return' && (!current.canInstruct || !current.documentaryComplete)} onPress={() => change({action})}>{PRODUCT_COMMERCIAL_RETURN_LABELS[action]}</Button>)}
        <Text style={styles.caption}>Motivation privée obligatoire</Text><TextInput accessibilityLabel="Motivation privée de l’instruction commerciale" multiline maxLength={4000} style={styles.input} value={form.privateNote} onChangeText={privateNote => change({privateNote})} />
        <Text style={styles.caption}>Message communiqué à l’acheteur et au vendeur</Text><TextInput accessibilityLabel="Message aux parties sur le retour" multiline maxLength={4000} style={styles.input} value={form.partyMessage} onChangeText={partyMessage => change({partyMessage})} />
        <Checkbox checked={form.acknowledged} onToggle={() => {try {frame.capture(); setForm({...form, acknowledged: !form.acknowledged});} catch { /* Old activity grants no confirmation. */ }}}><Text style={styles.caption}>J’ai examiné les déclarations et les pièces de ce corpus exact. Je confirme l’issue et ces textes ; ils ne certifient pas une faute ni le contenu physique, et ne remboursent aucun montant.</Text></Checkbox>
      </> : null}
    </> : null}
    {scope === 'admin' ? <ProductReviewCommandPanel uid={uid} context={{kind: 'order', id: transactionId}} sourceKey={sourceKey} draft={draft ? {type: 'commercial_return', command: draft} : null} enabled={!!current && !!draft} material parcel={documentary?.parcelCapability === 'product_review_parcel_v1'} verifyNew={verify}
      onSourceError={() => setFailed(key)} onSubmitted={() => {void original.refetch();}} onRecorded={() => {refresh(); void client.invalidateQueries({queryKey: ['product-review-source']}); onRecorded?.();}} /> : <>
      <Text accessibilityRole="header" style={styles.title}>Demande et étiquette de cette commande</Text>
      <Button variant="secondary" disabled={!frame.focused || busy === key || returnQuery.isFetching} onPress={() => {try {frame.capture(); setConsent(null); void returnQuery.refetch();} catch { /* Old activity cannot relaunch a private read. */ }}}>Relire ma demande conservée</Button>
      {returnQuery.isError ? <Text accessibilityRole="alert" style={styles.caption}>La demande et son résultat ne peuvent pas être qualifiés. Toute création est suspendue.</Text> : null}
      {owner?.attempt ? <Text style={styles.caption}>La même intention de retour reste conservée. Une confirmation soumise n’est jamais envoyée une seconde fois après un résultat inconnu.</Text> : null}
      {current && buyer && !owner?.attempt && !result ? <>{(Object.keys(reasons) as ReturnRequestReason[]).map(reason => <Button key={reason} variant={selectedReason === reason ? 'primary' : 'secondary'} onPress={() => {try {frame.capture(); setReason({key: sourceKey, reason}); setConsent(null);} catch { /* Current activity is required for a new request. */ }}}>{reasons[reason]}</Button>)}
        <Button disabled={!canPrepare || busy === key} onPress={() => {void performReturn('prepare');}}>Demander le devis de ce retour instruit</Button></> : null}
      {owner && result?.quote ? <>
        <Text style={styles.body}>{result.quote.carrierName} · {result.quote.serviceName} · coût du devis {formatPrice(result.quote.costCents / 100)} CAD.</Text>
        <Text style={styles.caption}>Les mesures du colis sont déclarées. Le devis ne confirme ni sa réception ni une décision de remboursement. Les frais de retour restent distincts du paiement de la commande.</Text>
        {canConfirm ? <><Checkbox checked={consent === quoteKey} disabled={busy === key} onToggle={() => {try {frame.capture(); setConsent(consent === quoteKey ? null : quoteKey);} catch { /* An old quote display grants no consent. */ }}}><Text style={styles.caption}>J’accepte ce transporteur, ce service et ce coût exact pour créer une seule étiquette de cette demande.</Text></Checkbox>
          <Button disabled={consent !== quoteKey || busy === key} onPress={() => {void performReturn('confirm');}}>Confirmer ce devis exact</Button></> : null}
      </> : null}
      {result?.labelCommitted ? <><Text style={styles.body}>Étiquette enregistrée · coût {formatPrice(result.returnLabelCost!)} CAD · suivi {result.returnTrackingNumber}.</Text>
        <Text style={styles.caption}>{result.shippingPermissionGranted ? 'La lecture native actuelle autorise ce seul transport de retour.' : 'La permission actuelle d’expédier n’est pas qualifiée. Ne remettez pas ce colis au transporteur avant une nouvelle lecture autorisée.'}</Text>
        <Button variant="secondary" disabled={returnQuery.isFetching || !result.returnLabelUrl} onPress={() => {try {frame.capture(); if (result.returnLabelUrl) void Linking.openURL(result.returnLabelUrl);} catch { /* Stale document is hidden. */ }}}>Consulter le document historique de retour</Button></> : result ? <Text style={styles.caption}>Demande {result.status} · {result.fundsFrozen ? 'gel natif confirmé' : 'gel non qualifié dans cette lecture'}. La même demande reste à suivre.</Text> : null}
      <Button variant="secondary" onPress={() => {try {frame.capture(); router.push({pathname: '/settings/support', params: {transactionId}} as never);} catch { /* Destination requalifies the account. */ }}}>Demander un examen au support</Button>
    </>}
    {scope === 'own' && documentary?.parcelCapability === 'product_review_parcel_v1' ? <ProductCommercialReturnContestPanel uid={uid} transactionId={transactionId}
      instructions={current ? entries.flatMap(e => e.qualification === 'native_commercial_return_instruction' ? [e.instruction] : []) : []}
      seller={!!current?.source.actorRoles.includes('seller')} nativeAdmission={current ? documentary : null}
      onRecorded={() => {refresh(); void client.invalidateQueries({queryKey: ['product-review-source']}); onRecorded?.();}} /> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
