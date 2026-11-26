import {useLayoutEffect, useRef, useState} from 'react';
import {AppState, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {File} from 'expo-file-system';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {AuthService} from '@/services/authService';
import {ACCOUNT_SUPPORT_KINDS, SupportAccountReviewService, newSupportRequestId, supportError} from '@/services/supportRequestService';
import {productReviewEncodeBytes} from '@/services/productReviewEvidenceService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {prepareImageForUpload} from '@/utils/imageUtils';
import type {SupportAccountEvidencePurpose, SupportAccountReviewOpaqueReceiptV2, SupportRequest, SupportScope} from '@/types/supportRequest';
import {colors, radius, spacing, typography} from '@/constants/theme';

const purposeLabels: Record<SupportAccountEvidencePurpose, string> = {identity: 'Identité', activity: 'Activité réellement en cause', regulatory_basis: 'Fondement et textes applicables', authority: 'Pouvoir de représentation', relationship: 'Lien entre comptes', provider_restriction: 'Restriction du compte de paiement', other: 'Autre pièce utile'};
/** JPEGs and the original retry payload remain volatile. The native receipt, not
 * a timeout or a preview, establishes whether a private file was registered. */
export function SupportAccountEvidenceUpload({uid, scope = 'owner', request, sourceKey, disabled = false, assertSelection, onUploaded}: {
  uid: string; scope?: SupportScope; request: SupportRequest | null; sourceKey: string; disabled?: boolean; assertSelection: () => void; onUploaded?: () => void;
}) {
  const identity = JSON.stringify([uid, getAuthSessionGeneration(), sourceKey, request?.id, request?.version]);
  const frame = useLabelLifecycleContext(`support-account-upload:${identity}`, uid), picker = useShippingPurchaseContext(`support-account-picker:${identity}`, uid);
  const [purpose, setPurpose] = useState<SupportAccountEvidencePurpose>('other'), [password, setPassword] = useState('');
  const [state, setState] = useState({key: identity, busy: false, notice: ''});
  const [receipt, setReceipt] = useState<SupportAccountReviewOpaqueReceiptV2 | null>(null);
  const [retry, setRetry] = useState<{key: string; requestId: string; purpose: SupportAccountEvidencePurpose; jpegBase64: string; sent: boolean} | null>(null);
  const lock = useRef<symbol | null>(null), waits = useRef(new Set<() => void>());
  const latest = useRef({identity, frame, request, assertSelection, disabled, onUploaded});
  useLayoutEffect(() => {latest.current = {identity, frame, request, assertSelection, disabled, onUploaded};});
  useLayoutEffect(() => {lock.current = null; const pendingWaits = waits.current; return () => {for (const cancel of pendingWaits) cancel(); pendingWaits.clear();};}, [identity]);
  const viewKey = JSON.stringify([identity, frame.focusRevision]);
  const [renderKey, setRenderKey] = useState(viewKey);
  if (renderKey !== viewKey) {setRenderKey(viewKey); setRetry(null); setPassword(''); setState({key: identity, busy: false, notice: ''}); setReceipt(null);}
  const currentState = state.key === identity ? state : {key: identity, busy: false, notice: ''};
  const journal = useQuery({queryKey: ['support-account-evidence-v2-journal', uid, getAuthSessionGeneration(), scope, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return SupportAccountReviewService.evidenceJournal(uid, scope, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching ? journal.data : null;
  const valid = request && (ACCOUNT_SUPPORT_KINDS as readonly string[]).includes(request.kind);
  const allowed = !!valid && request.status !== 'answered' && request.status !== 'withdrawn' && !disabled && frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError && (!pending || retry?.requestId === pending.requestId);
  const provider = AuthService.getAuthProvider(), passwordAvailable = AuthService.hasPasswordProvider();
  const passwordLogin = provider === 'password' || passwordAvailable && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios');
  const recent = async () => {const user = auth.currentUser; if (!user || user.uid !== uid) throw new Error('La session a changé.'); const result = await user.getIdTokenResult(true); const at = result.claims.auth_time, now = Math.floor(Date.now() / 1000); return auth.currentUser === user && typeof at === 'number' && Number.isSafeInteger(at) && at > 0 && at <= now && now - at <= 300;};
  const run = async (mode: 'pick' | 'retry' | 'reauth') => {
    if (!allowed || !request || lock.current || AppState.currentState !== 'active') return;
    let choice; try {choice = picker.start(); assertSelection();} catch {return;} if (!choice) return;
    const ticket = Symbol(), owner = auth.currentUser, chosenPurpose = purpose; lock.current = ticket;
    const update = (notice: string, busy: boolean) => {if (latest.current.identity === identity) setState({key: identity, notice, busy});};
    update('', true);
    const pickerGuard = () => {picker.assertCurrent(choice); if (latest.current.identity !== identity || auth.currentUser !== owner) throw new Error('La sélection a changé.');};
    const returned = async () => {pickerGuard(); if (AppState.currentState !== 'active') await new Promise<void>((resolve, reject) => {
      const cleanup = () => {subscription.remove(); waits.current.delete(cancel);};
      const cancel = () => {cleanup(); reject(new Error('Le choix de la pièce a été interrompu.'));};
      const subscription = AppState.addEventListener('change', value => {if (value === 'active') {cleanup(); resolve();}}); waits.current.add(cancel);
      if (AppState.currentState === 'active') {cleanup(); resolve();}
    }); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); pickerGuard();};
    let prepared: File | null = null;
    try {
      if (mode === 'reauth') {
        if (passwordLogin) {if (!password) throw new Error('Entrez votre mot de passe.'); await AuthService.reauthenticate(password, pickerGuard);}
        else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(pickerGuard);
        else if (provider === 'apple.com' && Platform.OS === 'ios') await AuthService.reauthenticateWithApple(pickerGuard);
        else throw new Error('Reconnectez-vous avec un moyen déjà lié disponible sur cet appareil.');
        await returned(); if (!await recent()) throw new Error('La connexion récente ne peut pas être confirmée.'); pickerGuard(); update('Identité confirmée. Relisez le dossier actuel puis choisissez la pièce à joindre.', false); return;
      }
      if (!await recent()) throw new Error('Confirmez votre identité avec votre moyen de connexion déjà lié avant de joindre la pièce.'); pickerGuard();
      let payload = mode === 'retry' && retry?.key === identity ? retry : null;
      if (!payload) {
        if (mode === 'retry') return;
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); await returned();
        if (permission.status !== 'granted') throw new Error('Autorisez l’accès à la photo choisie pour joindre une pièce.');
        const selected = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible}); await returned();
        if (selected.canceled || !selected.assets[0]) return;
        const active = latest.current, operation = active.frame.capture();
        const guard = () => {pickerGuard(); active.frame.assertCurrent(operation); if (latest.current.request?.id !== request.id || latest.current.request?.version !== request.version) throw new Error('Relisez le dossier actuel.');}; guard();
        const uri = await prepareImageForUpload(selected.assets[0].uri, {maxDimension: 1200, quality: 0.75}); guard(); prepared = new File(uri);
        if (!prepared.exists || prepared.size < 4 || prepared.size > 5 * 1024 * 1024) throw new Error('La pièce doit être une image JPEG de moins de 5 Mio après préparation.');
        const bytes = await prepared.bytes(); guard(); payload = {key: identity, requestId: newSupportRequestId(), purpose: chosenPurpose, jpegBase64: productReviewEncodeBytes(bytes), sent: false};
        setRetry(payload); update('Photo préparée sur cet appareil. Relisez le dossier puis confirmez son envoi privé.', false); return;
      }
      const active = latest.current, operation = active.frame.capture();
      const guard = () => {pickerGuard(); active.frame.assertCurrent(operation); latest.current.assertSelection(); if (latest.current.disabled || latest.current.request?.id !== request.id || latest.current.request?.version !== request.version) throw new Error('Relisez le dossier actuel.');}; guard();
      setRetry({...payload, sent: true});
      const result = await SupportAccountReviewService.upload(uid, scope, request, payload.requestId, payload.purpose, payload.jpegBase64, guard); guard();
      setRetry(null); update('protocol' in result ? result.state === 'not_executed' ? 'Cette intention est close sans nouveau dépôt. Une éventuelle copie intermédiaire reste privée et son effacement n’est pas attesté.' : 'Le résultat reste à rapprocher par son reçu exact.' : `Pièce privée enregistrée le ${result.uploadedAt}. Elle doit encore être examinée par l’équipe.`, false); await journal.refetch(); guard(); latest.current.onUploaded?.();
    } catch (error) {try {pickerGuard(); if (AppState.currentState === 'active') {update(supportError(error), false); await journal.refetch();}} catch {/* No callback into another identity or selection. */}}
    finally {if (prepared?.exists) {try {prepared.delete();} catch {/* Only the generated prepared cache is eligible. */}} picker.finish(choice); if (lock.current === ticket) {lock.current = null; if (latest.current.identity === identity) setState(old => old.key === identity ? {...old, busy: false} : old);}}
  };
  const observe = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current || !frame.focused) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return; const ticket = Symbol(); lock.current = ticket; updateReceiptNotice('', true);
    const guard = () => frame.assertCurrent(op);
    try {const result = mode === 'acknowledge' ? await SupportAccountReviewService.acknowledgeEvidence(pending, guard) : await SupportAccountReviewService.evidenceReceipt(pending, mode, guard); guard(); setReceipt(result); if (mode === 'acknowledge') setRetry(null); updateReceiptNotice(result.state === 'committed' ? 'Dépôt privé enregistré par son reçu natif. La pièce reste à examiner.' : result.state === 'not_executed' ? 'Cette intention est close sans nouveau dépôt. Une éventuelle copie de stockage intermédiaire n’est pas déclarée effacée.' : 'Aucun reçu terminal observé. La même référence reste conservée.', false); await journal.refetch(); guard();}
    catch (error) {if (frame.isCurrent(op)) updateReceiptNotice(supportError(error), false);}
    finally {frame.finish(op); if (lock.current === ticket) {lock.current = null; if (frame.isCurrent(op)) setState(old => old.key === identity ? {...old, busy: false} : old);}}
  };
  function updateReceiptNotice(notice: string, busy: boolean) {setState({key: identity, notice, busy});}
  if (!frame.focused) return null;
  return <View style={styles.section}>
    {pending ? <View style={styles.section}><Text style={styles.title}>Dépôt privé à rapprocher</Text><Text selectable style={styles.caption}>Référence {pending.requestId}. Le journal conserve seulement les identifiants, la portée et l’empreinte ; aucune photo, adresse de fichier ou texte.</Text><Button variant="secondary" disabled={currentState.busy} onPress={() => {void observe('observe');}}>Relire le reçu exact de ce dépôt</Button><Button variant="secondary" disabled={currentState.busy} onPress={() => {void observe('neutralize');}}>Arrêter seulement cette intention non exécutée</Button>{receipt?.requestId === pending.requestId && receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={currentState.busy} onPress={() => {void observe('acknowledge');}}>Reconnaître ce reçu terminal</Button> : null}</View> : null}
    {valid ? <><Text accessibilityRole="header" style={styles.title}>Joindre une pièce privée pour l’examen</Text>
    <Text style={styles.caption}>Choisissez uniquement les pages utiles. La photo est réduite et transmise au dossier privé de Seconde ; elle n’est pas publiée dans les annonces ou la messagerie. Une pièce ne prouve pas à elle seule une identité ou un pouvoir.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Objet de la pièce" style={styles.section}>{(Object.keys(purposeLabels) as SupportAccountEvidencePurpose[]).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: purpose === value, disabled: currentState.busy || !!retry}} disabled={currentState.busy || !!retry} style={[styles.choice, purpose === value && styles.selected]} onPress={() => setPurpose(value)}><Text style={styles.body}>{purposeLabels[value]}</Text></Pressable>)}</View>
    {scope === 'owner' ? <>{passwordLogin ? <TextInput accessibilityLabel="Mot de passe pour joindre une pièce privée" style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} editable={!currentState.busy}/> : null}<Button variant="secondary" disabled={!allowed || currentState.busy} onPress={() => {void run('reauth');}}>Confirmer mon identité avec mon moyen déjà lié</Button></> : null}
    {retry?.key === identity ? <><Text style={styles.caption}>{retry.sent ? 'Le résultat de ce dépôt reste inconnu. La même photo et la même référence sont gardées uniquement pendant cette session active. Un arrêt ne prouve pas l’absence d’un dépôt.' : 'La photo préparée reste uniquement en mémoire. Confirmez son envoi au dossier privé actuellement affiché.'}</Text><Button disabled={!allowed || currentState.busy} onPress={() => {void run('retry');}}>{retry.sent ? 'Relire ou reprendre exactement ce dépôt' : 'Envoyer cette photo privée'}</Button></> : <Button disabled={!allowed || currentState.busy || !!pending} onPress={() => {void run('pick');}}>Choisir et joindre une photo privée</Button>}
    </> : null}
    {journal.isError ? <Text style={styles.caption}>Le journal du dépôt ne peut pas être confirmé. Relisez-le avant de joindre une autre pièce.</Text> : null}
    {currentState.notice ? <Text accessibilityRole="alert" style={styles.caption}>{currentState.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md}, choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm}, selected: {backgroundColor: colors.surfaceSubtle, borderColor: colors.primary}});
