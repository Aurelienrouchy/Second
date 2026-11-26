import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useBusinessCessationIdentity } from '@/hooks/useBusinessCessationIdentity';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import { BusinessCessationAction } from '@/components/BusinessCessationAction';
import { BusinessCessationHistory } from '@/components/BusinessCessationHistory';
import { BusinessCessationPrivateExport } from '@/components/BusinessCessationPrivateExport';
import { BusinessCessationStatus } from '@/components/BusinessCessationStatus';
import type { BusinessCessationCommand as Command, BusinessCessationReceipt as Receipt, BusinessCessationRow as Row } from '@/types/businessCessation';

const rowKey = (row: Row) => row.rowId;
const renderRow = ({item}: {item: Row}) => <View style={styles.row}><Text selectable style={styles.caption}>{item.category} — {item.sourceRef}</Text><Text style={styles.caption}>État natif : {item.status ?? 'inconnu'}. Obligation : {item.obligationState === 'open' ? 'ouverte' : 'à qualifier'}. Reprises : {item.recoveryRoutes.join(', ')}.</Text></View>;
export function AdminBusinessCessationPanel({uid}: {uid: string}) {
  const identity = useBusinessCessationIdentity(uid), owner = identity.owner, native = useShippingPurchaseContext('business-cessation-admin-native', uid), context = useLabelLifecycleContext('business-cessation-admin', uid), client = useQueryClient();
  const key = JSON.stringify([identity.key, native.focusRevision]);
  const [planSelection, setPlanSelection] = useState<{key: string; owner: typeof owner; planId: string} | null>(null);
  const [action, setAction] = useState<{key: string; owner: typeof owner; nonce: string; command: Command} | null>(null);
  const [reason, setReason] = useState<{key: string; owner: typeof owner; text: string} | null>(null), [page, setPage] = useState<{planId: string; number: number} | null>(null);
  const statusQuery = useQuery({queryKey: ['business-cessation-status', uid, key, context.focusRevision], enabled: context.focused && identity.ready, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const status = await Service.status(uid, guard); guard(); return {status, owner: sdk};}});
  const status = context.focused && statusQuery.isSuccess && !statusQuery.isFetching && statusQuery.data.owner === auth.currentUser ? statusQuery.data.status : null;
  const selectedPlan = planSelection?.key === key && planSelection.owner === auth.currentUser ? planSelection.planId : null;
  const planId = selectedPlan ?? status?.planId ?? null;
  const planQuery = useQuery({queryKey: ['business-cessation-plan', uid, planId, key, context.focusRevision], enabled: context.focused && identity.ready && !!planId, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {if (!planId) throw new Error('Plan natif requis.'); const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const plan = await Service.plan(uid, planId, guard); guard(); return {plan, owner: sdk};}});
  const plan = context.focused && planQuery.isSuccess && !planQuery.isFetching && planQuery.data.owner === auth.currentUser ? planQuery.data.plan : null;
  const number = plan && page?.planId === plan.planId && page.number < plan.inventory.pageCount ? page.number : 0;
  const pageQuery = useQuery({queryKey: ['business-cessation-page', uid, plan?.planId, number, key, context.focusRevision], enabled: context.focused && !!plan && plan.inventory.pageCount > 0, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {if (!plan) throw new Error('Plan natif requis.'); const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const page = await Service.page(uid, plan, number, guard); guard(); return {page, owner: sdk};}});
  const currentPage = context.focused && pageQuery.isSuccess && !pageQuery.isFetching && pageQuery.data.owner === auth.currentUser ? pageQuery.data.page : null;
  const currentReason = reason?.key === key && reason.owner === auth.currentUser ? reason.text : '';
  const selectedAction = action?.key === key && action.owner === auth.currentUser ? action : null;
  const refresh = () => {try {if (auth.currentUser !== owner) return; context.capture(); void client.invalidateQueries({queryKey: ['business-cessation-plan', uid]}); void client.invalidateQueries({queryKey: ['business-cessation-status', uid]}); void client.invalidateQueries({queryKey: ['business-cessation-history', uid]});} catch { /* No new-account refetch. */ }};
  const choosePlan = (planId: string) => {try {if (auth.currentUser !== owner) return; context.capture(); native.capture(); setPlanSelection({key, owner, planId}); setAction(null); setPage(null);} catch { /* Native receipt/control only. */ }};
  const select = (command: Command) => {try {if (auth.currentUser !== owner) return; context.capture(); native.capture(); setAction({key, owner, nonce: randomUUID(), command});} catch { /* Documentary only. */ }};
  const recorded = (receipt: Receipt) => {if (auth.currentUser !== selectedAction?.owner) return; if (receipt.planId) setPlanSelection({key, owner, planId: receipt.planId}); setAction(null); refresh();};
  const changePage = (next: number) => {try {if (!plan || auth.currentUser !== owner) return; context.capture(); if (next >= 0 && next < plan.inventory.pageCount) setPage({planId: plan.planId, number: next});} catch { /* Native page only. */ }};
  if (!native.focused) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Plan de continuité et de cessation</Text>
      {status ? <BusinessCessationStatus status={status} /> : <Text style={styles.caption}>Le contrôle indépendant reste à qualifier.</Text>}
      <TextInput style={styles.input} multiline maxLength={1500} value={currentReason} accessibilityLabel="Motivation du plan documentaire de cessation" placeholder="Motivation privée du plan, sans renseignement bancaire" onChangeText={text => {try {if (auth.currentUser !== owner) return; context.capture(); setReason({key, owner, text}); setAction(null);} catch { /* Current owner only. */ }}} />
      <Button variant="secondary" disabled={!currentReason.trim()} onPress={() => select({action: 'create_plan', reason: currentReason.trim()})}>Examiner la création d’un plan documentaire</Button>
      <Button variant="secondary" onPress={refresh}>Relire le contrôle et le plan</Button>
      {plan ? <><Text selectable style={styles.caption}>Plan {plan.planId}, version {plan.version}. Point natif : {plan.capture.seconds}:{plan.capture.nanoseconds}.</Text>
        <Text style={styles.caption}>Sources parcourues : {plan.inventory.sourceIndex}/{plan.inventory.sourceCount}. Pages : {plan.inventory.pageCount}. Éléments : {plan.inventory.rowCount}, dont {plan.inventory.unknownCount} à qualifier.</Text>
        <Text style={styles.caption}>Le parcours couvre seulement les sources natives connues à ce point. Les objets prestataire seuls, sources non recensées, événements futurs et moyens réels de financement demandent un travail distinct. Aucune obligation n’est déclarée résolue.</Text>
        <Button variant="secondary" disabled={plan.inventory.complete || plan.inventory.sourceIndex >= plan.inventory.sourceCount} onPress={() => select({action: 'advance_inventory', planId: plan.planId, expectedVersion: plan.version})}>Examiner la prochaine page d’inventaire native</Button>
        <Button variant="secondary" disabled={plan.inventory.complete || plan.inventory.sourceIndex !== plan.inventory.sourceCount || plan.inventory.cursor !== null} onPress={() => select({action: 'seal_inventory', planId: plan.planId, expectedVersion: plan.version})}>Examiner le scellement des sources parcourues</Button>
        <Text style={styles.caption}>Archive : {plan.export.pageCount}/{plan.inventory.pageCount} pages, {plan.export.sealed ? 'manifeste scellé' : 'manifeste non scellé'}. La politique indépendante sera requalifiée lors de chaque export ; une première archive n’est jamais autorisée par son simple affichage.</Text>
        <Button variant="secondary" disabled={!plan.inventory.complete || plan.export.sealed || plan.export.pageCount >= plan.inventory.pageCount} onPress={() => select({action: 'export_next_page', planId: plan.planId, expectedVersion: plan.version})}>Examiner l’archive de la prochaine page expurgée</Button>
        <Button variant="secondary" disabled={!plan.inventory.complete || plan.export.sealed || plan.export.pageCount !== plan.inventory.pageCount} onPress={() => select({action: 'seal_export', planId: plan.planId, expectedVersion: plan.version})}>Examiner le scellement du manifeste d’archive</Button>
        {plan.inventory.pageCount > 0 ? <><Text style={styles.caption}>Page native {number + 1}/{plan.inventory.pageCount}.</Text>
          <Button variant="secondary" disabled={number === 0} onPress={() => changePage(number - 1)}>Page d’inventaire précédente</Button>
          <Button variant="secondary" disabled={number + 1 >= plan.inventory.pageCount} onPress={() => changePage(number + 1)}>Page d’inventaire suivante</Button>
          {currentPage ? <View style={styles.list}><FlashList data={currentPage.rows} renderItem={renderRow} keyExtractor={rowKey} ListEmptyComponent={<Text style={styles.caption}>Aucun document dans cette page native ; cela ne clôt aucune obligation.</Text>} /></View> : <Text style={styles.caption}>La page reste à relire au même point natif.</Text>}
          {number < plan.export.pageCount ? <BusinessCessationPrivateExport uid={uid} target={{kind: 'inventory', planId: plan.planId, pageNumber: number}} /> : null}
        </> : null}
      </> : planId ? <Text style={styles.caption}>Le plan privé ne peut pas être qualifié dans cette lecture.</Text> : <Text style={styles.caption}>Sélectionnez le plan depuis le contrôle indépendant ou un reçu natif de votre suivi.</Text>}
    </> : null}
    {selectedAction ? <BusinessCessationAction uid={uid} access="admin" sourceKey={`${key}:${selectedAction.nonce}`} command={selectedAction.command} onRecorded={recorded} /> : null}
    <BusinessCessationHistory uid={uid} access="admin" onPlanSelected={choosePlan} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md}, row: {gap: spacing.xs, paddingVertical: spacing.sm}, list: {minHeight: spacing.xl * 4, height: spacing.xl * 8}});
