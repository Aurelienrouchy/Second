import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { RefundRepairSummary } from '@/components/RefundRepairSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { RefundRepairManualService } from '@/services/refundRepairService';
import { RefundRepairManualJournal } from '@/services/refundRepairJournal';
import type { RefundRepairManualAction, RefundRepairManualEvidenceReference, RefundRepairManualFile, RefundRepairManualPreview,
  RefundRepairManualPurpose, RefundRepairManualSource, RefundRepairManualAttempt } from '@/types/refundRepair';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
type Draft = {key: string; preview: RefundRepairManualPreview; requestId: string; note: string; message: string;
  identity: boolean; executed: boolean; neverExecuted: boolean; accepted: boolean; transferReference: string; executedDate: string};
type Media = {key: string; activityRevision: string; purpose: RefundRepairManualPurpose; file: RefundRepairManualFile; bytes: Uint8Array};
type NativeChallenge = {baseKey: string; key: string; action: RefundRepairManualAction; sourceHash: string; sourceRevision: string | null; owner: typeof auth.currentUser; operation: ReturnType<ReturnType<typeof useShippingPurchaseContext>['capture']>; verified: boolean; media: Media | null};
type ReadProof = {key: string; purpose: RefundRepairManualPurpose; evidence: RefundRepairManualEvidenceReference; dataUrl: string};
const allowed = (s: RefundRepairManualSource, a: RefundRepairManualAction) => a === 'prepare_manual_bank_transfer' ? s.canPrepare : a === 'attest_manual_bank_transfer' ? s.canAttest : s.canVoid;
const fingerprint = (p: RefundRepairManualPreview) => JSON.stringify([p.action, p.previewId, p.source.sourceHash, p.source.sourceRevision, p.source.beneficiaryId, p.source.amountCents, p.source.remainingCents, p.source.instructionId]);
/** Manual bank execution stays outside the app; only qualified source-bound human attestations are recorded here. */
export function AdminRefundRepairManualPanel({uid, transactionId, refundIntentId, onRecorded}: {uid: string; transactionId: string; refundIntentId: string; onRecorded: () => void}) {
  const context = useLabelLifecycleContext(`manual-refund:${transactionId}:${refundIntentId}`, uid);
  const picker = useShippingPurchaseContext(`manual-refund-selection:${transactionId}:${refundIntentId}`, uid);
  const client = useQueryClient(), generation = getAuthSessionGeneration();
  const baseKey = JSON.stringify([uid, transactionId, refundIntentId, generation, picker.focusRevision]);
  const query = useQuery({queryKey: ['manual-refund-source', baseKey, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return RefundRepairManualService.source(uid, transactionId, refundIntentId, 'admin', () => context.assertCurrent(op));}});
  const source = context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data.selected : null;
  const [selection, setSelection] = useState<{baseKey: string; action: RefundRepairManualAction; sourceHash: string; sourceRevision: string | null} | null>(null);
  const action = selection?.baseKey === baseKey ? selection.action : null;
  const key = JSON.stringify([baseKey, action, source?.sourceHash, source?.sourceRevision]);
  const verificationKey = JSON.stringify([key, context.focusRevision]);
  const reauthenticationKey = JSON.stringify([baseKey, action, selection?.sourceHash, selection?.sourceRevision]);
  const [verified, setVerified] = useState<string | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [media, setMedia] = useState<Media | null>(null), [readProofs, setReadProofs] = useState<ReadProof[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{baseKey: string; text: string} | null>(null);
  const lock = useRef<symbol | null>(null), interaction = useRef(0);
  const nativeChallenge = useRef<NativeChallenge | null>(null);
  const current = source && draft?.key === key ? draft : null;
  const journal = useQuery({queryKey: ['manual-refund-pending', uid, baseKey, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(), guard = () => context.assertCurrent(op); return {commands: await RefundRepairManualJournal.pending(uid, guard), proofs: await RefundRepairManualJournal.readEvidence(uid, guard)};}});
  const journalReady = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const blocked = !journalReady || journal.data.commands.some(a => a.command.transactionId === transactionId && a.command.refundIntentId === refundIntentId);
  const proofs = journalReady ? journal.data.proofs.filter(a => a.attempt.context.transactionId === transactionId && a.attempt.context.refundIntentId === refundIntentId) : [];
  const live = useRef({baseKey, key, verificationKey, context});
  useLayoutEffect(() => {live.current = {baseKey, key, verificationKey, context};}, [baseKey, key, verificationKey, context]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {if (state !== 'active' && !nativeChallenge.current) media?.bytes.fill(0);});
    return () => {subscription.remove(); media?.bytes.fill(0);};
  }, [media, baseKey]);
  const currentMedia = media?.key === key && media.activityRevision === context.focusRevision ? media : null;
  const edit = (patch: Partial<Draft>) => {if (!current || busy) return; try {context.capture(); interaction.current++; setDraft(old => old?.key === key ? {...old, ...patch, accepted: false} : old);} catch { /* Current form only. */ }};
  const refresh = () => {void query.refetch(); void journal.refetch(); void client.invalidateQueries({queryKey: ['manual-refund-own', uid]});};
  const select = (value: RefundRepairManualAction) => {try {context.capture(); if (lock.current) return; interaction.current++; if (!source) return; setSelection({baseKey, action: value, sourceHash: source.sourceHash, sourceRevision: source.sourceRevision}); setDraft(null); setVerified(null); setReadProofs([]); setMedia(null); setNotice(null);} catch { /* No historical form can grant new authority. */ }};
  const challengeStart = () => {
    if (!source || !action || nativeChallenge.current) return;
    const operation = picker.capture();
    nativeChallenge.current = {baseKey, key, action, sourceHash: source.sourceHash, sourceRevision: source.sourceRevision,
      owner: auth.currentUser, operation, verified: false, media: currentMedia};
    setVerified(null); setReadProofs([]);
  };
  const assertChallenge = (lease: NativeChallenge) => {
    picker.assertCurrent(lease.operation);
    if (nativeChallenge.current !== lease || live.current.baseKey !== lease.baseKey || auth.currentUser !== lease.owner) throw new Error('La connexion ou le dossier a changé.');
  };
  const challengeVerified = () => {
    const lease = nativeChallenge.current; if (!lease) return;
    lease.verified = true;
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {const check = () => {try {assertChallenge(lease); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
        assertChallenge(lease); const active = live.current.context, operation = active.capture();
        const guard = () => {assertChallenge(lease); active.assertCurrent(operation);};
        const preview = await RefundRepairManualService.preview(uid, transactionId, refundIntentId, lease.action, guard); guard();
        if (preview.source.sourceHash !== lease.sourceHash || preview.source.sourceRevision !== lease.sourceRevision) throw new Error('Les sources ont changé pendant la confirmation.');
        await query.refetch(); guard();
        setVerified(JSON.stringify([lease.key, active.focusRevision]));
        if (lease.media) setMedia(old => old && old === lease.media ? {...old, bytes: new Uint8Array(old.bytes), activityRevision: active.focusRevision} : old);
      } catch {try {assertChallenge(lease); setVerified(null); setNotice({baseKey, text: 'Relisez les sources actuelles avant de reprendre cette confirmation. Aucune instruction n’a été envoyée.'});} catch { /* Old native confirmations cannot adopt a new session. */ }}
      finally {if (nativeChallenge.current === lease) nativeChallenge.current = null;}
    })();
  };
  const challengeEnd = () => {
    const lease = nativeChallenge.current;
    if (!lease || lease.verified) return;
    try {assertChallenge(lease); const active = live.current.context; active.capture();
      if (lease.media) setMedia(old => old && old === lease.media ? {...old, bytes: new Uint8Array(old.bytes), activityRevision: active.focusRevision} : old);
    } catch {lease.media?.bytes.fill(0);}
    if (nativeChallenge.current === lease) nativeChallenge.current = null;
  };
  const run = async (work: (guard: () => void) => Promise<void>, requireForm = true) => {
    if (lock.current || !context.focused || requireForm && (!current || blocked || verified !== verificationKey)) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(), epoch = interaction.current; lock.current = token; setBusy(true); setNotice(null);
    const guard = () => {context.assertCurrent(op); if (live.current.key !== key || interaction.current !== epoch) throw new Error('Le contexte ou les sources ont changé.');};
    try {await work(guard); guard();}
    catch {if (context.isCurrent(op) && live.current.key === key) setNotice({baseKey, text: 'Le résultat doit être relu dans le suivi personnel. Aucun nouvel envoi bancaire n’est déclenché ; conservez la même intention.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} refresh();}
  };
  const prepare = () => run(async guard => {
    if (!source || !action || blocked || verified !== verificationKey) return;
    const preview = await RefundRepairManualService.preview(uid, transactionId, refundIntentId, action, guard); guard();
    if (preview.source.sourceHash !== source.sourceHash || preview.source.sourceRevision !== source.sourceRevision || !allowed(preview.source, action)) throw new Error('Source ou faisabilité non qualifiée.');
    setDraft({key, preview, requestId: randomUUID(), note: '', message: '', identity: false, executed: false, neverExecuted: false, accepted: false, transferReference: '', executedDate: ''});
    setReadProofs([]); setMedia(null);
  }, false);
  const pickImage = async (purpose: RefundRepairManualPurpose) => {
    if (!current || lock.current || proofs.some(p => p.attempt.context.purpose === purpose)) return;
    let op; try {op = picker.start();} catch {return;} if (!op) return;
    const token = Symbol(), owner = auth.currentUser, selectedDraft = current, selectedBase = baseKey; lock.current = token; setBusy(true);
    const guardPicker = () => {picker.assertCurrent(op); if (auth.currentUser !== owner || getAuthSessionGeneration() !== generation || live.current.baseKey !== selectedBase) throw new Error('Sélection périmée.');};
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); guardPicker(); if (!permission.granted) throw new Error('Permission requise.');
      const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible}); guardPicker();
      if (result.canceled || !result.assets[0]) return;
      // Native permission/gallery may deactivate the app. Only the picker phase
      // tolerates that transition; no network write uses its old lifecycle.
      await new Promise<void>((resolve, reject) => {const check = () => {try {guardPicker(); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      guardPicker(); const frame = live.current.context, fresh = frame.capture();
      const guard = () => {guardPicker(); frame.assertCurrent(fresh);};
      const prepared = await RefundRepairManualService.prepareImage(uid, result.assets[0].uri, guard); guard();
      const preview = await RefundRepairManualService.preview(uid, transactionId, refundIntentId, selectedDraft.preview.action, guard); guard();
      if (fingerprint(preview) !== fingerprint(selectedDraft.preview)) {prepared.bytes.fill(0); throw new Error('Sources modifiées.');}
      setMedia({key: selectedDraft.key, activityRevision: live.current.context.focusRevision, purpose, ...prepared}); setVerified(null);
      setNotice({baseKey, text: 'Image préparée uniquement en mémoire. Réauthentifiez-vous dans le contexte actuel avant son dépôt privé.'});
    } catch {try {guardPicker(); setNotice({baseKey, text: 'La sélection ou sa source doit être reprise. Aucune pièce n’a été envoyée.'});} catch { /* Old gallery completions stay inert. */ }}
    finally {picker.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);}}
  };
  const upload = () => run(async guard => {
    if (!current || !currentMedia || currentMedia.key !== key || !source || !current.preview.source.sourceRevision) return;
    const purpose = currentMedia.purpose, preview = await RefundRepairManualService.preview(uid, transactionId, refundIntentId, current.preview.action, guard); guard();
    if (fingerprint(preview) !== fingerprint(current.preview)) throw new Error('Sources modifiées.');
    const execution = purpose === 'payment_execution' ? {transferReference: current.transferReference, executedDate: current.executedDate} : null;
    const attempt = await RefundRepairManualService.evidenceAttempt(uid, randomUUID(), {transactionId, refundIntentId, previewId: current.preview.previewId,
      sourceHash: current.preview.source.sourceHash, sourceRevision: current.preview.source.sourceRevision, purpose,
      instructionId: purpose === 'payment_execution' ? current.preview.source.instructionId : null}, currentMedia.file, source.beneficiaryId, source.amountCents, execution, guard); guard();
    try {await RefundRepairManualJournal.sendEvidence(attempt, {bytes: currentMedia.bytes, execution}, guard); guard();}
    finally {currentMedia.bytes.fill(0); setMedia(old => old === currentMedia ? null : old); setDraft(old => old?.key === current.key ? {...old, transferReference: '', executedDate: '', accepted: false} : old);}
  });
  const proofReference = (purpose: RefundRepairManualPurpose) => {
    const native = purpose === 'beneficiary_verification' ? current?.preview.source.beneficiaryEvidence : current?.preview.source.paymentEvidence;
    const deposited = proofs.find(p => p.attempt.context.purpose === purpose && p.receipt.state === 'stored' && p.attempt.context.sourceHash === current?.preview.source.sourceHash)?.receipt.evidence;
    return native ?? deposited ?? null;
  };
  const readProof = (purpose: RefundRepairManualPurpose) => run(async guard => {
    const evidence = proofReference(purpose); if (!current || !evidence) return;
    const file = await RefundRepairManualService.file(uid, transactionId, refundIntentId, evidence, guard); guard(); if (file.purpose !== purpose) throw new Error('Pièce inattendue.');
    setReadProofs(old => [...old.filter(p => p.key === verificationKey && p.purpose !== purpose), {key: verificationKey, purpose, evidence, dataUrl: file.dataUrl}]);
  });
  const proofRead = (purpose: RefundRepairManualPurpose) => {const reference = proofReference(purpose); return !!reference && readProofs.some(p => p.key === verificationKey && p.purpose === purpose && JSON.stringify(p.evidence) === JSON.stringify(reference));};
  const submit = () => run(async guard => {
    if (!current || !source || !current.note.trim() || !current.message.trim() || !current.accepted || !current.identity || !proofRead('beneficiary_verification') ||
      current.preview.action === 'attest_manual_bank_transfer' && (!current.executed || !proofRead('payment_execution')) || current.preview.action === 'void_unexecuted_manual_instruction' && !current.neverExecuted) return;
    const preview = await RefundRepairManualService.preview(uid, transactionId, refundIntentId, current.preview.action, guard); guard();
    if (fingerprint(preview) !== fingerprint(current.preview) || !allowed(preview.source, preview.action) || !preview.source.sourceRevision) throw new Error('Faisabilité modifiée.');
    const attempt: RefundRepairManualAttempt = {version: 2, uid, requestId: current.requestId, command: {transactionId, refundIntentId, action: preview.action,
      previewId: preview.previewId, sourceHash: preview.source.sourceHash, sourceRevision: preview.source.sourceRevision, amountCents: preview.source.amountCents, currency: 'CAD',
      beneficiaryId: preview.source.beneficiaryId, instructionId: preview.action === 'prepare_manual_bank_transfer' ? null : preview.source.instructionId,
      beneficiaryEvidence: proofReference('beneficiary_verification'), paymentEvidence: preview.action === 'attest_manual_bank_transfer' ? proofReference('payment_execution') : null,
      attestation: {version: 'manual_bank_transfer_human_v1', beneficiaryIdentityAndDestinationVerified: true,
        transferExecutedAndReceiptVerified: preview.action === 'attest_manual_bank_transfer', neverExecuted: preview.action === 'void_unexecuted_manual_instruction'},
      note: current.note.trim(), partyMessage: current.message.trim(), acknowledged: true}};
    await RefundRepairManualJournal.execute(attempt, guard); guard(); setDraft(null); setReadProofs([]); onRecorded();
    setNotice({baseKey, text: 'Le reçu natif est disponible dans votre suivi. Aucun virement bancaire n’est exécuté par l’application.'});
  });
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Restitution par virement bancaire manuel</Text>
    <Text style={styles.caption}>L’équipe Seconde vérifie les documents privés et réalise le virement hors de l’application. Ce parcours conserve une instruction et une attestation humaine ; il ne confirme ni un remboursement Stripe ni une arrivée bancaire automatique. Ne saisissez aucun numéro de compte dans les textes.</Text>
    <Button variant="secondary" disabled={!context.focused || busy} onPress={() => {try {context.capture(); refresh();} catch { /* Fresh read only. */ }}}>Relire la source du virement manuel</Button>
    {query.isError || journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le contexte natif ne peut pas être qualifié. Aucune nouvelle instruction n’est permise.</Text> : null}
    {source ? <><RefundRepairSummary manual={source} />
      <Text style={styles.caption}>Sélectionnez un examen documentaire. La réauthentification et l’aperçu actuel qualifieront séparément toute nouvelle instruction.</Text>
      <Button variant="secondary" disabled={busy || blocked || !['none', 'voided'].includes(source.state)} onPress={() => select('prepare_manual_bank_transfer')}>Préparer une instruction manuelle pour cet acheteur</Button>
      <Button variant="secondary" disabled={busy || blocked || source.state !== 'prepared'} onPress={() => select('attest_manual_bank_transfer')}>Examiner l’exécution du virement préparé</Button>
      <Button variant="secondary" disabled={busy || blocked || source.state !== 'prepared'} onPress={() => select('void_unexecuted_manual_instruction')}>Clore une instruction jamais exécutée</Button>

    </> : null}
    {action ? <><AdminFinancialReauthentication uid={uid} sourceKey={reauthenticationKey} purpose="manual_restitution" disabled={busy || blocked}
      onChallengeStart={challengeStart} onChallengeEnd={challengeEnd} onVerified={challengeVerified} />
      <Button disabled={busy || blocked || verified !== verificationKey} onPress={() => {void prepare();}}>Qualifier l’aperçu de ce seul choix</Button></> : null}
    {current ? <><RefundRepairSummary manual={current.preview.source} />
      {(['beneficiary_verification', ...(current.preview.action === 'attest_manual_bank_transfer' ? ['payment_execution'] : [])] as RefundRepairManualPurpose[]).map(purpose => <View key={purpose} style={styles.section}>
        <Text style={styles.body}>{purpose === 'beneficiary_verification' ? 'Document privé vérifiant le bénéficiaire et sa destination bancaire' : 'Justificatif privé du virement bancaire effectivement exécuté'}</Text>
        {!proofReference(purpose) ? <Button variant="secondary" disabled={busy || proofs.some(p => p.attempt.context.purpose === purpose)} onPress={() => {void pickImage(purpose);}}>Choisir une image JPEG à déposer</Button> : null}
        {currentMedia?.purpose === purpose ? <><Text style={styles.caption}>Image préparée : {currentMedia.file.width} × {currentMedia.file.height} pixels, {Math.ceil(currentMedia.file.byteLength / 1024)} Kio. Occultez les renseignements inutiles sur le document avant sélection.</Text>
          {purpose === 'payment_execution' ? <><TextInput accessibilityLabel="Référence unique du reçu de virement" value={current.transferReference} maxLength={200} editable={!busy} placeholder="Référence du reçu, aucun numéro de compte" style={styles.input} onChangeText={transferReference => edit({transferReference})} />
            <TextInput accessibilityLabel="Date bancaire effective" value={current.executedDate} maxLength={10} editable={!busy} placeholder="Date réelle du virement : AAAA-MM-JJ" style={styles.input} onChangeText={executedDate => edit({executedDate})} /></> : null}
          <Button disabled={busy || verified !== verificationKey || purpose === 'payment_execution' && (!current.transferReference.trim() || !current.executedDate)} onPress={() => {void upload();}}>Déposer cette pièce privée et ses seules références natives</Button></> : null}
        {proofReference(purpose) ? <Button variant="secondary" disabled={busy || verified !== verificationKey} onPress={() => {void readProof(purpose);}}>Relire le fichier exact avant mon attestation</Button> : null}
        {readProofs.filter(p => p.key === verificationKey && p.purpose === purpose).map(p => <Image key={p.evidence.evidenceId} source={{uri: p.dataUrl}} cachePolicy="none" style={styles.image} contentFit="contain" accessibilityLabel="Justificatif bancaire privé examiné" />)}
      </View>)}
      <TextInput accessibilityLabel="Motivation privée du virement manuel" value={current.note} editable={!busy} multiline maxLength={2000} placeholder="Motivation privée, sans coordonnées bancaires" style={styles.input} onChangeText={note => edit({note})} />
      <TextInput accessibilityLabel="Message communicable du virement manuel" value={current.message} editable={!busy} multiline maxLength={2000} placeholder="Message communicable aux parties, sans information bancaire" style={styles.input} onChangeText={message => edit({message})} />
      <Checkbox checked={current.identity} disabled={busy || !proofRead('beneficiary_verification')} onToggle={() => edit({identity: !current.identity})}><Text style={styles.caption}>J’ai effectivement vérifié l’identité du bénéficiaire natif et sa destination bancaire dans cette pièce.</Text></Checkbox>
      {current.preview.action === 'attest_manual_bank_transfer' ? <Checkbox checked={current.executed} disabled={busy || !proofRead('payment_execution')} onToggle={() => edit({executed: !current.executed})}><Text style={styles.caption}>J’ai vérifié le reçu du virement exécuté, son bénéficiaire, son montant CAD, sa référence unique et sa date réelle.</Text></Checkbox> : null}
      {current.preview.action === 'void_unexecuted_manual_instruction' ? <Checkbox checked={current.neverExecuted} disabled={busy} onToggle={() => edit({neverExecuted: !current.neverExecuted})}><Text style={styles.caption}>Cette instruction n’a jamais été exécutée ; je demande seulement sa clôture documentaire.</Text></Checkbox> : null}
      <Checkbox checked={current.accepted} disabled={busy || !current.identity || !current.note.trim() || !current.message.trim() || current.preview.action === 'attest_manual_bank_transfer' && !current.executed || current.preview.action === 'void_unexecuted_manual_instruction' && !current.neverExecuted} onToggle={() => {if (!current) return; try {context.capture(); interaction.current++; setDraft(old => old?.key === key ? {...old, accepted: !old.accepted} : old);} catch { /* Fresh confirmation only. */ }}}><Text style={styles.caption}>Je confirme cette décision motivée sur la seule instruction visible. L’application ne réalise aucun virement et ne vérifie pas automatiquement l’arrivée bancaire.</Text></Checkbox>
      <Button disabled={busy || blocked || verified !== verificationKey || !current.accepted || !allowed(current.preview.source, current.preview.action)} onPress={() => {void submit();}}>Enregistrer cette instruction ou attestation humaine exacte</Button>
    </> : null}
    {blocked ? <Text style={styles.caption}>Relisez et terminez le suivi de l’intention précédente avant une nouvelle instruction.</Text> : null}
    {notice?.baseKey === baseKey && context.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}, image: {width: '100%', height: spacing.xl * 8}});
