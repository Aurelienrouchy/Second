import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { readProductParcelDraft, writeProductParcelDraft, type ProductParcelDraftRecord } from '@/services/productParcelDraftService';
import { buildProductParcelStatement, emptyProductParcelStatementDraft, productParcelRoleMatches,PRODUCT_PARCEL_MIXED_REASON } from '@/utils/productParcelStatement';
import { PRODUCT_ROUTING_REVIEW_ENABLED,PRODUCT_MIXED_ORDERS_REVIEW_ENABLED } from '@/config/featureFlags';
import {emptyProductMixedOrderDraft} from '@/utils/productMixedOrderStatement';
import {ProductMixedOrderStatementFields} from '@/components/ProductMixedOrderStatementFields';
import {ProductMixedOrderStatementSummary} from '@/components/ProductMixedOrderStatementSummary';
import type {ProductMixedOrderStatement} from '@/types/productMixedOrders';
import { emptyProductRoutingStatementDraft } from '@/utils/productRoutingStatement';
import { ProductRoutingStatementFields } from '@/components/ProductRoutingStatementFields';
import { ProductRoutingStatementSummary } from '@/components/ProductRoutingStatementSummary';
import { ProductParcelStatementFields } from './ProductParcelStatementFields';
import { ProductParcelComparison } from './ProductParcelComparison';
import type { ProductParcelSources } from '@/types/productParcelReview';
type Prepared = ReturnType<typeof buildProductParcelStatement>;
interface Frame {key: string; record: ProductParcelDraftRecord; dirty: boolean; writeError: boolean}
export function ProductParcelDraftForm({uid, transactionId, sourceKey, sourceHash, sources, enabled, onPrepared, actorRole, routingReview = false,mixedOrders=false,contestedMixedDecision=null}: {uid: string; transactionId: string; sourceKey: string; sourceHash: string;
  sources: ProductParcelSources; enabled: boolean; onPrepared: (value: Prepared | null) => void; actorRole: 'buyer' | 'seller' | null; routingReview?: boolean;mixedOrders?:boolean;contestedMixedDecision?:ProductMixedOrderStatement['contestedDecision']}) {
  const navigation = useNavigation(), base = useLabelLifecycleContext(`product-parcel-draft:${transactionId}`, uid), key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, base.focusRevision]);
  const [frame, setFrame] = useState<Frame | null>(null), local = frame?.key === key ? frame : null;
  const [prepared, setPrepared] = useState<{key: string; role: string; value: Prepared; confirmed: boolean} | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const allowLeave = useRef<string | null>(null), writeSequence = useRef(0);
  const draft = useQuery({queryKey: ['product-parcel-draft', key], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = base.capture(); return readProductParcelDraft(uid, transactionId, () => base.assertCurrent(op));}});
  const ready = enabled && base.focused && draft.isSuccess && !draft.isFetching && !draft.isError, record = local?.record ?? (ready ? draft.data : null) ?? {version: 1 as const, uid, transactionId, sourceHash, value: emptyProductParcelStatementDraft()};
  const bound = ready && record.sourceHash === sourceHash, currentPrepared = bound && prepared?.key === sourceKey && prepared.role === actorRole ? prepared : null;
  const edit = (next: ProductParcelDraftRecord) => {if (!ready) return; let op; try {op = base.capture();} catch {return;} onPrepared(null); setPrepared(null); setNotice(null); const sequence = ++writeSequence.current;
    setFrame({key, record: next, dirty: true, writeError: false}); void writeProductParcelDraft(next, () => base.assertCurrent(op)).then(() => {if (base.isCurrent(op) && writeSequence.current === sequence) setFrame(old => old?.key === key ? {...old, writeError: false} : old);})
      .catch(() => {if (base.isCurrent(op) && writeSequence.current === sequence) setFrame(old => old?.key === key ? {...old, writeError: true} : old);});};
  useEffect(() => navigation.addListener('beforeRemove', event => {if (allowLeave.current === key || !local?.dirty || !base.focused) return; event.preventDefault(); Alert.alert('Quitter le constat colis ?', 'Le brouillon reste privé pour ce compte et cette commande. Une intention déjà envoyée reste conservée séparément avec ses sources d’origine.',
    [{text: 'Rester', style: 'cancel'}, {text: 'Quitter et conserver', onPress: async () => {let op; try {op = base.capture(); await writeProductParcelDraft(local.record, () => base.assertCurrent(op!)); base.assertCurrent(op); allowLeave.current = key; navigation.dispatch(event.data.action);} catch {if (!op || base.isCurrent(op)) setNotice({key, text: 'Le brouillon n’a pas pu être conservé. Réessayez avant de quitter.'});}}}]);}), [navigation, local, base, key]);
  useEffect(() => {if (!bound || prepared?.role !== actorRole) onPrepared(null);}, [bound, actorRole, prepared?.role, sourceKey, onPrepared]);
  return <View style={styles.section}>{!ready ? <Text accessibilityRole="alert" style={styles.caption}>{draft.isError ? 'Le brouillon colis ne peut pas être qualifié. Relisez-le avant de le remplacer.' : 'Lecture du brouillon privé…'}</Text> : <>
    {!bound ? <><Text style={styles.caption}>Ce brouillon est lié à une autre source. Son récit reste conservé ; aucune confirmation ne reprend automatiquement les nouvelles sources.</Text><Button variant="secondary" onPress={() => edit({...record, sourceHash})}>Relier explicitement le brouillon aux sources examinées</Button></> : null}
    {routingReview || record.value.routingStatement ? <>
      {!PRODUCT_ROUTING_REVIEW_ENABLED ? <Text style={styles.caption}>Les nouveaux constats de routage sont en préparation. Les observations et reçus déjà enregistrés restent consultables.</Text> : null}
      <Checkbox checked={!!record.value.routingStatement} disabled={!bound || !record.value.routingStatement && !PRODUCT_ROUTING_REVIEW_ENABLED} onToggle={() => {const {routingStatement: _routing, ...ordinary} = record.value; edit({...record, value: record.value.routingStatement ? ordinary : {...ordinary, routingStatement: emptyProductRoutingStatementDraft()}});}}><Text style={styles.caption}>Ajouter explicitement une observation d’acheminement ou une correction rapportée à ce nouveau constat.</Text></Checkbox>
      {record.value.routingStatement ? <ProductRoutingStatementFields value={record.value.routingStatement} disabled={!bound || !PRODUCT_ROUTING_REVIEW_ENABLED} onChange={routingStatement => edit({...record, value: {...record.value, routingStatement}})} /> : null}
    </> : null}
    {mixedOrders||record.value.mixedOrderStatement?<>
      {!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED?<Text style={styles.caption}>Les nouveaux constats de mélange restent en préparation. Les propres reçus conservés peuvent être relus.</Text>:null}
      <Checkbox checked={!!record.value.mixedOrderStatement} disabled={!bound||!record.value.mixedOrderStatement&&!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onToggle={()=>{const{mixedOrderStatement:_mixed,...ordinary}=record.value;edit({...record,value:record.value.mixedOrderStatement?{...ordinary,reason:ordinary.reason===PRODUCT_PARCEL_MIXED_REASON?null:ordinary.reason}:{...ordinary,mixedOrderStatement:emptyProductMixedOrderDraft()}});}}><Text style={styles.caption}>Ajouter explicitement un constat de contenu mélangé ou d’étiquettes échangées à ce nouveau dépôt.</Text></Checkbox>
      {contestedMixedDecision?<Button variant="secondary" disabled={!bound||!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onPress={()=>edit({...record,value:{...record.value,mixedOrderStatement:{...(record.value.mixedOrderStatement??emptyProductMixedOrderDraft()),contestedDecision:{...contestedMixedDecision}}}})}>Ajouter explicitement la contestation de la décision sélectionnée</Button>:null}
      {record.value.mixedOrderStatement?<ProductMixedOrderStatementFields value={record.value.mixedOrderStatement} disabled={!bound||!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onChange={mixedOrderStatement=>edit({...record,value:{...record.value,mixedOrderStatement}})}/>:null}
    </>:null}
    <ProductParcelStatementFields value={record.value} disabled={!bound} actorRole={actorRole} mixedOrders={mixedOrders&&PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onChange={value => edit({...record, value})} />
    {local?.writeError ? <><Text accessibilityRole="alert" style={styles.caption}>Le brouillon visible n’est pas encore conservé. Toute confirmation reste suspendue.</Text><Button variant="secondary" onPress={() => edit(record)}>Conserver ce même brouillon</Button></> : null}
    <Button variant="secondary" disabled={!bound || !actorRole || !!local?.writeError || !!record.value.routingStatement && !PRODUCT_ROUTING_REVIEW_ENABLED||!!record.value.mixedOrderStatement&&!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onPress={() => {try {base.capture(); const value = buildProductParcelStatement(record.value); if (!actorRole || !productParcelRoleMatches(value.parcelStatement, actorRole)) throw new Error('La réception ou non-réception appartient au destinataire natif de ce trajet.');
      setPrepared({key: sourceKey, role: actorRole, value, confirmed: false}); setNotice(null); onPrepared(null);} catch (error) {setPrepared(null); onPrepared(null); setNotice({key, text: error instanceof Error ? error.message : 'Les déclarations doivent être complétées.'});}}}>Examiner le constat préparé</Button>
    {currentPrepared ? <><Text selectable style={styles.body}>{currentPrepared.value.statement}</Text><ProductParcelComparison sources={sources} statement={currentPrepared.value.parcelStatement} />{currentPrepared.value.routingStatement ? <ProductRoutingStatementSummary statement={currentPrepared.value.routingStatement} /> : null}{currentPrepared.value.mixedOrderStatement?<ProductMixedOrderStatementSummary statement={currentPrepared.value.mixedOrderStatement}/>:null}
      <Checkbox checked={currentPrepared.confirmed} disabled={!!local?.writeError} onToggle={() => {try {base.capture(); const confirmed = !currentPrepared.confirmed; setPrepared({...currentPrepared, confirmed}); onPrepared(confirmed ? currentPrepared.value : null);} catch {onPrepared(null);}}}><Text style={styles.caption}>Je confirme ce qui est déclaré, les inconnues, la disponibilité des pièces et les précisions de dates. Cela ne certifie pas une perte, une remise, le contenu, une faute ou une indemnisation.</Text></Checkbox></> : null}
    </>}
    <Button variant="ghost" disabled={!base.focused || draft.isFetching || !!local?.dirty} onPress={() => {try {base.capture(); onPrepared(null); setPrepared(null); void draft.refetch();} catch { /* Old activity does not reread private drafts. */ }}}>Relire le brouillon conservé</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
