import {useRef, useState} from 'react';
import {StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useRouter} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {Button, Checkbox} from '@/components/ui';
import {ConvenienceReturnFacts, convenienceReturnFacts} from '@/components/ConvenienceReturnFacts';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ConvenienceReturnService as Service, convenienceReturnFailure} from '@/services/convenienceReturnService';
import {ConvenienceReturnJournal as Journal} from '@/services/convenienceReturnJournal';
import {TransactionService} from '@/services/transactionService';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {createConvenienceInteraction} from '@/utils/convenienceReturnContract';
import {CONVENIENCE_RETURN_CAPABILITY, PRICED_CONVENIENCE_RETURN_CAPABILITY, type ConvenienceReturnAttempt, type ConvenienceReturnCommand, type ConvenienceReturnReceipt, type ConvenienceReturnReceptionAttempt, type ConvenienceReturnReceptionReceipt} from '@/types/convenienceReturn';
import {colors, spacing, typography} from '@/constants/theme';
export interface ConvenienceReturnPanelProps {compact?: boolean; uid: string; transactionId: string; sourceKey: string; onRecorded?: () => void}
const actions: Record<ConvenienceReturnCommand['action'], string> = {request: 'Demander l’accord du vendeur', accept: 'Accepter explicitement le principe de ce retour', refuse: 'Refuser ce retour pour changement d’avis'};
const stateLabel = {none: 'Aucune demande enregistrée', pending: 'Accord explicite du vendeur en attente', accepted: 'Principe du retour accepté par le vendeur', refused: 'Retour pour changement d’avis refusé par le vendeur', unknown: 'Accord historique à rapprocher'};
const receiptLabel = {absent: 'Le reçu de cette intention n’est pas enregistré. Son résultat reste inconnu.', committed: 'Ce choix a été enregistré. Il ne règle ni les frais, ni l’étiquette, ni le remboursement.', not_executed: 'Cette intention n’a pas été exécutée, car la source ou la permission a changé.', neutralized: 'Cette intention a été neutralisée avant exécution.'};
const receiptText = (receipt: ConvenienceReturnReceipt) => receipt.protocol === 'convenience_return_receipt_v2' && receipt.state === 'committed' ?
  'Ce choix sur les conditions a été enregistré : retour à la charge de l’acheteur et remboursement prévu du prix de l’article uniquement. Aucun paiement d’étiquette ni remboursement n’est confirmé.' : receiptLabel[receipt.state];
