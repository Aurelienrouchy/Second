import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ReturnToSenderService } from '@/services/returnToSenderService';
import { observeAdminReturnToSenderResumeSource } from '@/services/adminFinancialService';
import type { AdminReturnToSenderFinancialResume } from '@/types/adminReturnToSenderFinancial';
import type { ReturnToSenderCase } from '@/types/returnToSender';

const validId = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
const keyExtractor = (item: ReturnToSenderCase) => item.caseId;
interface Props {uid: string; disabled: boolean; blockedTransactions: string[];
  onPreview: (transactionId: string, caseId: string, resume?: AdminReturnToSenderFinancialResume) => void}
export function AdminReturnToSenderFinancialEntry({uid, disabled, blockedTransactions, onPreview}: Props) {
  const sdkUid = useAuthenticatedUid();
  const context = useShippingPurchaseContext('admin-return-to-sender-financial-entry', uid);
  const key = JSON.stringify([uid, sdkUid, getAuthSessionGeneration(), context.focusRevision]);
  const [frame, setFrame] = useState<{key: string; input: string; read: null | {transactionId: string; nonce: string}}>(() => ({key, input: '', read: null}));
  const current = frame.key === key ? frame : {key, input: '', read: null};
  const result = useQuery({queryKey: ['admin-return-to-sender-financial-entry', key, current.read?.transactionId, current.read?.nonce],
    enabled: sdkUid === uid && context.focused && !disabled && current.read !== null, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {
      const operation = context.capture(), transactionId = current.read?.transactionId;
      if (operation.session.uid !== uid || !transactionId) throw new Error('La commande doit être relue.');
      const assertCurrent = () => context.assertCurrent(operation);
      const [cases, resumeSource] = await Promise.all([ReturnToSenderService.cases(uid, transactionId, 'admin', assertCurrent),
        observeAdminReturnToSenderResumeSource(uid, transactionId, assertCurrent)]);
      assertCurrent();
      if (cases.sourceRevision !== resumeSource.sourceRevision) throw new Error('Les sources ont changé. Relisez la commande.');
      return {cases, resumeSource};
    }});
  const data = sdkUid === uid && context.focused && !disabled && current.read && !result.isError && !result.isFetching ? result.data : null;
  const cases = data?.cases, resumeSource = data?.resumeSource;
  const originalIntentPresent = !!cases && (cases.financialRecording.refundSource !== 'absent' || !!resumeSource?.resume);
  const resume = resumeSource?.qualification === 'qualified' && !resumeSource.financial?.success ? resumeSource.resume : null;
  const selectable = !!cases?.guardPresent && cases.sourceRevision !== null && !blockedTransactions.includes(cases.transactionId) && (!originalIntentPresent || resume !== null);
  const renderItem = useCallback(({item}: ListRenderItemInfo<ReturnToSenderCase>) => <View style={styles.case}>
    <Text selectable style={styles.caption}>Cas déclaré : {item.caseId}</Text>
    <Text numberOfLines={3} style={styles.body}>Récit déclaré : {item.narrative}</Text>
    <Button variant="secondary" disabled={!selectable || disabled || item.caseRevision === null}
      onPress={() => {if (cases && selectable && sdkUid === uid && context.focused) onPreview(cases.transactionId, item.caseId, resume ?? undefined);}}>
      {resume ? 'Examiner la reprise de cette intention' : 'Examiner ce cas et toutes les déclarations liées'}
    </Button>
  </View>, [cases, selectable, disabled, sdkUid, uid, context.focused, onPreview, resume]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Examen financier d’un retour à l’expéditeur signalé</Text>
    <Text style={styles.caption}>Indiquez la commande du dossier, puis choisissez explicitement le cas principal. Cette lecture n’envoie aucune instruction financière et ne qualifie aucun récit.</Text>
    <TextInput style={styles.input} value={current.input} maxLength={200} autoCapitalize="none" autoCorrect={false} editable={!disabled && sdkUid === uid}
      accessibilityLabel="Référence de la commande à examiner" placeholder="Référence de la commande" placeholderTextColor={colors.muted}
      onChangeText={input => setFrame({key, input, read: null})} />
    <Button variant="secondary" disabled={disabled || sdkUid !== uid || !context.focused || !validId(current.input.trim()) || result.isFetching}
      onPress={() => setFrame({...current, read: {transactionId: current.input.trim(), nonce: randomUUID()}})}>Lire les cas de cette commande</Button>
    {result.isFetching && current.read ? <Text style={styles.caption}>Lecture actuelle des déclarations…</Text> : null}
    {result.isError && current.read ? <Text style={styles.caption}>Impossible de qualifier cette lecture. Relisez la commande avant de préparer une instruction.</Text> : null}
    {cases ? <>
      <Text style={styles.caption}>Cette liste contient les déclarations enregistrées pour la garde lue. Leurs récits et la possession de l’article restent non vérifiés.</Text>
      {cases.financialRecording.refundSource !== 'absent' ? <Text style={styles.caption}>Un enregistrement de remboursement existe. Son intention d’origine doit être consultée ; cette lecture ne certifie pas son règlement ni un crédit bancaire.</Text> : null}
      {resumeSource?.resume ? <>
        <Text selectable style={styles.caption}>Intention d’origine : {resumeSource.resume.refundIntentId} · tentative d’origine : {resumeSource.resume.refundAttemptId}</Text>
        <Text style={styles.caption}>Ces références restent fixes. Une reprise examine les sources actuelles pour cette même intention ; elle ne crée pas de deuxième réservation et ne modifie pas ses montants ou sa clé d’origine.</Text>
      </> : null}
      {resumeSource?.financial?.success ? <Text style={styles.caption}>Le règlement de l’intention d’origine est enregistré. Aucune nouvelle approbation financière n’est proposée depuis ce résultat ; l’arrivée sur un compte bancaire reste non vérifiée.</Text> : null}
      {!selectable ? <Text style={styles.caption}>Aucune nouvelle instruction n’est proposée depuis cette lecture. Une intention conservée doit être suivie avec sa référence d’origine.</Text> : null}
      {cases.items.length ? <View style={styles.list}><FlashList data={cases.items} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled /></View> :
        <Text style={styles.caption}>Aucune déclaration native lisible dans cette source.</Text>}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, case: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, body: {...typography.bodySmall, color: colors.foreground},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}, list: {height: spacing.xl * 9}});
