import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { AuthService } from '@/services/authService';
import { AccountAccessIntakeService, accountAccessIntakeError, assertAccountAccessContext, captureAccountAccessContext } from '@/services/accountAccessIntakeService';
import { ACCOUNT_ACCESS_INTAKE_STORAGE_NOTICE } from '@/types/accountAccessIntake';
import type { AccountAccessIntakeObservation, AccountAccessPublicContext } from '@/types/accountAccessIntake';
import { colors, radius, spacing, typography } from '@/constants/theme';

interface Operation {context: AccountAccessPublicContext; scopeKey: string; focusEpoch: number}
type Action = 'submit' | 'observe' | 'resume' | 'neutralize' | 'acknowledge';

export default function AccountAccessScreen() {
  const router = useRouter(), queryClient = useQueryClient();
  const {uid, loading, guestId} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, loading: state.isLoading, guestId: state.guestSession?.guestId ?? null})));
  const generation = getAuthSessionGeneration(), scopeKey = JSON.stringify([uid, loading, guestId, generation]);
  const prelogin = !uid && !loading && !!guestId && !auth.currentUser && !useAuthStore.getState().user;
  const scopeRef = useRef(scopeKey), focusRef = useRef({mounted: false, active: false, epoch: 0});
  const operationRef = useRef<Operation | null>(null);
  const resetOperationRef = useRef<Operation | null>(null);
  const [focus, setFocus] = useState({active: false, epoch: 0});
  useLayoutEffect(() => {scopeRef.current = scopeKey; operationRef.current = null; resetOperationRef.current = null;}, [scopeKey]);
  useLayoutEffect(() => {const frame = focusRef.current; frame.mounted = true; return () => {frame.mounted = false;};}, []);
  useFocusEffect(useCallback(() => {
    let activity = AppState.currentState;
    focusRef.current.active = activity === 'active'; focusRef.current.epoch++;
    setFocus({active: focusRef.current.active, epoch: focusRef.current.epoch});
    const subscription = AppState.addEventListener('change', next => {
      if (next === activity) return;
      activity = next; focusRef.current.active = next === 'active'; focusRef.current.epoch++;
      operationRef.current = null; resetOperationRef.current = null;
      setFocus({active: focusRef.current.active, epoch: focusRef.current.epoch});
    });
    return () => {focusRef.current.active = false; focusRef.current.epoch++; operationRef.current = null;
      resetOperationRef.current = null; subscription.remove();
      if (focusRef.current.mounted) setFocus({active: false, epoch: focusRef.current.epoch});};
  }, []));
  const assertCurrent = (operation: Operation) => {
    assertAccountAccessContext(operation.context);
    if (!focusRef.current.mounted || !focusRef.current.active || AppState.currentState !== 'active' || scopeRef.current !== operation.scopeKey || focusRef.current.epoch !== operation.focusEpoch) throw new Error('Le contexte de ce formulaire a changé.');
  };
  const capture = (): Operation => {
    const operation = {context: captureAccountAccessContext(), scopeKey, focusEpoch: focusRef.current.epoch};
    assertCurrent(operation); return operation;
  };
  const isCurrent = (operation: Operation) => {try {assertCurrent(operation); return true;} catch {return false;}};
  const [form, setForm] = useState({scopeKey, replyEmail: '', narrative: ''});
  if (form.scopeKey !== scopeKey) setForm({scopeKey, replyEmail: '', narrative: ''});
  const [workingState, setWorkingState] = useState({scopeKey, focusEpoch: focus.epoch, value: false});
  const working = workingState.scopeKey === scopeKey && workingState.focusEpoch === focus.epoch && workingState.value;
  const [notice, setNotice] = useState({scopeKey, focusEpoch: focus.epoch, text: ''});
  const [resetState, setResetState] = useState({scopeKey, focusEpoch: focus.epoch, email: '', working: false, sent: false, error: ''});
  const resetCurrent = resetState.scopeKey === scopeKey && resetState.focusEpoch === focus.epoch && prelogin && focus.active;
  const resetPassword = async () => {
    if (!resetCurrent || resetState.working || !resetState.email.trim()) return;
    let operation; try {operation = capture();} catch {return;}
    if (resetOperationRef.current && isCurrent(resetOperationRef.current)) return;
    resetOperationRef.current = operation;
    const email = resetState.email.trim();
    setResetState({scopeKey, focusEpoch: focus.epoch, email, working: true, sent: false, error: ''});
    try {
      assertCurrent(operation);
      await AuthService.sendPasswordResetEmail(email);
      if (resetOperationRef.current !== operation || !isCurrent(operation)) return;
      setResetState({scopeKey, focusEpoch: focus.epoch, email, working: false, sent: true, error: ''});
    } catch {
      if (resetOperationRef.current === operation && isCurrent(operation)) setResetState({scopeKey, focusEpoch: focus.epoch, email, working: false, sent: false,
        error: 'L’envoi ne peut pas être confirmé. Vérifiez l’adresse et réessayez. Cette réponse ne confirme pas l’existence d’un compte.'});
    } finally {if (resetOperationRef.current === operation) resetOperationRef.current = null;}
  };
  const openSignIn = () => {
    try {capture();} catch {return;}
    resetOperationRef.current = null;
    setResetState({scopeKey, focusEpoch: focus.epoch, email: '', working: false, sent: false, error: ''});
    useAuthSheetStore.getState().show('Utilisez un moyen de connexion déjà lié à votre compte.', undefined, {source: 'account_access'});
  };
  const queryKey = ['public-account-access', guestId, generation, focus.epoch];
  const query = useQuery({queryKey, enabled: prelogin && focus.active, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = capture(); return AccountAccessIntakeService.read(operation.context, () => assertCurrent(operation));}});
  const ready = prelogin && focus.active && query.isSuccess && !query.isFetching && !query.error;
  const data = ready ? query.data : null, intent = data?.intent, receipt = data?.receipt;

  const perform = async (action: Action) => {
    let operation;
    try {operation = capture();} catch {return;}
    if (operationRef.current && isCurrent(operationRef.current)) return;
    operationRef.current = operation;
    setWorkingState({scopeKey, focusEpoch: focus.epoch, value: true});
    const assertFocus = () => assertCurrent(operation);
    try {
      let result: AccountAccessIntakeObservation;
      if (action === 'submit') result = await AccountAccessIntakeService.submit(operation.context, {replyEmail: form.replyEmail, narrative: form.narrative}, assertFocus);
      else if (action === 'resume') result = await AccountAccessIntakeService.resume(operation.context, assertFocus);
      else if (action === 'neutralize') result = await AccountAccessIntakeService.neutralize(operation.context, assertFocus);
      else if (action === 'acknowledge') result = await AccountAccessIntakeService.acknowledge(operation.context, assertFocus);
      else result = await AccountAccessIntakeService.read(operation.context, assertFocus);
      assertFocus(); queryClient.setQueryData(queryKey, result);
      setNotice({scopeKey, focusEpoch: focus.epoch, text: action === 'acknowledge' ? 'Le reçu terminal a été relu. Le journal, le contact, le récit et la clé de reprise ont été supprimés de ce stockage local. Conservez la référence du reçu si vous souhaitez la communiquer à l’équipe.' : ''});
      if (action === 'acknowledge') setForm({scopeKey, replyEmail: '', narrative: ''});
    } catch (error) {
      if (isCurrent(operation)) {
        setNotice({scopeKey, focusEpoch: focus.epoch, text: accountAccessIntakeError(error)});
        await query.refetch();
      }
    } finally {
      if (operationRef.current === operation) {if (isCurrent(operation)) setWorkingState({scopeKey, focusEpoch: focus.epoch, value: false}); operationRef.current = null;}
    }
  };
  const neutralize = () => {
    let operation;
    try {operation = capture();} catch {return;}
    Alert.alert('Neutraliser l’intention non reçue ?', 'Cette action bloque un envoi tardif de la même intention si aucun dépôt n’a été enregistré. Une demande déjà reçue reste conservée par l’équipe.', [
      {text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {if (isCurrent(operation)) void perform('neutralize');}},
    ]);
  };
  const edit = (key: 'replyEmail' | 'narrative', value: string) => {
    if (!ready || working || intent) return;
    try {capture(); setForm(previous => previous.scopeKey === scopeKey ? {...previous, [key]: value} : previous);} catch { /* Signed-in or changed guest context. */ }
  };
  return <View style={styles.container}>
    <ScreenHeader title="Aide pour accéder à mon compte" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Pour retrouver l’accès, utilisez uniquement un moyen de connexion déjà lié à votre compte. Seconde ne propose aucune récupération manuelle ni réattribution par un opérateur.</Text>
      <Text style={styles.body}>Si tous ces moyens sont perdus, Seconde ne réattribue pas le compte. Les fonds, commandes et recours existants restent conservés selon leurs obligations. Une prise de contact ne permet pas de transmettre les renseignements de ce compte à un nouveau contact déclaré.</Text>
      <Text style={styles.body}>N’indiquez aucun mot de passe, code de connexion, numéro de pièce d’identité ni renseignement bancaire. Aucun document ou photo n’est demandé.</Text>
      {!prelogin ? <View style={styles.card}>
        <Text style={styles.body}>{loading ? 'Initialisation de la session…' : uid || auth.currentUser ? 'Une identité est maintenant connectée. Le formulaire, le récit et le reçu locaux sont masqués ; cette demande n’est pas rattachée à ce compte.' : 'La session invitée nécessaire à la conservation locale n’est pas encore disponible.'}</Text>
        {!!uid && <Button variant="secondary" onPress={() => router.push('/settings/support' as never)}>Mes demandes privées pour ce compte</Button>}
      </View> : <>
        <View style={styles.card}>
          <Text style={styles.title}>Réinitialiser un mot de passe déjà associé</Text>
          <Text style={styles.body}>Si votre compte utilise un mot de passe et que vous avez accès à son courriel associé, demandez les instructions de réinitialisation. Ce courriel est distinct du contact déclaré dans le formulaire d’assistance.</Text>
          <Input label="Courriel associé au moyen de connexion" value={resetCurrent ? resetState.email : ''}
            onChangeText={email => {try {capture(); if (!resetCurrent || !resetState.working) setResetState({scopeKey, focusEpoch: focus.epoch, email, working: false, sent: false, error: ''});} catch {/* Guest frame only. */}}}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={320} disabled={!focus.active || resetCurrent && resetState.working} />
          <Button disabled={!focus.active || !resetCurrent || resetState.working || !resetState.email.trim()} loading={resetCurrent && resetState.working} onPress={() => {void resetPassword();}}>Demander les instructions de réinitialisation</Button>
          {resetCurrent && resetState.sent ? <Text style={styles.body}>Demande prise en compte. Si cette adresse permet une réinitialisation, vous recevrez les instructions par courriel. Consultez aussi les indésirables. Cette réponse ne confirme pas l’existence d’un compte.</Text> : null}
          {resetCurrent && resetState.error ? <Text accessibilityRole="alert" style={styles.body}>{resetState.error}</Text> : null}
          <Text style={styles.body}>Pour Google ou Apple, utilisez le même compte fournisseur déjà lié à Seconde. Une autre identité peut créer un compte distinct ; elle ne récupère pas vos anciens fonds ou commandes. Aucun accès par numéro de téléphone de profil n’est proposé.</Text>
          <Button variant="secondary" disabled={!focus.active} onPress={openSignIn}>Ouvrir la connexion avec un moyen déjà lié</Button>
        </View>
        <Text style={styles.title}>Déclarer une difficulté à l’assistance</Text>
        <Text style={styles.body}>Vous pouvez indiquer un courriel auquel vous avez accès et décrire brièvement la difficulté. Ce dépôt sert au suivi de votre prise de contact ; il ne prouve pas votre identité, ne rétablit aucun accès et ne permet pas de changer les moyens de connexion d’un compte.</Text>
        <Text style={styles.caption}>{ACCOUNT_ACCESS_INTAKE_STORAGE_NOTICE}</Text>
        <Text style={styles.caption}>La reprise est limitée à cette session invitée sur cet appareil. La connexion ne rattache pas la demande à un compte.</Text>
        {notice.scopeKey === scopeKey && notice.focusEpoch === focus.epoch && notice.text ? <Text selectable style={styles.body}>{notice.text}</Text> : null}
        {!ready ? <Text style={styles.body}>{query.isError ? 'Le journal ou son reçu ne peut pas être relu. Une intention conservée n’est ni effacée ni remplacée ; aucune réception n’est déduite de cette erreur.' : 'Relecture du journal local…'}</Text> : null}
        <Button variant="secondary" disabled={working || !focus.active} onPress={() => {void perform('observe');}}>Relire la même intention et son reçu</Button>
        {intent ? <View style={styles.card}>
          <Text style={styles.title}>Intention d’origine conservée</Text>
          <Text selectable style={styles.caption}>Référence d’envoi : {intent.requestId}</Text>
          <Text selectable style={styles.body}>Courriel déclaré, non vérifié : {intent.command.replyEmail}</Text>
          <Text selectable style={styles.body}>{intent.command.narrative}</Text>
          <Text style={styles.caption}>La reprise transmet exactement ce courriel et ce récit, avec la même clé de reçu. Une autre saisie ne les remplace pas.</Text>
          {receipt?.state === 'unrecorded' ? <>
            <Button disabled={working} onPress={() => {void perform('resume');}}>Reprendre cet envoi exact</Button>
            <Button variant="secondary" disabled={working} onPress={neutralize}>Neutraliser cette intention non reçue</Button>
          </> : null}
          {receipt && receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>Reconnaître le reçu et supprimer les données locales</Button> : null}
        </View> : ready ? <View style={styles.card}>
          <Text style={styles.title}>Nouvelle prise de contact</Text>
          <Input label="Courriel de réponse déclaré" value={form.scopeKey === scopeKey ? form.replyEmail : ''} onChangeText={value => edit('replyEmail', value)}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={320} disabled={working} />
          <Input label="Difficulté rencontrée" value={form.scopeKey === scopeKey ? form.narrative : ''} onChangeText={value => edit('narrative', value)}
            multiline maxLength={1000} disabled={working} hint="Un court récit, sans données sensibles." />
          <Button disabled={working || !form.replyEmail.trim() || !form.narrative.trim()} onPress={() => {void perform('submit');}}>Conserver cette intention et envoyer la demande</Button>
        </View> : null}
        {receipt ? <View style={styles.card}>
          <Text style={styles.title}>{data?.acknowledged ? 'Reçu terminal reconnu' : 'Reçu public opaque'}</Text>
          <Text selectable style={styles.caption}>{receipt.reference}</Text>
          <Text style={styles.body}>{receipt.state === 'received' ? 'Le dépôt de cette demande est enregistré. Ce reçu ne certifie ni une réponse, ni la joignabilité du courriel, ni la possession d’un compte, ni un rétablissement d’accès.'
            : receipt.state === 'neutralized' ? 'Cette intention non reçue a été neutralisée. Aucun compte n’a été recherché ou rétabli. Une demande déjà reçue ne peut pas être annulée par cette action.'
              : 'Aucun dépôt natif de cette intention n’est visible lors de cette lecture. Le résultat reste à vérifier ; cela ne certifie pas l’absence d’un compte ou d’une demande différente.'}</Text>
          {receipt.recordedAt ? <Text style={styles.caption}>Date enregistrée côté serveur : {new Date(receipt.recordedAt).toLocaleString('fr-CA')}</Text> : null}
        </View> : null}
      </>}
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Centre d’aide et contact par courriel</Button>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  card: {padding: spacing.md, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
