import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { ExceptionalRestitutionSummary } from '@/components/ExceptionalRestitutionSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ExceptionalRestitutionService as Service } from '@/services/exceptionalRestitutionService';
import { ExceptionalRestitutionJournal as Journal } from '@/services/exceptionalRestitutionJournal';
import type { ExceptionalRestitutionContext as Context, ExceptionalRestitutionAction as Action, ExceptionalRestitutionSource as Source,
  ExceptionalRestitutionPreview as Preview, ExceptionalRestitutionEvidencePurpose as Purpose, ExceptionalRestitutionFile as File,
  ExceptionalRestitutionEvidenceReference as Evidence, ExceptionalRestitutionCommand as Command, ExceptionalRestitutionEvidenceBody as EvidenceBody } from '@/types/exceptionalRestitution';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';

type Draft = {key: string; owner: typeof auth.currentUser; preview: Preview; requestId: string; note: string; message: string; identity: boolean; authority: boolean;
  executed: boolean; credit: boolean; neverExecuted: boolean; accepted: boolean; transferReference: string; executedDate: string};
type Media = {key: string; owner: typeof auth.currentUser; activityRevision: string; purpose: Purpose; file: File; bytes: Uint8Array};
type ReadProof = {readId: string; key: string; purpose: Purpose; evidence: Evidence; dataUrl: string; loaded: boolean; assertCurrent: () => void};
type NativeChallenge = {baseKey: string; key: string; action: Action; amountCents: number | null; basis: string;
  owner: typeof auth.currentUser; operation: ReturnType<ReturnType<typeof useShippingPurchaseContext>['capture']>; verified: boolean; media: Media | null};