const receptionText = (receipt: ConvenienceReturnReceptionReceipt) => receipt.state === 'committed' ? 'Votre déclaration de réception conforme est enregistrée. Elle ne prouve pas un remboursement ; une instruction financière distincte reste nécessaire.' : receipt.state === 'absent' ? 'La réception de cette intention reste inconnue. Relisez la même référence ; aucune nouvelle déclaration n’est envoyée.' : receipt.state === 'neutralized' ? 'Cette intention de déclaration a été neutralisée avant exécution.' : 'Cette déclaration n’a pas été exécutée. Les conditions et la permission doivent être relues.';
export function ConvenienceReturnPanel({uid, transactionId, sourceKey, onRecorded, compact=false}: ConvenienceReturnPanelProps) {
  const viewport = useWindowDimensions();
  const [legacyReview, setLegacyReview] = useState(false), capability = legacyReview ? CONVENIENCE_RETURN_CAPABILITY : PRICED_CONVENIENCE_RETURN_CAPABILITY;
  const base = useLabelLifecycleContext(JSON.stringify(['convenience-return', transactionId, sourceKey, capability]), uid), client = useQueryClient(), router = useRouter();
  const [revision, setRevision] = useState(0), key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, sourceKey, capability, base.focusRevision, revision, viewport.width, viewport.height, viewport.fontScale]);
  const [frame, setFrame] = useState(() => ({key, interaction: createConvenienceInteraction()})); let currentFrame = frame;
  if (frame.key !== key) {frame.interaction.invalidate(); currentFrame = {key, interaction: createConvenienceInteraction()}; setFrame(currentFrame);}
  const choice = currentFrame.interaction.capture(), guard = () => {base.capture(); choice();};
  const ownKey = ['convenience-return-journal', key];
  // Recovery is deliberately read before private-order admission or any profile guard.
  const own = useQuery({queryKey: ownKey, enabled: base.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = base.capture(), current = () => {base.assertCurrent(op); choice();};
      const attempt = await Journal.read(uid, transactionId, current); current();
      const receipt = attempt ? await Journal.observe(attempt, current) : null; current(); return {attempt, receipt};}});
  const ownReady = base.focused && own.isSuccess && own.fetchStatus === 'idle' && !own.isError && client.getQueryState(ownKey)?.isInvalidated === false;
  const attempt = ownReady ? own.data.attempt : null, nativeReceipt = ownReady ? own.data.receipt : null;
  const receptionOwnKey = ['convenience-return-reception-own', key];
  const receptionOwn = useQuery({queryKey: receptionOwnKey, enabled: ownReady && attempt === null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = base.capture(), current = () => {base.assertCurrent(op); choice();};
      const a = await Journal.readReception(uid, transactionId, current); current(); const receipt = a ? await Journal.observeReception(a, current) : null; current(); return {attempt: a, receipt};}});
  const receptionOwnReady = ownReady && attempt === null && receptionOwn.isSuccess && receptionOwn.fetchStatus === 'idle' && !receptionOwn.isError && client.getQueryState(receptionOwnKey)?.isInvalidated === false;
  const receptionAttempt = receptionOwnReady ? receptionOwn.data.attempt : null, receptionReceipt = receptionOwnReady ? receptionOwn.data.receipt : null;
  const receptionPreviewKey = ['convenience-return-reception-preview', key];
  const receptionPreview = useQuery({queryKey: receptionPreviewKey, enabled: receptionOwnReady && receptionAttempt === null && !legacyReview,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return Service.receptionPreview(uid, transactionId, () => {base.assertCurrent(op); choice();});}});
  const receptionReady = receptionOwnReady && receptionAttempt === null && !legacyReview && receptionPreview.isSuccess && receptionPreview.fetchStatus === 'idle' && !receptionPreview.isError && client.getQueryState(receptionPreviewKey)?.isInvalidated === false;
  const receptionSource = receptionReady ? receptionPreview.data : null;
  const incidentOwnerKey = ['convenience-return-owner-incident', key];
  const incidentOwner = useQuery({queryKey: incidentOwnerKey, enabled: ownReady && attempt === null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return Service.incidentPreview(uid, transactionId, 'owner', () => {base.assertCurrent(op); choice();});}});
  const incidentOwnerReady = ownReady && attempt === null && incidentOwner.isSuccess && incidentOwner.fetchStatus === 'idle' && !incidentOwner.isError && client.getQueryState(incidentOwnerKey)?.isInvalidated === false;
  const priorTerminal = incidentOwnerReady ? incidentOwner.data.terminal : null;
  const previewKey = ['convenience-return-preview', key];
  const preview = useQuery({queryKey: previewKey, enabled: ownReady && attempt === null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return Service.preview(uid, transactionId, () => {base.assertCurrent(op); choice();}, capability);}});
  const historical = useQuery({queryKey: ['convenience-return-historical', key], enabled: ownReady && attempt === null && !legacyReview,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return Service.preview(uid, transactionId, () => {base.assertCurrent(op); choice();}, CONVENIENCE_RETURN_CAPABILITY);}});
  const historicalReady = base.focused && historical.isSuccess && historical.fetchStatus === 'idle' && !historical.isError && client.getQueryState(['convenience-return-historical', key])?.isInvalidated === false;
  const ready = ownReady && attempt === null && preview.isSuccess && preview.fetchStatus === 'idle' && !preview.isError && client.getQueryState(previewKey)?.isInvalidated === false;
  const source = ready ? preview.data : null, priced = source?.protocol === 'convenience_return_preview_v2';
  const canRequest = !!source?.canRequest && priced;
  const assertQuery = (qKey: readonly unknown[], data: unknown, updatedAt: number) => {
    const state = client.getQueryState(qKey);
    if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== data || state.dataUpdatedAt !== updatedAt) throw convenienceReturnFailure();
  };
  const assertOwn = () => {guard(); if (!ownReady) throw convenienceReturnFailure(); assertQuery(ownKey, own.data, own.dataUpdatedAt);};
  const assertRead = () => {assertOwn(); if (!ready) throw convenienceReturnFailure(); assertQuery(previewKey, preview.data, preview.dataUpdatedAt);};
  const facts = source ? convenienceReturnFacts(source, compact) : [], factsKey = JSON.stringify([key, compact, preview.dataUpdatedAt, source?.source, viewport.width, viewport.height, viewport.fontScale]);
  const [seen, setSeen] = useState<{key: string; ids: string[]}>({key: '', ids: []});
  const seenIds = new Set(seen.key === factsKey ? seen.ids : []), allSeen = facts.length > 0 && facts.every(f => seenIds.has(f.id));
  const [consent, setConsent] = useState<string | null>(null), accepted = consent === factsKey;
  const [formInteraction] = useState(createConvenienceInteraction), formFence = formInteraction.capture();
  const lock = useRef(false), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [result, setResult] = useState<{key: string; receipt: ConvenienceReturnReceipt} | null>(null);
  const receptionKey = JSON.stringify([key, receptionPreview.dataUpdatedAt, receptionSource?.source]), [receptionConsent, setReceptionConsent] = useState<string | null>(null);
  const [receptionResult, setReceptionResult] = useState<{key: string; receipt: ConvenienceReturnReceptionReceipt} | null>(null);
  const onSeen = (ids: string[]) => {try {assertRead(); const available = new Set(facts.map(f => f.id)); setSeen(old => ({key: factsKey, ids: [...new Set([...(old.key === factsKey ? old.ids : []), ...ids.filter(id => available.has(id))])]}));} catch { /* An old viewport grants no consent. */ }};
  const refresh = () => {try {guard(); formInteraction.invalidate(); currentFrame.interaction.invalidate(); setConsent(null); setRevision(n => n + 1);} catch { /* Old activity cannot refresh a replacement order. */ }};
  const selectVersion = (legacy: boolean) => {try {guard(); formInteraction.invalidate(); currentFrame.interaction.invalidate(); setConsent(null); setLegacyReview(legacy);} catch { /* An old reader cannot change a replacement order. */ }};
  const submit = async (action: ConvenienceReturnCommand['action']) => {
    if (lock.current || !source?.source || !allSeen || !accepted || !(action === 'request' ? canRequest : source.canRespond)) return;
    let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key); setNotice(null);
    const command: ConvenienceReturnCommand = {action, sourceHash: source.source.sourceHash, expectedVersion: action === 'request' ? 0 : 1,
      proposalId: action === 'request' ? null : source.proposal?.proposalId ?? null, conditionsAcknowledged: true,
      ...(priced ? {termsProtocol: 'convenience_return_terms_v2' as const} : {})};
    const current = () => {base.assertCurrent(op); assertRead(); formFence(); if (!accepted || !allSeen) throw convenienceReturnFailure();};
    try {
      current(); const payloadHash = await productReviewHash(command); current();
      const a: ConvenienceReturnAttempt = {version: 1, uid, transactionId, requestId: randomUUID(), capability, payloadHash, command};
      const receipt = await Journal.execute(a, current, async () => {current(); const fresh = await Service.preview(uid, transactionId, current, capability); current();
        if (!productReviewEqual(fresh, source) || !(action === 'request' ? fresh.canRequest : fresh.canRespond)) throw convenienceReturnFailure();});
      current(); setResult({key, receipt}); onRecorded?.();
    } catch (error) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: error instanceof Error ? error.message : convenienceReturnFailure().message});} catch { /* No old error on a new order. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void own.refetch(); void client.invalidateQueries({queryKey: previewKey});} base.finish(op); lock.current = false;}
  };
  const recover = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!attempt || lock.current) return; let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key);
    const current = () => {base.assertCurrent(op); assertOwn();};
    try {current(); const receipt = await Journal[mode](attempt, current); current(); setResult({key, receipt}); if (mode === 'acknowledge') onRecorded?.();}
    catch (error) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: error instanceof Error ? error.message : convenienceReturnFailure().message});} catch { /* Stale owner callback. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void own.refetch(); void client.invalidateQueries({queryKey: previewKey});} base.finish(op); lock.current = false;}
  };
  const prepareShipping = async () => {
    if (lock.current || !priced || source?.state !== 'accepted' || source.role !== 'buyer' || !source.proposal || !source.sourceCurrentlyMatches) return;
    let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key); setNotice(null);
    const current = () => {base.assertCurrent(op); assertRead();};
    try {
      current(); const fresh = await Service.preview(uid, transactionId, current, PRICED_CONVENIENCE_RETURN_CAPABILITY); current();
      if (!productReviewEqual(fresh, source)) throw convenienceReturnFailure();
      const r = await TransactionService.requestReturn(transactionId, 'change_of_mind', uid, current, undefined, false,
        {proposalId: source.proposal.proposalId, contentHash: source.proposal.contentHash, termsProtocol: 'convenience_return_terms_v2'}); current();
      setNotice({key, text: r.status === 'closed' ? 'Cette ancienne demande est clôturée. Relisez son reçu exact dans le suivi et acquittez l’ancienne intention avant de préparer explicitement une nouvelle demande.' : r.quote ? 'Le devis du retour est enregistré. Relisez son prix article, ses frais déduits et son net dans le suivi de cette commande avant de confirmer l’étiquette.' : r.labelCommitted ? 'Une étiquette appartient déjà à ce retour. Relisez le même retour dans le suivi avant toute action.' : 'La préparation du même retour reste à vérifier dans le suivi. Aucune nouvelle demande n’est envoyée.'}); onRecorded?.();
    } catch (e) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: e instanceof Error ? e.message : convenienceReturnFailure().message});} catch { /* Old preparation result is not adopted. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void client.invalidateQueries({queryKey: ['return-request']});} base.finish(op); lock.current = false;}
  };
  const assertReceptionOwn = () => {assertOwn(); if (!receptionOwnReady) throw convenienceReturnFailure(); assertQuery(receptionOwnKey, receptionOwn.data, receptionOwn.dataUpdatedAt);};
  const assertReceptionRead = () => {assertReceptionOwn(); if (!receptionReady) throw convenienceReturnFailure(); assertQuery(receptionPreviewKey, receptionPreview.data, receptionPreview.dataUpdatedAt);};
  const declareReception = async () => {
    if (lock.current || !receptionSource?.canConfirm || !receptionSource.source || receptionConsent !== receptionKey) return;
    let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key); setNotice(null);
    const source = receptionSource.source, current = () => {base.assertCurrent(op); assertReceptionRead(); formFence(); if (receptionConsent !== receptionKey) throw convenienceReturnFailure();};
    try {
      current(); const command = {action: 'confirm_return_received' as const, ...source, contentConforming: true as const, conditionsAcknowledged: true as const};
      const a: ConvenienceReturnReceptionAttempt = {version: 1, uid, transactionId, requestId: randomUUID(), capability: PRICED_CONVENIENCE_RETURN_CAPABILITY, command, payloadHash: await productReviewHash(command)}; current();
      const receipt = await Journal.executeReception(a, current, async () => {const fresh = await Service.receptionPreview(uid, transactionId, current); current(); if (!productReviewEqual(fresh, receptionSource) || !fresh.canConfirm) throw convenienceReturnFailure();}); current();
      setReceptionResult({key, receipt}); setReceptionConsent(null); onRecorded?.();
    } catch (e) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: e instanceof Error ? e.message : convenienceReturnFailure().message});} catch { /* No stale reception result. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void receptionOwn.refetch(); void client.invalidateQueries({queryKey: receptionPreviewKey});} base.finish(op); lock.current = false;}
  };
  const recoverReception = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!receptionAttempt || lock.current) return; let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key);
    const current = () => {base.assertCurrent(op); assertReceptionOwn();};
    try {const receipt = await (mode === 'observe' ? Journal.observeReception : mode === 'neutralize' ? Journal.neutralizeReception : Journal.acknowledgeReception)(receptionAttempt, current); current(); setReceptionResult({key, receipt}); if (mode === 'acknowledge') onRecorded?.();}
    catch (e) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: e instanceof Error ? e.message : convenienceReturnFailure().message});} catch { /* No stale receipt adoption. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void receptionOwn.refetch(); void client.invalidateQueries({queryKey: receptionPreviewKey});} base.finish(op); lock.current = false;}
  };
  if(compact){
    const status={none:'Demander un retour',pending:'Réponse du vendeur attendue',accepted:'Retour accepté',refused:'Retour refusé',unknown:'Retour à vérifier'},receiptMessage=(value:ConvenienceReturnReceipt)=>value.state==='committed'?'Votre choix a été enregistré.':value.state==='absent'?'L’envoi reste à vérifier.':value.state==='neutralized'?'Cette demande ne sera pas envoyée.':'Cette demande n’a pas été envoyée.',receptionMessage=(value:ConvenienceReturnReceptionReceipt)=>value.state==='committed'?'La réception de l’article est enregistrée.':value.state==='absent'?'L’envoi de votre déclaration reste à vérifier.':value.state==='neutralized'?'Cette déclaration ne sera pas envoyée.':'Cette déclaration n’a pas été envoyée.';
    const shortNotice=notice?.text.startsWith('Le devis du retour est enregistré')?'Les frais de retour sont prêts. Consultez le devis pour continuer.':notice?.text.startsWith('Cette ancienne demande est clôturée')?'Cette demande de retour est clôturée.':notice?.text.startsWith('Une étiquette appartient déjà')?'Votre étiquette de retour est disponible dans le suivi.':notice?.text.startsWith('La préparation du même retour')?'La préparation du retour reste à vérifier.':'Impossible de confirmer cette action pour le moment. Vérifiez son état avant de réessayer.';
    return <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>Retour pour changement d’avis</Text>
      {priorTerminal?<Text style={styles.caption}>{priorTerminal.providerOutcome==='purchased_unfurnished'||priorTerminal.providerOutcome==='unknown'?'L’étiquette de cette ancienne demande est indisponible. Contactez Seconde pour poursuivre.':'L’ancienne demande est clôturée.'}</Text>:null}
      {!ownReady?<Text accessibilityRole={own.isError?'alert':undefined} style={styles.caption}>{own.isError?'Impossible de retrouver votre demande.':'Chargement du retour…'}</Text>:attempt?<View style={styles.section}>
        <Text style={styles.body}>{nativeReceipt?receiptMessage(nativeReceipt):'L’envoi reste à vérifier.'}</Text>
        <Button variant="secondary" disabled={busy===key} onPress={()=>void recover('observe')}>Vérifier ma demande</Button>
        {nativeReceipt?.state==='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recover('neutralize')}>Arrêter cet envoi</Button>:null}
        {nativeReceipt&&nativeReceipt.state!=='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recover('acknowledge')}>Terminer ce suivi</Button>:null}
      </View>:null}
      {ownReady&&!attempt&&!legacyReview&&((historicalReady&&historical.data.state!=='none')||historical.isError)?<Button variant="ghost" disabled={busy===key} onPress={()=>selectVersion(true)}>Voir la demande précédente</Button>:null}
      {ownReady&&!attempt&&legacyReview?<><Text style={styles.caption}>Cette ancienne demande conserve les conditions acceptées à l’époque.</Text><Button variant="ghost" disabled={busy===key} onPress={()=>selectVersion(false)}>Revenir au retour actuel</Button></>:null}
      {source?<>
        <Text style={styles.body}>{status[source.state]}</Text>
        {priced&&source.state==='accepted'&&source.role==='buyer'?<><Text style={styles.caption}>Les frais de retour seront déduits du remboursement du prix de l’article. Vous verrez le montant avant de confirmer l’étiquette.</Text><Button disabled={!source.sourceCurrentlyMatches||busy===key} onPress={()=>void prepareShipping()}>Préparer mon retour</Button></>:null}
        {canRequest||source.canRespond?<>
          {facts.length?<ConvenienceReturnFacts key={factsKey} facts={facts} compact onSeen={onSeen} onReviewOpened={()=>{assertRead();formInteraction.invalidate();setConsent(null);}} onReviewClosed={()=>{try{assertRead();formInteraction.invalidate();setConsent(null);}catch{/* Old review cannot grant consent. */}}}/>:<Text style={styles.caption}>Les détails de ce retour sont indisponibles.</Text>}
          {!allSeen?<Text style={styles.caption}>Vérifiez les détails du retour avant de confirmer.</Text>:null}
          <Checkbox checked={accepted} disabled={!allSeen||busy===key} onToggle={()=>{try{assertRead();if(allSeen){formInteraction.invalidate();setConsent(accepted?null:factsKey);}}catch{/* Stale consent is discarded. */}}}><Text style={styles.body}>{priced?(source.role==='buyer'?'Je déclare l’article conforme. Je demande ce retour à mes frais, avec remboursement du prix de l’article uniquement.':'J’ai lu les détails. L’acheteur paie le retour et le remboursement concerne uniquement le prix de l’article.'):(source.role==='buyer'?'Je déclare l’article conforme et demande l’accord du vendeur sur les détails présentés.':'J’ai lu les détails de l’article, du trajet et du colis. Mon choix porte sur le principe du retour.')} {priced?'L’étiquette et le remboursement seront confirmés séparément.':'Les frais et le remboursement restent à convenir séparément.'}</Text></Checkbox>
          {(canRequest?['request']as const:['accept','refuse']as const).map(action=><Button key={action} variant={action==='refuse'?'ghost':'primary'} disabled={!allSeen||!accepted||busy===key} onPress={()=>void submit(action)}>{busy===key?'Envoi…':action==='request'?'Demander le retour':action==='accept'?'Accepter le retour':'Refuser le retour'}</Button>)}
        </>:source.state==='refused'?<Text style={styles.caption}>Vous pouvez toujours signaler un problème avec l’article ou contacter Seconde.</Text>:null}
      </>:ownReady&&!attempt?<Text accessibilityRole={preview.isError?'alert':undefined} style={styles.caption}>{preview.isFetching?'Chargement des détails du retour…':'Impossible de charger ce retour pour le moment.'}</Text>:null}
      {receptionAttempt?<View style={styles.section}>
        <Text style={styles.title}>Réception du retour</Text><Text style={styles.body}>{receptionReceipt?receptionMessage(receptionReceipt):'L’envoi de votre déclaration reste à vérifier.'}</Text>
        <Button variant="secondary" disabled={busy===key} onPress={()=>void recoverReception('observe')}>Vérifier ma déclaration</Button>
        {receptionReceipt?.state==='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recoverReception('neutralize')}>Arrêter cet envoi</Button>:null}
        {receptionReceipt&&receptionReceipt.state!=='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recoverReception('acknowledge')}>Terminer ce suivi</Button>:null}
      </View>:receptionSource?.source?<View style={styles.section}>
        <Text style={styles.title}>Réception du retour</Text>
        {receptionSource.state==='recorded'?<Text style={styles.body}>Le vendeur a confirmé la réception de l’article conforme. Le remboursement sera confirmé séparément.</Text>:null}
        {receptionSource.canConfirm?<>
          <Checkbox checked={receptionConsent===receptionKey} disabled={busy===key} onToggle={()=>{try{assertReceptionRead();formInteraction.invalidate();setReceptionConsent(receptionConsent===receptionKey?null:receptionKey);}catch{/* Stale source cannot grant consent. */}}}><Text style={styles.body}>Je confirme avoir reçu l’article retourné conforme. Le remboursement sera traité séparément.</Text></Checkbox>
          <Button disabled={busy===key||receptionConsent!==receptionKey} onPress={()=>void declareReception()}>Confirmer la réception</Button>
        </>:null}
      </View>:null}
      {receptionOwn.isError||receptionPreview.isError?<Text style={styles.caption}>Impossible de vérifier la réception du retour pour le moment.</Text>:null}
      {receptionResult?.key===key?<Text style={styles.caption}>{receptionMessage(receptionResult.receipt)}</Text>:null}
      {result?.key===key?<Text style={styles.caption}>{receiptMessage(result.receipt)}</Text>:null}
      {notice?.key===key?<Text accessibilityRole="alert" style={styles.caption}>{shortNotice}</Text>:null}
      <Button variant="ghost" disabled={!base.focused||busy===key} onPress={refresh}>Actualiser</Button>
      <Button variant="ghost" disabled={!base.focused||busy===key} onPress={()=>{try{guard();router.push({pathname:'/settings/support',params:{transactionId,kind:'commercial_late'}}as never);}catch{/* Support independently qualifies access. */}}}>Contacter Seconde</Button>
    </View>;
  }
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Retour pour changement d’avis</Text>
    <Text style={styles.body}>Pour un article conforme, le retour dépend de l’accord explicite du vendeur. La demande seule ne gèle aucun fonds. Les recours pour non-conformité et le support restent accessibles.</Text>
    {priorTerminal ? <View style={styles.section}><Text style={styles.title}>Ancienne demande clôturée</Text><Text selectable style={styles.caption}>Demande {priorTerminal.returnRequestId} · clôture {priorTerminal.terminalId}.</Text><Text style={styles.body}>{priorTerminal.providerOutcome === 'purchased_unfurnished' ? 'L’acquisition de l’étiquette est prouvée, mais son document n’a pas été fourni. Seconde assume son coût ; cette clôture ne prouve aucun remboursement.' : priorTerminal.providerOutcome === 'unknown' ? 'Seconde assume le risque d’un éventuel coût d’étiquette ; le résultat fournisseur reste inconnu. La clôture ne prouve pas une absence d’achat ni un remboursement.' : priorTerminal.providerOutcome === 'validation_rejected' ? 'Le rejet de validation de cette tentative fournisseur est enregistré.' : 'La demande a été clôturée avant invocation d’un achat pour cette tentative.'} L’ancien reçu reste consultable. Une nouvelle préparation nécessite une nouvelle demande explicite, sa qualification et l’acceptation de son devis.</Text></View> : null}
    {!ownReady ? <Text accessibilityRole={own.isError ? 'alert' : undefined} style={styles.caption}>{own.isError ? 'Votre intention conservée ou son reçu ne peut pas être relu. Aucune nouvelle demande n’est envoyée.' : 'Lecture de votre intention conservée et de son propre reçu…'}</Text> : attempt ? <View style={styles.section}>
      <Text selectable style={styles.caption}>Intention conservée {attempt.requestId} · {actions[attempt.command.action]}</Text>
      <Text style={styles.body}>{nativeReceipt ? receiptText(nativeReceipt) : 'Résultat inconnu.'}</Text>
      {nativeReceipt?.recordedAt ? <Text style={styles.caption}>Reçu natif du {nativeReceipt.recordedAt}.</Text> : null}
      <Button variant="secondary" disabled={busy === key} onPress={() => void recover('observe')}>Relire exactement cette intention</Button>
      {nativeReceipt?.state === 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recover('neutralize')}>Neutraliser cette intention avant exécution</Button> : null}
      {nativeReceipt && nativeReceipt.state !== 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recover('acknowledge')}>Reconnaître ce reçu après une nouvelle lecture</Button> : null}
    </View> : null}
    {ownReady && !attempt && !legacyReview ? <>
      {historicalReady && historical.data.state !== 'none' ? <Text style={styles.caption}>Accord documentaire antérieur : {stateLabel[historical.data.state]}. Ses coûts et son remboursement restent non décidés ; il ne vaut pas acceptation des nouvelles conditions.</Text> : historical.isError ? <Text style={styles.caption}>L’accord documentaire antérieur ne peut pas être relu. Aucun accord ancien n’est transformé en acceptation des nouvelles conditions.</Text> : null}
      {(historicalReady && historical.data.state !== 'none') || historical.isError ? <Button variant="secondary" disabled={busy === key} onPress={() => selectVersion(true)}>Consulter l’accord documentaire antérieur</Button> : null}
    </> : null}
    {ownReady && !attempt && legacyReview ? <><Text style={styles.caption}>Lecture de l’ancien accord documentaire. Les coûts et le remboursement restent à instruire selon ses propres conditions. Une réponse à cet accord n’accepte pas les nouvelles conditions tarifées.</Text><Button variant="secondary" disabled={busy === key} onPress={() => selectVersion(false)}>Lire les nouvelles conditions du retour</Button></> : null}
    {source ? <>
      <Text style={styles.body}>{stateLabel[source.state]}</Text>
      {source.state === 'accepted' ? <Text style={styles.caption}>{priced ? 'Retour accepté par le vendeur aux conditions tarifées affichées. Consultez les instructions de cette commande avant d’expédier. Cet accord ne confirme ni le paiement de l’étiquette ni le remboursement.' : 'Le vendeur accepte le principe du retour. La répartition et le financement des coûts restent à instruire. Aucune étiquette ni aucun remboursement ne sont créés depuis cet accord.'}</Text> : null}
      {priced && source.state === 'accepted' && source.role === 'buyer' ? <><Text style={styles.caption}>Le devis distinct précisera les frais de retour déduits du prix article et le net prévu. La préparation peut retenir les fonds ; elle ne crée pas l’étiquette sans votre confirmation du devis.</Text><Button variant="secondary" disabled={!source.sourceCurrentlyMatches || busy === key} onPress={() => void prepareShipping()}>Préparer ou relire le devis de ce retour</Button></> : null}
      {facts.length ? <><Text style={styles.caption}>Conditions affichées dans le lecteur dédié : {seenIds.size} / {facts.length}. Parcourez toutes les lignes, puis déclarez explicitement les avoir lues avant de choisir.</Text><ConvenienceReturnFacts key={factsKey} facts={facts} onSeen={onSeen} onReviewOpened={() => {assertRead(); formInteraction.invalidate(); setConsent(null);}} onReviewClosed={() => {try {assertRead(); formInteraction.invalidate(); setConsent(null);} catch { /* Closing an old surface grants no consent. */ }}}/></> : <Text style={styles.caption}>Les conditions natives ne peuvent pas être qualifiées. Demandez un examen humain.</Text>}
      {canRequest || source.canRespond ? <>
        <Checkbox checked={accepted} disabled={!allSeen || busy === key} onToggle={() => {try {assertRead(); if (allSeen) {formInteraction.invalidate(); setConsent(accepted ? null : factsKey);}} catch { /* Stale consent is discarded. */ }}}>
          <Text style={styles.body}>{priced ? source.role === 'buyer' ? 'Je déclare l’article conforme et demande ce retour aux conditions affichées : retour à ma charge et remboursement du prix de l’article uniquement.' : 'J’ai lu les conditions : l’acheteur paie le retour et le remboursement prévu porte uniquement sur le prix de l’article.' : source.role === 'buyer' ? 'Je déclare cet article conforme et demande l’accord du vendeur sur les conditions affichées.' : 'J’ai lu l’article figé, le trajet, le colis et les limites. Mon choix concerne seulement le principe du retour.'} {priced ? 'Le paiement du retour et l’exécution du remboursement nécessitent une instruction distincte.' : 'Les frais et le remboursement nécessitent une instruction distincte.'}</Text>
        </Checkbox>
        {(canRequest ? ['request'] as const : ['accept', 'refuse'] as const).map(action => <Button key={action} variant={action === 'refuse' ? 'secondary' : 'primary'} disabled={!allSeen || !accepted || busy === key} onPress={() => void submit(action)}>{priced && action === 'accept' ? 'Accepter explicitement ces conditions de retour' : actions[action]}</Button>)}
      </> : <Text style={styles.caption}>{source.state === 'refused' ? 'Le refus concerne le changement d’avis. Vous pouvez toujours signaler une non-conformité ou demander un examen humain.' : 'Aucun nouvel accord n’est proposé dans cette lecture. Les conditions, la source et les permissions sont requalifiées pour chaque nouvelle demande.'}</Text>}
    </> : ownReady && !attempt ? <Text accessibilityRole={preview.isError ? 'alert' : undefined} style={styles.caption}>{preview.isFetching ? 'Lecture des conditions natives de cette vente…' : 'Les conditions actuelles ne peuvent pas être qualifiées. Votre journal reste indépendant de cette admission.'}</Text> : null}
    {receptionAttempt ? <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Votre déclaration de réception conservée</Text><Text selectable style={styles.caption}>Référence {receptionAttempt.requestId} · retour {receptionAttempt.command.returnRequestId}.</Text><Text style={styles.body}>{receptionReceipt ? receptionText(receptionReceipt) : 'Résultat inconnu ; la même référence est conservée.'}</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => void recoverReception('observe')}>Relire cette déclaration exacte</Button>
      {receptionReceipt?.state === 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recoverReception('neutralize')}>Neutraliser cette intention avant exécution</Button> : null}
      {receptionReceipt && receptionReceipt.state !== 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recoverReception('acknowledge')}>Reconnaître le reçu après une nouvelle lecture</Button> : null}
    </View> : receptionSource?.source ? <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Réception du retour par le vendeur</Text><Text style={styles.body}>{receptionSource.state === 'recorded' ? 'Le vendeur a déclaré avoir reçu l’article retourné conforme. Cette déclaration reste distincte du suivi transporteur et du remboursement.' : 'Le suivi du transporteur ne confirme ni le contenu du colis ni sa conformité. Le vendeur doit déclarer sa réception réelle ; une instruction financière distincte précède tout remboursement.'}</Text>
      {receptionSource.reception ? <Text selectable style={styles.caption}>Déclaration {receptionSource.reception.receptionRequestId} · retour {receptionSource.reception.requestId}.</Text> : null}
      {receptionSource.canConfirm ? <><Checkbox checked={receptionConsent === receptionKey} disabled={busy === key} onToggle={() => {try {assertReceptionRead(); formInteraction.invalidate(); setReceptionConsent(receptionConsent === receptionKey ? null : receptionKey);} catch { /* A stale source grants no declaration. */ }}}><Text style={styles.body}>Je déclare avoir reçu l’article retourné conforme pour ce retour. Je comprends que cette déclaration ne confirme aucun remboursement.</Text></Checkbox><Button disabled={busy === key || receptionConsent !== receptionKey} onPress={() => void declareReception()}>Enregistrer ma déclaration de réception</Button></> : null}
      {receptionSource.role === 'seller' ? <Text style={styles.caption}>Si le colis n’est pas reçu ou si son contenu pose problème, ne confirmez pas sa conformité. Utilisez l’accès au support ci-dessous pour cette commande.</Text> : null}
    </View> : receptionReady && receptionSource?.state === 'unknown' && priced && source?.state === 'accepted' ? <Text style={styles.caption}>La réception et ses sources ne sont pas encore qualifiées. Aucun scan n’est converti en réception conforme ni en remboursement.</Text> : null}
    {receptionOwn.isError || receptionPreview.isError ? <Text style={styles.caption}>La déclaration de réception reste à rapprocher. Votre intention exacte est conservée ; aucune nouvelle déclaration n’est envoyée.</Text> : null}
    {receptionResult?.key === key ? <Text style={styles.caption}>{receptionText(receptionResult.receipt)}</Text> : null}
    {result?.key === key ? <Text style={styles.caption}>{receiptText(result.receipt)}</Text> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <Button variant="secondary" disabled={!base.focused || busy === key} onPress={refresh}>Relire cette demande et son journal</Button>
    <Button variant="ghost" disabled={!base.focused || busy === key} onPress={() => {try {guard(); router.push({pathname: '/settings/support', params: {transactionId, kind: 'commercial_late'}} as never);} catch { /* Destination independently admits the owner. */ }}}>Demander un examen humain</Button>
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm}, section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
