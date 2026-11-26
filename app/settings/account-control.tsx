import {useRef, useState} from 'react';
import {Alert, AppState, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useLocalSearchParams, useRouter, type Href} from 'expo-router';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {Button, Input, ScreenHeader} from '@/components/ui';
import {AccountControlProofDetails} from '@/components/AccountControlProofDetails';
import {AccountControlProofReauthentication} from '@/components/AccountControlProofReauthentication';
import {useSupportProjectionGeneration} from '@/hooks/useSupportProjectionGeneration';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {useAuthSheetStore} from '@/store/authSheetStore';
import {SupportRequestService, newSupportRequestId} from '@/services/supportRequestService';
import {isSupportProjectionCurrent} from '@/services/supportProjectionGuard';
import {AccountControlProofService as Service, accountControlFailure, accountControlId, isAccountControlInvitation, isAccountControlReference} from '@/services/accountControlProofService';
import {AccountControlProofJournal as Journal} from '@/services/accountControlProofJournal';
import {ACCOUNT_CONTROL_STATEMENT, ACCOUNT_CONTROL_STATEMENT_VERSION} from '@/types/accountControlProof';
import type {AccountControlCommand, AccountControlInvitation, AccountControlReference, AccountControlResponse} from '@/types/accountControlProof';
import {colors, spacing, typography} from '@/constants/theme';