const allowed = (s: Source, a: Action) => a === 'prepare' ? s.canPrepare : a === 'attest' ? s.canAttest : s.canVoid;
const fingerprint = (p: Preview) => JSON.stringify([p.action, p.previewId, p.source.sourceHash, p.source.sourceRevision, p.source.beneficiaryId, p.source.amountCents, p.source.maximumCents, p.source.instructionId, p.source.funding]);
// Documentary observations omit the provider GET. Only a current preview owns
// the financial hash; bind selection to its native context and local revision.
const nativeBasis = (s: Source) => JSON.stringify([s.caseId, s.sourceRevision, s.ownerId, s.beneficiaryId, s.maximumCents, s.funding, s.instructionId]);
const amount = (v: string): number | null => {if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(v)) return null; const [whole, decimal = ''] = v.replace(',', '.').split('.'); const value = Number(whole) * 100 + Number(decimal.padEnd(2, '0')); return Number.isSafeInteger(value) && value > 0 ? value : null;};
const proofNames: Record<Purpose, string> = {identity_destination: 'Identité du bénéficiaire natif et destination bancaire', harm_or_authority: 'Préjudice réel ou pouvoir de représentation vérifié', execution: 'Justificatif du virement réellement exécuté'};
/** One native financial workflow for withdrawal, wallet authority and compensation. */
export function AdminExceptionalRestitutionPanel({uid, context: caseContext, onRecorded, onOriginalRefundAllocation}: {
  uid: string; context: Context; onRecorded: () => void; onOriginalRefundAllocation?: (context: {transactionId: string; refundIntentId: string}) => void;
}) {
  const walletCompensation = caseContext.kind === 'refund_error' && caseContext.harm === 'seller_debt_compensation';
  const names = walletCompensation ? {...proofNames, identity_destination: 'Identité du vendeur et portefeuille natif à créditer', harm_or_authority: 'Dette historique de cette intention et droit au crédit compensatoire'} : proofNames;
  const contextId = JSON.stringify(caseContext), context = useLabelLifecycleContext(`exceptional:${contextId}`, uid);
  const picker = useShippingPurchaseContext(`exceptional-selection:${contextId}`, uid), client = useQueryClient();
  const generation = getAuthSessionGeneration(), baseKey = JSON.stringify([uid, contextId, generation, picker.focusRevision]);
  const sourceQuery = useQuery({queryKey: ['exceptional-restitution-source', baseKey, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), owner = auth.currentUser;
      const current = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion Firebase a changé.');};
      const source = await Service.source(uid, caseContext, 'admin', current); current(); return {source, owner};}});
  const sourceOwner = sourceQuery.data?.owner;
  const source = context.focused && sourceQuery.isSuccess && !sourceQuery.isFetching && !sourceQuery.isError && sourceOwner === auth.currentUser ? sourceQuery.data.source : null;
  const journal = useQuery({queryKey: ['exceptional-restitution-pending', uid, baseKey, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return Journal.read(uid, () => context.assertCurrent(op));}});
  const journalReady = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const [amountField, setAmountField] = useState<{baseKey: string; text: string} | null>(null), enteredAmount = amountField?.baseKey === baseKey ? amountField.text : '';
  const [selection, setSelection] = useState<{baseKey: string; action: Action; amountCents: number | null; sourceHash: string; sourceRevision: string} | null>(null);
  const action = selection?.baseKey === baseKey ? selection.action : null, selectedAmount = selection?.baseKey === baseKey ? selection.amountCents : null;
  const key = JSON.stringify([baseKey, action, selectedAmount, source?.sourceHash, source?.sourceRevision]);
  const verificationKey = JSON.stringify([key, context.focusRevision]), reauthenticationKey = JSON.stringify([baseKey, selection]);
  const [verified, setVerified] = useState<{key: string; owner: typeof auth.currentUser} | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [media, setMedia] = useState<Media | null>(null), [readProofs, setReadProofs] = useState<ReadProof[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{baseKey: string; text: string} | null>(null);
  const lock = useRef<symbol | null>(null), interaction = useRef(0), nativeChallenge = useRef<NativeChallenge | null>(null);
  const current = source && draft?.key === key && draft.owner === auth.currentUser ? draft : null;
  const blocked = !journalReady || journal.data.commands.some(v => v.reference.caseId === source?.caseId);
  const proofs = journalReady ? journal.data.evidence.filter(v => JSON.stringify(v.reference.context) === contextId) : [];
  const live = useRef({baseKey, key, context}); useLayoutEffect(() => {live.current = {baseKey, key, context};}, [baseKey, key, context]);
  useEffect(() => {const sub = AppState.addEventListener('change', state => {if (state !== 'active' && !nativeChallenge.current) media?.bytes.fill(0);}); return () => {sub.remove(); media?.bytes.fill(0);};}, [media, baseKey]);
  const verificationCurrent = verified?.key === verificationKey && verified.owner === auth.currentUser;
  const currentMedia = media?.key === key && media.owner === auth.currentUser && media.activityRevision === context.focusRevision ? media : null;
  const refresh = () => {void sourceQuery.refetch(); void journal.refetch(); void client.invalidateQueries({queryKey: ['exceptional-restitution-own', uid]});};
  const select = (value: Action) => {try {context.capture(); if (lock.current || !source) return; const selected = value === 'prepare' && caseContext.kind === 'refund_error' && !walletCompensation && enteredAmount ? amount(enteredAmount) : null;
    if (value === 'prepare' && !walletCompensation && enteredAmount && (selected === null || source.maximumCents === null || selected > source.maximumCents)) return;
    interaction.current++; setSelection({baseKey, action: value, amountCents: selected, sourceHash: source.sourceHash, sourceRevision: source.sourceRevision});
    setDraft(null); setVerified(null); setMedia(null); setReadProofs([]); setNotice(null);
  } catch { /* Documentary selection never grants authority. */ }};
  const edit = (patch: Partial<Draft>) => {if (!current || busy) return; try {context.capture(); interaction.current++; setDraft(old => old?.key === key ? {...old, ...patch, accepted: false} : old);} catch { /* Current active form only. */ }};
  const challengeStart = () => {if (!source || !action || nativeChallenge.current) return; const operation = picker.capture();
    nativeChallenge.current = {baseKey, key, action, amountCents: selectedAmount, basis: nativeBasis(source), owner: auth.currentUser, operation, verified: false, media: currentMedia};
    setVerified(null); setReadProofs([]);
  };
  const assertChallenge = (lease: NativeChallenge) => {picker.assertCurrent(lease.operation); if (nativeChallenge.current !== lease || live.current.baseKey !== lease.baseKey || auth.currentUser !== lease.owner) throw new Error('Le dossier ou la connexion a changé.');};
  const challengeVerified = () => {const lease = nativeChallenge.current; if (!lease) return; lease.verified = true;
    void (async () => {try {
      await new Promise<void>((resolve, reject) => {const check = () => {try {assertChallenge(lease); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      assertChallenge(lease); const active = live.current.context, op = active.capture(), guard = () => {assertChallenge(lease); active.assertCurrent(op);};
      const preview = await Service.preview(uid, caseContext, lease.action, lease.amountCents, guard); guard();
      if (nativeBasis(preview.source) !== lease.basis) throw new Error('Les sources natives ont changé.');
      await sourceQuery.refetch(); guard(); setVerified({key: JSON.stringify([lease.key, active.focusRevision]), owner: lease.owner});
      if (lease.media) setMedia(old => old && old === lease.media ? {...old, bytes: new Uint8Array(old.bytes), activityRevision: active.focusRevision} : old);
    } catch {try {assertChallenge(lease); setVerified(null); setNotice({baseKey, text: 'Relisez les sources actuelles avant de reprendre. Aucune instruction n’a été envoyée.'});} catch { /* A former session cannot adopt the new source. */ }}
    finally {if (nativeChallenge.current === lease) nativeChallenge.current = null;}})();
  };
  const challengeEnd = () => {const lease = nativeChallenge.current; if (!lease || lease.verified) return; try {assertChallenge(lease); const active = live.current.context; active.capture();
    if (lease.media) setMedia(old => old && old === lease.media ? {...old, bytes: new Uint8Array(old.bytes), activityRevision: active.focusRevision} : old);
  } catch {lease.media?.bytes.fill(0);} if (nativeChallenge.current === lease) nativeChallenge.current = null;};
  const run = async (work: (guard: () => void) => Promise<void>, form = true) => {
    if (lock.current || !context.focused || form && (!current || blocked || !verificationCurrent)) return;
    let op; try {op = context.start();} catch {return;} if (!op) return; const token = Symbol(), epoch = interaction.current; lock.current = token; setBusy(true); setNotice(null);
    const guard = () => {context.assertCurrent(op); if (auth.currentUser !== sourceOwner || live.current.key !== key || interaction.current !== epoch) throw new Error('La sélection ou la connexion Firebase a changé.');};
    try {await work(guard); guard();} catch {if (context.isCurrent(op) && live.current.key === key) setNotice({baseKey, text: 'Relisez la même référence dans votre suivi. Aucun paiement de remplacement ni nouvel envoi n’est déclenché.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} refresh();}
  };
  const prepare = () => run(async guard => {if (!source || !action || blocked || !verificationCurrent) return;
    const preview = await Service.preview(uid, caseContext, action, selectedAmount, guard); guard();
    if (nativeBasis(preview.source) !== nativeBasis(source) || !allowed(preview.source, action) || preview.source.funding === 'original_refund_allocation') throw new Error('Source ou autorité non qualifiée.');
    setDraft({key, owner: sourceOwner ?? null, preview, requestId: randomUUID(), note: '', message: '', identity: false, authority: false, executed: false, credit: false, neverExecuted: false, accepted: false, transferReference: '', executedDate: ''}); setMedia(null); setReadProofs([]);
  }, false);
  const pickImage = async (purpose: Purpose) => {
    if (walletCompensation && purpose === 'execution' || !current || lock.current || proofs.some(v => v.receipt.purpose === purpose || v.receipt.purpose === null)) return;
    let op; try {op = picker.start();} catch {return;} if (!op) return; const token = Symbol(), owner = auth.currentUser, selected = current; lock.current = token; setBusy(true);
    const guardPicker = () => {picker.assertCurrent(op); if (auth.currentUser !== owner || getAuthSessionGeneration() !== generation || live.current.baseKey !== baseKey) throw new Error('Sélection périmée.');};
    try {const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); guardPicker(); if (!permission.granted) throw new Error('Permission requise.');
      const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible}); guardPicker();
      if (result.canceled || !result.assets[0]) return;
      await new Promise<void>((resolve, reject) => {const check = () => {try {guardPicker(); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      const frame = live.current.context, fresh = frame.capture(), guard = () => {guardPicker(); frame.assertCurrent(fresh);};
      const prepared = await Service.prepareImage(uid, result.assets[0].uri, guard); guard(); const preview = await Service.preview(uid, caseContext, selected.preview.action, selectedAmount, guard); guard();
      if (fingerprint(preview) !== fingerprint(selected.preview)) {prepared.bytes.fill(0); throw new Error('Source modifiée.');}
      setMedia({key: selected.key, owner, activityRevision: frame.focusRevision, purpose, ...prepared}); setVerified(null);
      setNotice({baseKey, text: 'Image préparée uniquement en mémoire. Réauthentifiez-vous avant son dépôt privé.'});
    } catch {try {guardPicker(); setNotice({baseKey, text: 'La sélection ou les sources doivent être reprises. Aucun document n’a été envoyé.'});} catch { /* Old gallery results remain inert. */ }}
    finally {picker.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);}}
  };
  const upload = () => run(async guard => {if (!current || !currentMedia) return; const preview = await Service.preview(uid, caseContext, current.preview.action, selectedAmount, guard); guard();
    if (fingerprint(preview) !== fingerprint(current.preview)) throw new Error('Source modifiée.');
    const body: EvidenceBody = {context: caseContext, previewId: preview.previewId, sourceHash: preview.source.sourceHash, sourceRevision: preview.source.sourceRevision,
      purpose: currentMedia.purpose, instructionId: currentMedia.purpose === 'execution' ? preview.source.instructionId : null, file: currentMedia.file, bytes: currentMedia.bytes,
      execution: currentMedia.purpose === 'execution' ? {transferReference: current.transferReference, executedDate: current.executedDate} : null};
    const reference = await Service.evidenceReference(uid, randomUUID(), body, guard); guard();
    try {await Journal.sendEvidence(reference, body, guard); guard();} finally {currentMedia.bytes.fill(0); setMedia(old => old === currentMedia ? null : old); setDraft(old => old?.key === key ? {...old, transferReference: '', executedDate: '', accepted: false} : old);}
  });
  const proofReference = (purpose: Purpose): Evidence | null => {
    if (!current) return null; const s = current.preview.source;
    const native = purpose === 'identity_destination' ? s.identityEvidence : purpose === 'harm_or_authority' ? s.authorityEvidence : s.executionEvidence;
    return native ?? proofs.find(v => v.receipt.state === 'stored' && v.receipt.purpose === purpose && v.receipt.beneficiaryId === s.beneficiaryId && v.receipt.amountCents === s.amountCents)?.receipt.evidence ?? null;
  };
  const readProof = (purpose: Purpose) => run(async guard => {
    const evidence = proofReference(purpose); if (!current || !evidence) return;
    const op = context.capture(), owner = auth.currentUser, sessionGeneration = getAuthSessionGeneration();
    const pin = () => {context.assertCurrent(op); if (auth.currentUser !== owner || sessionGeneration !== getAuthSessionGeneration() || live.current.key !== key) throw new Error('La lecture privée a changé.');};
    const file = await Service.file(uid, caseContext, evidence, () => {guard(); pin();}); guard(); pin(); if (file.purpose !== purpose) throw new Error('Pièce différente.');
    setReadProofs(old => [...old.filter(p => p.key === verificationKey && p.purpose !== purpose), {readId: randomUUID(), key: verificationKey, purpose, evidence, dataUrl: file.dataUrl, loaded: false, assertCurrent: pin}]);
  });
  const visibleProofs = readProofs.filter(p => {try {p.assertCurrent(); return p.key === verificationKey;} catch {return false;}});
  const proofRead = (purpose: Purpose) => {const evidence = proofReference(purpose); return !!evidence && visibleProofs.some(p => p.loaded && p.purpose === purpose && JSON.stringify(p.evidence) === JSON.stringify(evidence));};
  const paintProof = (proof: ReadProof, loaded: boolean) => {try {proof.assertCurrent(); if (loaded) setReadProofs(old => old.map(p => p.readId === proof.readId ? {...p, loaded: true} : p)); else setReadProofs(old => old.filter(p => p.readId !== proof.readId));} catch {setReadProofs(old => old.filter(p => p.readId !== proof.readId));}};
  const submit = () => run(async guard => {if (!current || !current.identity || !current.authority || !current.accepted || !current.note.trim() || !current.message.trim() || walletCompensation && !current.credit ||
    !proofRead('identity_destination') || !proofRead('harm_or_authority') || current.preview.action === 'attest' && !walletCompensation && (!current.executed || !proofRead('execution')) || current.preview.action === 'void_never_executed' && !current.neverExecuted) return;
    for (const proof of visibleProofs) proof.assertCurrent();
    const preview = await Service.preview(uid, caseContext, current.preview.action, selectedAmount, guard); guard();
    if (fingerprint(preview) !== fingerprint(current.preview) || !allowed(preview.source, preview.action) || !preview.source.beneficiaryId || preview.source.amountCents === null) throw new Error('Autorité modifiée.');
    const identity = proofReference('identity_destination'), authority = proofReference('harm_or_authority'); if (!identity || !authority) return;
    const command: Command = {context: caseContext, action: preview.action, previewId: preview.previewId, sourceHash: preview.source.sourceHash, sourceRevision: preview.source.sourceRevision,
      instructionId: preview.action === 'prepare' ? null : preview.source.instructionId, amountCents: preview.source.amountCents, currency: 'CAD', beneficiaryId: preview.source.beneficiaryId,
      identityEvidence: identity, authorityEvidence: authority, executionEvidence: preview.action === 'attest' && !walletCompensation ? proofReference('execution') : null,
      attestation: {version: 'exceptional_restitution_human_v1', nativeBeneficiaryAndDestinationVerified: true, harmOrLegalAuthorityVerified: true,
        transferExecutedAndReceiptVerified: preview.action === 'attest' && !walletCompensation, neverExecuted: preview.action === 'void_never_executed', ...(walletCompensation ? {nativeCompensationCreditVerified: true as const} : {})}, note: current.note.trim(), partyMessage: current.message.trim(), acknowledged: true};
    const reference = await Service.commandReference(uid, current.requestId, command, guard); guard(); for (const proof of visibleProofs) proof.assertCurrent();
    await Journal.execute(reference, command, guard); guard(); setDraft(null); setReadProofs([]); onRecorded(); setNotice({baseKey, text: 'Le reçu exact est conservé dans votre suivi. L’application n’effectue aucun virement bancaire.'});
  });
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Restitution exceptionnelle examinée par Seconde</Text>
    <Text style={styles.caption}>{walletCompensation ? "Ce crédit compensatoire de Seconde porte sur la dette historique de cette intention. Le serveur fixe le montant intégral, l’impute sur la dette courante puis ajoute l’éventuel surplus au solde. Aucun virement, revenu de vente ou annulation d’écriture historique n’est déclaré." : "Le bénéficiaire et le plafond viennent des sources natives. L’équipe vérifie les documents et réalise le virement hors de l’application. Une attestation humaine ne confirme ni crédit bancaire, remboursement Stripe ou accès à un compte tiers. Ne saisissez aucune coordonnée bancaire dans les textes."}</Text>
    <Button variant="secondary" disabled={!context.focused || busy} onPress={() => {try {context.capture(); refresh();} catch { /* Fresh read only. */ }}}>Relire les sources de cette restitution</Button>
    {sourceQuery.isError || journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les sources ou le suivi ne peuvent pas être qualifiés. Aucune nouvelle instruction n’est permise.</Text> : null}
    {source ? <><ExceptionalRestitutionSummary source={source} />
      {caseContext.kind === 'refund_error' && (source.funding === 'original_refund_allocation' || caseContext.harm === 'buyer_shortfall') ? <><Text style={styles.caption}>{source.funding === 'original_refund_allocation'
        ? 'Une dette carte de cette intention engagée relève du remboursement d’origine. Ouvrez son examen existant ; aucune compensation parallèle ne doit être créée.'
        : 'Cette lecture ne qualifie aucune dette carte engagée pour cette intention. Un montant non alloué ne constitue pas une somme due ; aucune compensation parallèle n’est ouverte.'}</Text>
        {onOriginalRefundAllocation && source.funding === 'original_refund_allocation' ? <Button variant="secondary" disabled={busy} onPress={() => {try {context.capture(); onOriginalRefundAllocation({transactionId: caseContext.transactionId, refundIntentId: caseContext.refundIntentId});} catch { /* Native reference only. */ }}}>Ouvrir l’allocation de remboursement d’origine</Button> : null}</> : <>
        {caseContext.kind === 'refund_error' && !walletCompensation && !source.instructionId && ['available', 'unqualified'].includes(source.state) ? <TextInput accessibilityLabel="Montant du préjudice établi en dollars canadiens" value={enteredAmount} editable={!busy} keyboardType="decimal-pad" maxLength={12} placeholder="Montant établi ; vide = plafond natif" style={styles.input} onChangeText={text => {try {context.capture(); interaction.current++; setAmountField({baseKey, text}); setSelection(null); setDraft(null); setMedia(null); setReadProofs([]); setVerified(null);} catch { /* No stale amount is adopted. */ }}} /> : null}
        <Text style={styles.caption}>Ce choix ouvre un examen documentaire. Seuls la réauthentification et l’aperçu actuel qualifieront une nouvelle instruction.</Text>
        <Button variant="secondary" disabled={busy || blocked || !!source.instructionId || !['available', 'unqualified'].includes(source.state) || !!enteredAmount && (amount(enteredAmount) === null || source.maximumCents === null || Number(amount(enteredAmount)) > source.maximumCents)} onPress={() => select('prepare')}>Examiner une nouvelle instruction pour le bénéficiaire natif</Button>
        <Button variant="secondary" disabled={busy || blocked || source.state !== 'prepared'} onPress={() => select('attest')}>{walletCompensation ? 'Examiner le crédit compensatoire préparé' : 'Examiner l’exécution de l’instruction préparée'}</Button>
        <Button variant="secondary" disabled={busy || blocked || !source.instructionId || !['prepared', 'reconciliation_required'].includes(source.state)} onPress={() => select('void_never_executed')}>Clore cette instruction jamais exécutée</Button>
      </>}
    </> : null}
    {action ? <><AdminFinancialReauthentication uid={uid} sourceKey={reauthenticationKey} purpose={walletCompensation ? "account_review" : "manual_restitution"} disabled={busy || blocked} onChallengeStart={challengeStart} onChallengeEnd={challengeEnd} onVerified={challengeVerified} />
      <Button disabled={busy || blocked || !verificationCurrent} onPress={() => {void prepare();}}>Qualifier l’aperçu de cette restitution</Button></> : null}
    {current ? <><ExceptionalRestitutionSummary source={current.preview.source} />
      {(['identity_destination', 'harm_or_authority', ...(current.preview.action === 'attest' && !walletCompensation ? ['execution'] : [])] as Purpose[]).map(purpose => <View key={purpose} style={styles.section}>
        <Text style={styles.body}>{names[purpose]}</Text>
        {!proofReference(purpose) ? <Button variant="secondary" disabled={busy || proofs.some(v => v.receipt.purpose === purpose || v.receipt.purpose === null)} onPress={() => {void pickImage(purpose);}}>Choisir le justificatif JPEG : {names[purpose]}</Button> : null}
        {currentMedia?.purpose === purpose ? <><Text style={styles.caption}>Image préparée : {currentMedia.file.width} × {currentMedia.file.height} pixels. Occultez les renseignements inutiles avant la sélection. Le document reste en mémoire jusqu’au dépôt.</Text>
          {purpose === 'execution' ? <><TextInput accessibilityLabel="Référence unique du virement exceptionnel" value={current.transferReference} maxLength={200} editable={!busy} placeholder="Référence du reçu, aucun numéro de compte" style={styles.input} onChangeText={transferReference => edit({transferReference})} />
            <TextInput accessibilityLabel="Date effective du virement exceptionnel" value={current.executedDate} maxLength={10} editable={!busy} placeholder="Date réelle : AAAA-MM-JJ" style={styles.input} onChangeText={executedDate => edit({executedDate})} /></> : null}
          <Button disabled={busy || !verificationCurrent || purpose === 'execution' && (!current.transferReference.trim() || !current.executedDate)} onPress={() => {void upload();}}>Déposer ce seul justificatif privé</Button></> : null}
        {proofReference(purpose) ? <Button variant="secondary" disabled={busy || !verificationCurrent} onPress={() => {void readProof(purpose);}}>Afficher le fichier exact : {names[purpose]}</Button> : null}
        {visibleProofs.filter(p => p.purpose === purpose).map(p => <Image key={p.readId} source={{uri: p.dataUrl}} cachePolicy="none" style={styles.image} contentFit="contain" accessibilityLabel={names[purpose]} onLoad={() => paintProof(p, true)} onError={() => paintProof(p, false)} />)}
      </View>)}
      <TextInput accessibilityLabel="Motivation privée de restitution exceptionnelle" value={current.note} editable={!busy} multiline maxLength={2000} placeholder="Motivation privée, sans coordonnées bancaires" style={styles.input} onChangeText={note => edit({note})} />
      <TextInput accessibilityLabel="Message communicable de restitution exceptionnelle" value={current.message} editable={!busy} multiline maxLength={2000} placeholder="Message communicable aux parties" style={styles.input} onChangeText={message => edit({message})} />
      <Checkbox checked={current.identity} disabled={busy || !proofRead('identity_destination')} onToggle={() => edit({identity: !current.identity})}><Text style={styles.caption}>J’ai vérifié l’identité du bénéficiaire natif et sa destination dans le fichier effectivement affiché.</Text></Checkbox>
      <Checkbox checked={current.authority} disabled={busy || !proofRead('harm_or_authority')} onToggle={() => edit({authority: !current.authority})}><Text style={styles.caption}>J’ai vérifié le préjudice réel, le montant et, si nécessaire, le pouvoir de représentation lié à cette obligation.</Text></Checkbox>
      {current.preview.action === 'attest' && !walletCompensation ? <Checkbox checked={current.executed} disabled={busy || !proofRead('execution')} onToggle={() => edit({executed: !current.executed})}><Text style={styles.caption}>J’ai vérifié le virement exécuté, son bénéficiaire, son montant CAD, sa référence unique et sa date réelle.</Text></Checkbox> : null}
      {walletCompensation ? <Checkbox checked={current.credit} disabled={busy || !proofRead('identity_destination') || !proofRead('harm_or_authority')} onToggle={() => edit({credit: !current.credit})}><Text style={styles.caption}>J’ai vérifié le droit au crédit compensatoire intégral de Seconde sur ce portefeuille natif. Le serveur imputera la dette courante puis créditera l’éventuel surplus au solde ; aucun virement ou revenu de vente n’est attesté.</Text></Checkbox> : null}
      {current.preview.action === 'void_never_executed' ? <Checkbox checked={current.neverExecuted} disabled={busy} onToggle={() => edit({neverExecuted: !current.neverExecuted})}><Text style={styles.caption}>Cette instruction n’a jamais été exécutée ; je demande seulement sa clôture documentaire.</Text></Checkbox> : null}
      <Checkbox checked={current.accepted} disabled={busy || !current.identity || !current.authority || walletCompensation && !current.credit || !current.note.trim() || !current.message.trim() || current.preview.action === 'attest' && !walletCompensation && !current.executed || current.preview.action === 'void_never_executed' && !current.neverExecuted}
        onToggle={() => {if (!current) return; try {context.capture(); interaction.current++; setDraft(old => old?.key === key ? {...old, accepted: !old.accepted} : old);} catch { /* Current confirmation only. */ }}}><Text style={styles.caption}>Je confirme cette décision motivée sur cette seule instruction. Aucune arrivée bancaire automatique, récupération de compte ou permission sur d’autres obligations n’est accordée.</Text></Checkbox>
      <Button disabled={busy || blocked || !verificationCurrent || !current.accepted || !allowed(current.preview.source, current.preview.action)} onPress={() => {void submit();}}>{walletCompensation ? "Enregistrer cette décision de crédit compensatoire" : "Enregistrer cette décision exceptionnelle exacte"}</Button>
    </> : null}
    {blocked ? <Text style={styles.caption}>Relisez et terminez l’intention précédente dans le suivi personnel avant une nouvelle instruction.</Text> : null}
    {notice?.baseKey === baseKey && context.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}, image: {width: '100%', height: spacing.xl * 8}});
