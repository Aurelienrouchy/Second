import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { LabelLifecycleCommandPanel } from '@/components/LabelLifecycleCommandPanel';
import { LabelRouteAmendmentPanel } from '@/components/LabelRouteAmendmentPanel';
import { LabelLifecycleReauthentication } from '@/components/LabelLifecycleReauthentication';
import { LabelLifecycleEntryCard, LABEL_LIFECYCLE_ACTION_LABELS, labelLifecycleCost } from '@/components/LabelLifecycleEntryCard';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelLifecycleService, labelLifecycleActionAvailable } from '@/services/labelLifecycleService';
import { productReviewEqual } from '@/services/productReviewService';
import type { LabelLifecycleAction, LabelLifecycleCommand, LabelLifecycleContext, LabelLifecycleCursor, LabelLifecycleHistory, LabelLifecycleScope } from '@/types/labelLifecycle';
import type { LabelRouteNoticeReference } from '@/types/labelRouteAmendment';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
interface Form {key: string; action: LabelLifecycleAction | null; message: string; privateNote: string; authorityReference: string; cause: string; costAuthorized: boolean; acknowledged: boolean}
const rowKey = (row: LabelLifecycleHistory['entries'][number]) => row.entryId;
const renderRow = ({item}: ListRenderItemInfo<LabelLifecycleHistory['entries'][number]>) => <LabelLifecycleEntryCard row={item} />;
export function LabelLifecyclePanel({uid, context, scope, routeNotice = null, parcelAmendment = false}: {uid: string; context: LabelLifecycleContext; scope: LabelLifecycleScope; routeNotice?: LabelRouteNoticeReference | null; parcelAmendment?: boolean}) {
  const frame = useLabelLifecycleContext(JSON.stringify(['label-lifecycle', context, scope]), uid);
  const key = JSON.stringify([uid, context, scope, getAuthSessionGeneration(), frame.focusRevision]);
  const [formState, setFormState] = useState<Form | null>(null), [failed, setFailed] = useState<string | null>(null);
  const interactionEpoch = useRef(0);
  const read = () => {const op = frame.capture(); return LabelLifecycleService.preview(uid, context, scope, () => frame.assertCurrent(op));};
  const preview = useQuery({queryKey: ['label-lifecycle-preview', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: read});
  const admitted = frame.focused && failed !== key && preview.isSuccess && !preview.isFetching && !preview.error ? preview.data : null;
  const sourceKey = admitted ? JSON.stringify([key, admitted]) : '';
  const history = useInfiniteQuery({queryKey: ['label-lifecycle-history', sourceKey], enabled: !!admitted, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as LabelLifecycleCursor | null,
    queryFn: ({pageParam}) => {if (!admitted) throw new Error('Actualisez le suivi.'); const op = frame.capture(); return LabelLifecycleService.history(uid, context, scope, pageParam, admitted, () => frame.assertCurrent(op));}, getNextPageParam: page => page.coverage.hasMore ? page.nextCursor : undefined});
  const entries = history.data?.pages.flatMap(p => p.entries) ?? [], ids = entries.map(r => r.entryId);
  const current = admitted && history.isSuccess && !history.isFetching && !history.error && new Set(ids).size === ids.length ? admitted : null;
  const form: Form = formState?.key === sourceKey && sourceKey ? formState : {key: sourceKey, action: null, message: '', privateNote: '', authorityReference: '', cause: '', costAuthorized: false, acknowledged: false};
  const change = (value: Partial<Form>) => {if (!current) return; try {frame.capture(); interactionEpoch.current++; setFormState({...form, ...value, acknowledged: false, costAuthorized: value.costAuthorized ?? false});} catch { /* Context loss discards NEW admission, preserving own journal. */ }};
  const q = current?.replacement.qualification === 'native_current_quote' ? current.replacement.quote : null;
  const quoteAction = form.action === 'accept_replacement' || form.action === 'purchase_replacement' || form.action === 'adopt_replacement';
  const costAction = form.action === 'purchase_replacement' || form.action === 'adopt_replacement';
  const authorizedCost = form.action === 'purchase_replacement' ? current?.actionAvailability.platformCostCentsForPurchase ?? null : form.action === 'adopt_replacement' ? current?.actionAvailability.platformCostCentsForAdoption ?? null : null;
  const adminAction = scope === 'admin';
  const draft: LabelLifecycleCommand | null = current && current.source.caseVersion !== null && form.action && labelLifecycleActionAvailable(current, form.action) && form.message.trim() && form.acknowledged && (!adminAction || form.privateNote.trim()) && (!quoteAction || q) && (!costAction || q && authorizedCost !== null && current.replacement.bothParticipantsAccepted && form.costAuthorized && form.authorityReference.trim() && form.cause.trim()) ? {
    ...context, scope, sourceHash: current.source.sourceHash, sourceRevision: current.source.sourceRevision, caseVersion: current.source.caseVersion, action: form.action,
    message: form.message.trim(), privateNote: adminAction ? form.privateNote.trim() : null,
    quoteReference: quoteAction && q ? {id: q.id, contentHash: q.contentHash} : null,
    platformAuthorization: costAction && authorizedCost !== null ? {approved: true, payer: 'platform', currency: 'CAD', amountCents: authorizedCost, authorityReference: form.authorityReference.trim(), cause: form.cause.trim()} : null, acknowledged: true} : null;
  const admissionKey = JSON.stringify([key, sourceKey, current, draft]), latest = useRef(admissionKey);
  useLayoutEffect(() => {latest.current = admissionKey;}, [admissionKey]);
  const refresh = () => {try {frame.capture(); interactionEpoch.current++; setFormState(null); setFailed(null); void preview.refetch();} catch { /* No private source re-entry under a stale UID. */ }};
  const verifyNew = async () => {
    try {
      if (!current || !draft) throw new Error('Vérifiez et confirmez les détails de votre demande.');
      const op = frame.capture(), capturedInteraction = interactionEpoch.current;
      const assertCurrent = () => {frame.assertCurrent(op); if (latest.current !== admissionKey || interactionEpoch.current !== capturedInteraction) throw new Error('Les détails de la demande ont changé. Confirmez-les à nouveau.');};
      assertCurrent(); const fresh = await read(); assertCurrent(); if (!productReviewEqual(fresh, current)) throw new Error('Le dossier, l’étiquette, le devis ou les consentements ont changé. Relisez avant de confirmer.');
      return assertCurrent;
    } catch (e) {setFailed(key); setFormState(null); throw e;}
  };
  const actions = current?.options ?? [];
  return <View style={styles.section}><Text style={styles.title}>Étiquette : {context.leg === 'forward' ? 'trajet aller' : 'trajet retour'}</Text>
    <Button variant="secondary" disabled={!frame.focused || preview.isFetching || history.isFetching} onPress={refresh}>Actualiser le suivi</Button>
    {preview.isFetching || history.isFetching ? <Text style={styles.caption}>Chargement du suivi…</Text> : !current ? <Text accessibilityRole="alert" style={styles.body}>Le suivi est indisponible. Vous pouvez consulter votre demande en cours ci-dessous.</Text> : null}
    {current ? <><Text style={styles.body}>{current.source.stopUse ? 'N’utilisez plus cette étiquette pour déposer le colis.' : 'La validité de cette étiquette doit être confirmée avant le dépôt.'}</Text>
      <Text style={styles.caption}>{current.source.qualification === 'unknown' ? 'Étiquette à vérifier.' : current.source.qualification === 'native_purchase_reconciliation' ? 'Achat de l’étiquette à vérifier.' : 'Étiquette enregistrée.'}</Text>
      {!current.currentLabelUse.nativeGuardsAllowUse ? <Text style={styles.body}>L’utilisation de cette étiquette est suspendue ou reste à confirmer.</Text> : null}
      {current.currentLabelUse.lastRecordedDocumentObservation ? <Text style={styles.caption}>Dernière vérification auprès du transporteur : {new Date(current.currentLabelUse.lastRecordedDocumentObservation.observedAt).toLocaleString(APP_LOCALE)}. La validité actuelle reste à confirmer.</Text> : <Text style={styles.caption}>Aucune vérification de disponibilité n’est enregistrée.</Text>}
      {current.source.reconciliation.labelPurchaseRequired || current.source.reconciliation.returnRequired ? <Text style={styles.body}>Une opération précédente doit être vérifiée avant tout nouvel achat.</Text> : null}
      <Text style={styles.body}>{current.currentInstruction.qualification === 'native_current_instruction' ? 'Consigne actuelle' : current.currentInstruction.qualification === 'historical_sources_changed' ? 'Ancienne consigne : le suivi a changé depuis.' : current.currentInstruction.qualification === 'unrecorded' ? 'Aucune consigne enregistrée.' : 'Consigne actuelle à vérifier.'}</Text>
      {current.currentInstruction.instruction ? <><Text selectable style={styles.body}>{current.currentInstruction.instruction.message}</Text>{scope === 'admin' && current.currentInstruction.instruction.privateNote ? <Text selectable style={styles.caption}>Note opérateur privée : {current.currentInstruction.instruction.privateNote}</Text> : null}</> : null}
      {current.actionAvailability.pendingProviderOperationRequiresReconciliation ? <Text style={styles.body}>Une opération est en attente de confirmation auprès du transporteur. Vérifiez son résultat avant de continuer.</Text> : null}
      {scope === 'admin' && current.actionAvailability.recentReauthenticationRequiredForProviderEffect ? <LabelLifecycleReauthentication key={sourceKey} uid={uid} sourceKey={sourceKey} disabled={!frame.focused || preview.isFetching || history.isFetching} onVerified={refresh} /> : null}
      {q ? <><Text style={styles.title}>Remplacement de l’étiquette</Text><Text style={styles.body}>{labelLifecycleCost(q.costCents, q.currency)} · aucun supplément pour l’acheteur.</Text>
        <Text style={styles.caption}>{current.replacement.bothParticipantsAccepted ? 'Les deux parties ont accepté le devis.' : 'L’accord des deux parties est encore nécessaire.'} La prise en charge par Seconde reste à confirmer.</Text>
        <Text style={styles.caption}>Même adresse et même colis.</Text></> : <Text style={styles.caption}>Aucun devis de remplacement confirmé.</Text>}
      {actions.map(action => <Button key={action} variant={form.action === action ? 'primary' : 'secondary'} disabled={!labelLifecycleActionAvailable(current, action)} onPress={() => change({action})}>{LABEL_LIFECYCLE_ACTION_LABELS[action]}</Button>)}
      {form.action ? <><TextInput accessibilityLabel="Message adressé aux deux parties sur cette étiquette" placeholder="Message aux deux parties" value={form.message} multiline maxLength={4000} style={styles.input} onChangeText={message => change({message})} />
        {adminAction ? <TextInput accessibilityLabel="Motivation opérateur privée" placeholder="Motivation privée de cette instruction" value={form.privateNote} multiline maxLength={4000} style={styles.input} onChangeText={privateNote => change({privateNote})} /> : null}
        {costAction && q ? <><Text style={styles.body}>Coût à prendre en charge : {labelLifecycleCost(authorizedCost, 'CAD')}.</Text><TextInput accessibilityLabel="Référence de l’autorisation de dépense plateforme" placeholder="Référence de l’autorisation plateforme" value={form.authorityReference} maxLength={1000} style={styles.input} onChangeText={authorityReference => change({authorityReference})} /><TextInput accessibilityLabel="Cause de la dépense plateforme" placeholder="Cause de la dépense" value={form.cause} multiline maxLength={2000} style={styles.input} onChangeText={cause => change({cause})} />
          <Checkbox checked={form.costAuthorized} onToggle={() => change({costAuthorized: !form.costAuthorized})}><Text style={styles.body}>J’autorise Seconde à prendre en charge {labelLifecycleCost(authorizedCost, 'CAD')} pour cette demande. Aucun débit de l’acheteur ou du vendeur n’est demandé.</Text></Checkbox></> : null}
        <Checkbox checked={form.acknowledged} onToggle={() => {try {frame.capture(); interactionEpoch.current++; setFormState({...form, acknowledged: !form.acknowledged});} catch { /* No stale confirmation. */ }}}><Text style={styles.body}>{form.action === 'accept_replacement' && q ? `J’accepte de remplacer l’étiquette pour ce même trajet au prix de ${labelLifecycleCost(q.costCents, q.currency)}. L’accord de l’autre partie et la prise en charge par Seconde restent nécessaires.` : 'Je confirme cette demande. Une annulation ne garantit pas l’interception du colis ni le remboursement. Le remplacement reste soumis aux vérifications et à l’accord des deux parties.'}</Text></Checkbox></> : null}
      <Text style={styles.title}>Historique</Text><View style={styles.list}><FlashList data={entries} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View>
      {history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => {void history.fetchNextPage();}}>Charger la suite</Button> : null}
    </> : null}
    <LabelLifecycleCommandPanel uid={uid} context={context} draft={draft} verifyNew={verifyNew} onRecorded={refresh} onSourceError={() => {setFailed(key); setFormState(null);}} />
    <LabelRouteAmendmentPanel uid={uid} context={context} scope={scope} noticeReference={routeNotice} parcelAmendment={parcelAmendment} onRecorded={refresh} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}, list: {height: spacing.xl * 9}});