type Selection = {kind: 'ticket'; id: string} | {kind: 'invitation'; reference: AccountControlInvitation} | {kind: 'status'; reference: AccountControlReference};
export default function AccountControlScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), client = useQueryClient(), params = useLocalSearchParams<{supportRequestId?: string; accountControlNotice?: string}>();
  const projectionGeneration = useSupportProjectionGeneration();
  let noticeReference: AccountControlReference | null = null;
  try {const value: unknown = typeof params.accountControlNotice === 'string' && params.accountControlNotice.length <= 600 ? JSON.parse(params.accountControlNotice) : null; if (isAccountControlReference(value)) noticeReference = value;} catch {/* Route data grants no native admission. */}
  const context = useLabelLifecycleContext('account-control-proof', uid), lock = useRef(false), editRevision = useRef(0);
  const sessionGeneration = getAuthSessionGeneration(), frameKey = JSON.stringify([uid, sessionGeneration, context.focusRevision]);
  const [form, setForm] = useState({key: frameKey, ticketId: typeof params.supportRequestId === 'string' ? params.supportRequestId : '', invitation: '', accepted: false});
  const [readState, setRead] = useState<{key: string; revision: number; selection: Selection | null; paused: boolean}>({key: frameKey, revision: 0, selection: null, paused: false});
  const [working, setWorking] = useState<string | null>(null), busy = working === frameKey;
  const [notice, setNotice] = useState({key: frameKey, text: ''});
  const [receiptState, setReceipt] = useState<{key: string; response: AccountControlResponse} | null>(null);
  const values = form.key === frameKey ? form : {key: frameKey, ticketId: typeof params.supportRequestId === 'string' ? params.supportRequestId : '', invitation: '', accepted: false};
  const reading = readState.key === frameKey ? readState : {key: frameKey, revision: 0, selection: null, paused: false};
  const edit = (patch: Partial<typeof form>) => {editRevision.current++; setForm({...values, ...patch}); setRead({key: frameKey, revision: reading.revision + 1, selection: null, paused: false}); setReceipt(null); setNotice({key: frameKey, text: ''});};
  const ownKey = ['account-control-journal', uid, frameKey] as const;
  const own = useQuery({queryKey: ownKey, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return Journal.read(op.base.session.uid, () => context.assertCurrent(op));}});
  const ownReady = !!uid && context.focused && own.isSuccess && !own.isFetching && !own.isError;
  const state = ownReady ? own.data : null;
  const previewKey = ['account-control-preview', uid, frameKey, reading.revision, projectionGeneration] as const;
  const preview = useQuery({queryKey: previewKey, enabled: ownReady && !!reading.selection && !reading.paused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), selection = reading.selection; if (!selection) throw accountControlFailure(); const current = () => context.assertCurrent(op);
      if (selection.kind === 'ticket') {const detail = await SupportRequestService.detail(op.base.session.uid, 'owner', selection.id, undefined, current); current();
        if (!isSupportProjectionCurrent(detail) || detail.request.ownerId !== op.base.session.uid || detail.request.kind !== 'account_reconciliation' || detail.request.relatedAccountIds?.length !== 1 || detail.request.relatedAccountIds[0] === op.base.session.uid) throw accountControlFailure();
        return {kind: 'ticket' as const, detail};}
      const response = await Service.read(op.base.session.uid, selection.kind, selection.reference, current); current(); return {kind: 'proof' as const, response};
    }});
  const source = ownReady && !reading.paused && !busy && preview.isSuccess && !preview.isFetching && !preview.isError && (preview.data.kind !== 'ticket' || isSupportProjectionCurrent(preview.data.detail)) ? preview.data : null;
  const proof = source?.kind === 'proof' ? source.response.proof : null;
  const receipt = receiptState?.key === frameKey && context.focused && !busy ? receiptState.response.receipt : null;
  const choose = (selection: Selection) => {try {context.capture(); if (lock.current) return; editRevision.current++; setReceipt(null); setForm({...values, accepted: false}); setRead({key: frameKey, revision: reading.revision + 1, selection, paused: false}); setNotice({key: frameKey, text: ''});} catch {/* The next primary SDK session reads its own source. */}};
  const chooseInvitation = () => {try {const value: unknown = JSON.parse(values.invitation); if (!isAccountControlInvitation(value)) throw accountControlFailure(); choose({kind: 'invitation', reference: value});} catch {setNotice({key: frameKey, text: 'L’invitation doit contenir uniquement la référence du dossier, la preuve acp_… et son code exact. Aucun accès n’est déduit d’un texte invalide.'});}};
  const currentSource = () => {const op = context.capture(), data = preview.data, ownData = own.data, revision = editRevision.current;
    return () => {context.assertCurrent(op); if (!uid || !ownReady || reading.paused || !source || revision !== editRevision.current) throw accountControlFailure();
      for (const [key, value] of [[previewKey, data], [ownKey, ownData]] as const) {const q = client.getQueryState(key); if (!q || q.status !== 'success' || q.fetchStatus !== 'idle' || q.isInvalidated || q.error || client.getQueryData(key) !== value) throw accountControlFailure();}
      if (source.kind === 'ticket' && !isSupportProjectionCurrent(source.detail)) throw accountControlFailure();
    };};
  const build = (action: AccountControlCommand['action']): AccountControlCommand => {
    const base = {supportRequestId: proof?.supportRequestId ?? (source?.kind === 'ticket' ? source.detail.request.id : ''), statementVersion: ACCOUNT_CONTROL_STATEMENT_VERSION, accepted: true as const};
    if (!values.accepted) throw new Error('Lisez et confirmez la déclaration pour cette étape.');
    if (action === 'prepare') {if (source?.kind !== 'ticket' || !source.detail.request.relatedAccountIds?.[0]) throw accountControlFailure(); return {...base, action, expectedCaseVersion: source.detail.request.version, declaredOtherUid: source.detail.request.relatedAccountIds[0]};}
    if (!proof) throw accountControlFailure(); const linked = {...base, proofId: proof.proofId, sourceHash: proof.sourceHash};
    if (action === 'consent_second') {if (reading.selection?.kind !== 'invitation') throw accountControlFailure(); return {...linked, action, invitationCode: reading.selection.reference.invitationCode};}
    if (action === 'finalize_pause') {if (!proof.pauseRequestId) throw accountControlFailure(); return {...linked, action, pauseRequestId: proof.pauseRequestId};}
    return {...linked, action};
  };
  const perform = async (mode: 'observe' | 'resume' | 'neutralize' | 'acknowledge' | AccountControlCommand['action']) => {
    if (!uid || !ownReady || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return;
    const current = () => context.assertCurrent(op); lock.current = true; setWorking(frameKey); setNotice({key: frameKey, text: ''});
    try {
      let response: AccountControlResponse;
      if (mode === 'observe' || mode === 'resume' || mode === 'neutralize' || mode === 'acknowledge') {
        if (!state?.pending) throw accountControlFailure();
        if (mode === 'resume') {const verify = currentSource(); verify(); response = await Journal.resume(state, build(state.pending.descriptor.action), current, verify);}
        else response = await Journal[mode](state, current);
      } else {
        if (state?.pending) throw accountControlFailure(); const verify = currentSource(); verify(); const command = build(mode);
        const attempt = await Service.attempt(uid, newSupportRequestId(), command, current); verify(); response = await Journal.submit(attempt, command, current, verify);
      }
      current(); setReceipt({key: frameKey, response}); setForm({...values, accepted: false, ...(mode === 'consent_second' ? {invitation: ''} : {})});
      setNotice({key: frameKey, text: response.receipt ? 'Reçu exact observé. Relisez-le et acquittez ce suivi avant une autre commande. La situation du dossier se relit séparément.' : 'Issue non enregistrée ou inconnue : conservez cette référence. Observez ou reprenez cette même commande ; aucune étape suivante n’est lancée.'});
      await client.invalidateQueries({queryKey: ['account-control-journal', uid]}); current();
      await client.invalidateQueries({queryKey: ['account-control-preview', uid]}); current();
    } catch (error) {try {current(); setReceipt(null); setNotice({key: frameKey, text: error instanceof Error ? error.message : 'L’issue reste inconnue. Le journal est conservé.'}); await client.invalidateQueries({queryKey: ['account-control-journal', uid]});} catch {/* No old body crosses primary SDK ownership. */}}
    finally {lock.current = false; context.finish(op); if (context.isCurrent(op)) setWorking(null);}
  };
  const logout = () => {if (!uid || lock.current) return; let op; try {op = context.capture();} catch {return;} const generation = getAuthSessionGeneration();
    Alert.alert('Changer de compte Seconde', 'Vos références restent conservées pour chaque compte. Après déconnexion, connectez-vous explicitement avec un moyen déjà lié à l’autre compte. Rien ne sera consenti ou mis en pause automatiquement.', [{text: 'Rester', style: 'cancel'}, {text: 'Me déconnecter', onPress: () => {try {context.assertCurrent(op); void useAuthStore.getState().signOut({expectedUid: uid, expectedGeneration: generation});} catch {/* A late confirmation cannot sign out another user. */}}}]);};
  const login = () => {
    if (!context.focused || AppState.currentState !== 'active' || getAuthSessionGeneration() !== sessionGeneration || auth.currentUser || useAuthStore.getState().authenticatedUid) return;
    useAuthSheetStore.getState().show('Connectez-vous avec un moyen déjà lié au compte choisi.', undefined, {source: 'account_control', gateKey: 'primary_login'});
  };
  const navigate = (path: Href) => {try {context.capture(); router.push(path);} catch {/* Historical obligations use their own current SDK owner. */}};
  return <View style={styles.container}>
    <ScreenHeader title="Conserver un compte, mettre l’autre en pause" onBack={() => router.back()}/>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Ce parcours requiert de vous connecter successivement à deux comptes Seconde : A pour le compte à conserver, B pour celui à mettre en pause. Il ne fusionne ni comptes, contrats ou fonds et ne permet pas d’utiliser les données privées de l’autre compte.</Text>
      {!uid ? <><Text style={styles.body}>Connectez-vous au compte souhaité avec un moyen qui lui est déjà lié. Si tous ses moyens sont perdus, ce parcours ne réattribue pas le compte.</Text><Button onPress={login}>Ouvrir la connexion habituelle</Button></> : <>
        <Text selectable style={styles.caption}>UID de la connexion primaire actuelle : {uid}</Text>
        <AccountControlProofReauthentication key={uid} uid={uid} onStart={() => {editRevision.current++; setReceipt(null); setForm({...values, accepted: false}); setRead({key: frameKey, revision: reading.revision + 1, selection: null, paused: true});}}/>
        <Button variant="secondary" disabled={busy || !context.focused} onPress={logout}>Me déconnecter pour utiliser l’autre compte</Button>
        {notice.key === frameKey && notice.text ? <Text accessibilityRole="alert" selectable style={styles.caption}>{notice.text}</Text> : null}
        {own.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal ne peut pas être qualifié. Les nouvelles commandes restent fermées ; aucune intention n’est remplacée.</Text> : null}
        {state?.pending ? <View style={styles.card}>
          <Text style={styles.body}>Commande conservée : {state.pending.descriptor.action}</Text><Text selectable style={styles.caption}>{state.pending.requestId}{'\n'}{state.pending.descriptor.inputHash}</Text>
          <Text style={styles.caption}>Cette référence n’inclut ni invitation, mot de passe ou contenu privé. Une absence de réponse ne prouve pas que la pause a échoué.</Text>
          <Button disabled={busy || !context.focused} onPress={() => {void perform('observe');}}>Observer cette même commande</Button>
          <Button variant="secondary" disabled={busy || !source || !values.accepted} onPress={() => {void perform('resume');}}>Reprendre le même tuple après relecture exacte</Button>
          <Button variant="secondary" disabled={busy || !context.focused} onPress={() => {void perform('neutralize');}}>Neutraliser uniquement cette intention non exécutée</Button>
          {receipt ? <><Text selectable style={styles.caption}>Reçu {receipt.state} · {receipt.id}{'\n'}{receipt.receiptHash}. Ce reçu ne certifie pas à lui seul la situation actuelle de l’autre compte.</Text><Button variant="secondary" disabled={busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal puis acquitter</Button></> : null}
        </View> : null}
        {params.accountControlNotice !== undefined ? noticeReference ? <Button variant="secondary" disabled={busy || !ownReady} onPress={() => choose({kind: 'status', reference: noticeReference!})}>Relire la preuve actuelle de cet avis avec mon compte</Button> : <Text accessibilityRole="alert" style={styles.caption}>La référence de cet avis ne peut pas être qualifiée. Votre propre journal reste accessible, sans ouvrir le dossier d’un autre compte.</Text> : null}
        {state?.reference ? <Button variant="secondary" disabled={busy || !ownReady} onPress={() => choose({kind: 'status', reference: state.reference!})}>Relire ma preuve et la situation actuelle</Button> : null}
        <View style={styles.card}>
          <Text style={styles.body}>Depuis le compte A à conserver</Text>
          <Button variant="secondary" disabled={busy || !!state?.pending} onPress={() => navigate({pathname: '/settings/support', params: {kind: 'account_reconciliation', accountControl: 'keep_and_pause_v1'}} as never)}>Créer ma demande privée de rapprochement</Button>
          <Text style={styles.caption}>Dans ce dossier, déclarez uniquement l’UID du compte B. Après le dépôt, ouvrez le dossier puis « Conserver ce compte et organiser la pause de l’autre ».</Text>
          <Input label="Référence de mon dossier account_reconciliation" value={values.ticketId} onChangeText={value => edit({ticketId: value})} autoCapitalize="none" maxLength={128} disabled={busy}/>
          <Button variant="secondary" disabled={busy || !ownReady || !accountControlId(values.ticketId)} onPress={() => choose({kind: 'ticket', id: values.ticketId})}>Lire mon dossier natif actuel</Button>
        </View>
        <View style={styles.card}>
          <Text style={styles.body}>Depuis le compte B à mettre en pause</Text>
          <Text style={styles.caption}>Collez l’invitation minimale reçue de A après vous être connecté à B. Aucun jeton d’une autre session n’est demandé ou accepté.</Text>
          <Input label="Invitation de rapprochement — JSON reçu" value={values.invitation} onChangeText={value => edit({invitation: value})} multiline autoCapitalize="none" autoCorrect={false} maxLength={600} disabled={busy}/>
          <Button variant="secondary" disabled={busy || !ownReady || !values.invitation} onPress={chooseInvitation}>Lire cette invitation avec ma connexion primaire</Button>
        </View>
        {preview.isError ? <Text accessibilityRole="alert" style={styles.caption}>L’étape n’est pas disponible pour cette connexion ou ces références. Relisez les références et le même journal ; aucun autre compte n’est recherché.</Text> : null}
        {source?.kind === 'ticket' ? <View style={styles.card}><Text selectable style={styles.body}>Dossier natif {source.detail.request.id} · version {source.detail.request.version} · A : {uid} · B déclaré : {source.detail.request.relatedAccountIds?.[0]}.</Text><Text style={styles.caption}>La déclaration de B ne prouve pas encore sa connexion ou son consentement.</Text></View> : null}
        {source?.kind === 'proof' && !proof ? <Text style={styles.caption}>Cette invitation ou cette étape n’est pas disponible. Aucun accès, lien ou effet n’est déduit.</Text> : null}
        {proof ? <AccountControlProofDetails proof={proof} uid={uid} disabled={busy} guard={currentSource()}/> : null}
        {source ? <View style={styles.card}>
          <Text style={styles.body}>{ACCOUNT_CONTROL_STATEMENT}</Text>
          <Button variant="secondary" disabled={busy} onPress={() => {try {context.capture(); if (lock.current) return; editRevision.current++; setForm({...values, accepted: !values.accepted});} catch {/* Stale consent is discarded. */}}}> {values.accepted ? 'Déclaration confirmée — retirer ma confirmation' : 'Je confirme cette déclaration pour l’étape affichée'} </Button>
          {!state?.pending && source.kind === 'ticket' ? <Button disabled={busy || !values.accepted} onPress={() => {void perform('prepare');}}>Conserver A et préparer son invitation exacte</Button> : null}
          {!state?.pending && proof?.pauseUid === uid && proof.stage === 'awaiting_second_consent' && reading.selection?.kind === 'invitation' ? <Button disabled={busy || !values.accepted} onPress={() => {void perform('consent_second');}}>Enregistrer le consentement de B à cette invitation</Button> : null}
          {!state?.pending && proof?.pauseUid === uid && proof.stage === 'both_consented' ? <Button disabled={busy || !values.accepted} onPress={() => {void perform('pause');}}>Mettre B en pause avec cette commande liée</Button> : null}
          {!state?.pending && proof?.pauseUid === uid && proof.stage === 'paused' ? <Button disabled={busy || !values.accepted} onPress={() => {void perform('finalize_pause');}}>Finaliser ce constat de pause sans fusion</Button> : null}
        </View> : null}
        <Text style={styles.caption}>Le compte en pause conserve l’accès à ses obligations avec sa propre connexion. Reconnectez-vous à A pour relire son constat ; A ne reçoit jamais les commandes ou le portefeuille de B.</Text>
        <Button variant="secondary" disabled={busy} onPress={() => navigate('/my-orders')}>Mes commandes avec ce compte</Button>
        <Button variant="secondary" disabled={busy} onPress={() => navigate('/wallet')}>Mon portefeuille avec ce compte</Button>
        <Button variant="secondary" disabled={busy} onPress={() => navigate('/settings/support' as never)}>Mes dossiers privés avec ce compte</Button>
      </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, card: {gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
