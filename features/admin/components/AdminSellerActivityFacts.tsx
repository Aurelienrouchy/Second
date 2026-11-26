import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { staleTradeOperation } from '@/services/tradeOperation';
import { isSellerActivityTransactionId, sameSellerActivitySource, SellerActivityFactsService } from '@/services/sellerActivityFactsService';
import type { SellerActivityCursor, SellerActivityDateFact, SellerActivityFactsPage, SellerActivityItem,
  SellerActivityLedgerFacts, SellerActivityMoneyFact, SellerActivitySource } from '@/types/sellerActivityFacts';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import {AdminSellerActivityReview} from './AdminSellerActivityReview';

interface Props {uid: string; suggestedTransactionId?: string | null}
interface Selection {key: string; serial: number; transactionId: string}
interface PageParam {cursor: SellerActivityCursor | null; source: SellerActivitySource | null}
type Row = {kind: 'page'; key: string; page: SellerActivityFactsPage; index: number} |
  {kind: 'order'; key: string; item: SellerActivityItem};
const rowKey = (row: Row) => row.key;
const reasonLabels: Record<string, string> = {
  native_order_amounts_unqualified: 'montants natifs non qualifiés', native_card_capture_unqualified: 'capture carte native non qualifiée',
  native_wallet_debit_unqualified: 'débit du porte-monnaie non qualifié', native_original_seller_credit_unqualified: 'crédit vendeur original non qualifié',
  native_release_unqualified: 'libération native non qualifiée', native_refund_effect_unqualified: 'remboursement natif non qualifié',
  refund_fragment_not_complete_history: 'un fragment de remboursement ne décrit pas son historique complet',
  native_timestamp_missing_or_unqualified: 'date native absente ou non qualifiée', native_payment_effect_unqualified: 'effet du paiement non qualifié',
  auth_creation_not_read: 'création du compte Auth non consultée',
};
const unknownReason = (value: string | null) => value ? reasonLabels[value] ?? 'source native non qualifiée' : 'source native non qualifiée';
const moneyText = (fact: SellerActivityMoneyFact) => fact.qualification === 'unknown' || fact.amountCents === null ?
  `Inconnu — ${unknownReason(fact.reason)}` : `${(fact.amountCents / 100).toLocaleString('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2})} $ CA`;
const dateText = (fact: SellerActivityDateFact) => fact.qualification === 'unknown' || fact.at === null ?
  `Inconnue — ${unknownReason(fact.reason)}` : new Date(fact.at).toLocaleString('fr-CA');
const ledgerText = (facts: SellerActivityLedgerFacts | null) => facts === null ? 'source non qualifiée' :
  `${facts.inspected} document(s) inspecté(s), limite ${facts.limit}${facts.hasMore ? ' ; source tronquée, effets non qualifiés' : ' ; lecture bornée de cette commande'}`;

/** Explicit private reads: selecting an order never creates a review, receipt or instruction. */
export function AdminSellerActivityFacts({uid, suggestedTransactionId = null}: Props) {
  const [reference, setReference] = useState('');
  const context = useLabelLifecycleContext(JSON.stringify(['admin-seller-activity-facts', reference]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision, reference]);
  const [renderSerial, setRenderSerial] = useState(0);
  const fence = useRef({key, serial: 0});
  useLayoutEffect(() => {
    if (fence.current.serial <= renderSerial) fence.current = {key, serial: renderSerial};
  }, [key, renderSerial]);
  const [authorization, setAuthorization] = useState<{key: string; verifiedAt: number} | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const selected = selection?.key === key && selection.serial === renderSerial ? selection : null;
  const authorized = authorization?.key === key;
  useEffect(() => {
    if (!authorization || authorization.key !== key) return;
    const remaining = Math.max(0, authorization.verifiedAt + 300_000 - Date.now());
    const timeout = setTimeout(() => setAuthorization(old => old === authorization ? null : old), remaining);
    return () => clearTimeout(timeout);
  }, [authorization, key]);
  const authorizedNow = () => authorization?.key === key && Date.now() >= authorization.verifiedAt && Date.now() - authorization.verifiedAt <= 300_000;
  const assertSelection = (value: Selection) => {
    if (fence.current.key !== value.key || fence.current.serial !== value.serial) throw staleTradeOperation();
  };
  const query = useInfiniteQuery({
    queryKey: ['admin-seller-activity-facts', key, selected?.serial],
    enabled: !!selected && authorized && context.focused, staleTime: 0, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    initialPageParam: {cursor: null, source: null} as PageParam,
    queryFn: async ({pageParam}) => {
      if (!selected) throw staleTradeOperation();
      assertSelection(selected);
      let operation;
      try {
        operation = context.capture();
        const assertCurrent = () => {assertSelection(selected); context.assertCurrent(operation!);};
        const result = await SellerActivityFactsService.read(uid, selected.transactionId, pageParam.source, pageParam.cursor, assertCurrent);
        assertCurrent(); return result;
      } catch (error) {
        if (operation && context.isCurrent(operation) && fence.current.key === selected.key && fence.current.serial === selected.serial) {
          const serial = fence.current.serial + 1; fence.current = {key, serial}; setRenderSerial(serial);
          setSelection(null); setAuthorization(null);
          setNotice({key, text: 'Cette lecture n’est plus actuelle. Les pages ont été masquées : confirmez votre identité, puis relisez explicitement cette commande depuis le début.'});
        }
        throw error;
      }
    },
    getNextPageParam: (page): PageParam | undefined => page.pagination.hasMore && page.pagination.nextCursor ?
      {cursor: page.pagination.nextCursor, source: page.source} : undefined,
  });
  const pages = selected && context.focused && authorized && !query.isError && !query.isFetching ? query.data?.pages ?? [] : [];
  const first = pages[0];
  const items = pages.flatMap(page => page.items);
  const coherent = pages.every((page, index) => sameSellerActivitySource(page.source, first.source) &&
    page.coverage.afterId === (index ? pages[index - 1].pagination.nextCursor?.lastId ?? null : null)) &&
    new Set(items.map(item => item.transactionId)).size === items.length;
  const rows: Row[] = coherent ? pages.flatMap((page, index): Row[] => [
    {kind: 'page', key: `page:${index}:${page.pageHash}`, page, index},
    ...page.items.map(item => ({kind: 'order' as const, key: `order:${item.transactionId}`, item})),
  ]) : [];
  const paginationKey = JSON.stringify([key, selected?.serial, pages.at(-1)?.pageHash]);
  const nextGate = useRef({key: '', open: false});
  useLayoutEffect(() => {
    nextGate.current = {key: paginationKey, open: !!selected && !!first && coherent && authorized && context.focused &&
      !query.isFetching && !query.isError && !!query.hasNextPage};
  }, [paginationKey, selected, first, coherent, authorized, context.focused, query.isFetching, query.isError, query.hasNextPage]);
  const sameRender = () => fence.current.key === key && fence.current.serial === renderSerial;
  const chooseReference = (value: string) => {
    if (!sameRender() || value === reference) return;
    try {const operation = context.capture(); context.assertCurrent(operation);} catch {return;}
    // Close the old admission synchronously, before React renders the new draft.
    fence.current = {key: '', serial: fence.current.serial + 1};
    setRenderSerial(fence.current.serial);
    setAuthorization(null); setSelection(null); setNotice(null); setReference(value);
  };
  const read = () => {
    if (!sameRender() || !authorizedNow() || !isSellerActivityTransactionId(reference) || !context.focused) return;
    try {
      const operation = context.capture(); context.assertCurrent(operation);
      const serial = fence.current.serial + 1; fence.current = {key, serial};
      setRenderSerial(serial);
      setSelection({key, serial, transactionId: reference}); setNotice(null);
    } catch {if (sameRender()) setNotice({key, text: 'La session a changé. Reprenez la lecture depuis la commande actuelle.'});}
  };
  const next = () => {
    if (!sameRender() || nextGate.current.key !== paginationKey || !nextGate.current.open || !selected || !coherent || !first ||
      query.isFetching || query.isError || !query.hasNextPage || !authorizedNow()) return;
    try {const operation = context.capture(); assertSelection(selected); context.assertCurrent(operation);
      nextGate.current = {key: paginationKey, open: false};
      void query.fetchNextPage().catch(() => undefined);
    } catch {if (sameRender()) setNotice({key, text: 'Cette source doit être relue avant de poursuivre.'});}
  };
  const verified = async () => {
    if (!sameRender()) return;
    try {
      const operation = context.capture(); context.assertCurrent(operation);
      const serial = fence.current.serial + 1; fence.current = {key, serial}; setRenderSerial(serial);
      setSelection(null); setNotice(null); setAuthorization(null);
      const assertCurrent = () => {assertSelection({key, serial, transactionId: reference}); context.assertCurrent(operation);};
      const verifiedAt = await SellerActivityFactsService.authenticationTime(uid, assertCurrent); assertCurrent();
      setAuthorization({key, verifiedAt});
    } catch { /* A stale confirmation cannot admit another order. */ }
  };
  const renderRow = useCallback(({item: row}: ListRenderItemInfo<Row>) => {
    if (row.kind === 'page') {
      const {page, index} = row;
      return <View style={styles.record}>
        <Text accessibilityRole="header" style={styles.body}>Page {index + 1} · lecture du {new Date(page.readAt).toLocaleString('fr-CA')}</Text>
        <Text selectable style={styles.caption}>Vendeur dérivé de la commande : {page.sellerId}</Text>
        <Text style={styles.caption}>{page.pagination.inspected} document(s) inspecté(s), limite {page.pagination.limit}. {page.pagination.hasMore ? 'Une suite est possible ; la page suivante peut être vide.' : 'Fin de ce parcours borné.'}</Text>
        <Text selectable style={styles.caption}>Après : {page.coverage.afterId ?? 'début'} · premier : {page.coverage.firstInspectedId ?? 'aucun'} · dernier inspecté : {page.coverage.lastInspectedId ?? 'aucun'}</Text>
        <Text style={styles.caption}>Profil enregistré le : {dateText(page.profile.recordedCreatedAt)}. Création Auth : {dateText(page.profile.authCreatedAt)}.</Text>
        <Text selectable style={styles.caption}>Profil · révision : {page.profile.source.revision ?? 'document absent'} · empreinte : {page.profile.source.sourceHash}</Text>
        <Text selectable style={styles.caption}>Page · empreinte : {page.pageHash}</Text>
      </View>;
    }
    const {item} = row;
    return <View style={styles.record}>
      <Text selectable style={styles.body}>Commande : {item.transactionId} · {item.qualification === 'native_order' ? 'parties natives qualifiées' : 'qualification inconnue'}</Text>
      <Text selectable style={styles.caption}>Statut enregistré : {item.recordedStatus ?? 'inconnu'} · révision : {item.source.revision ?? 'inconnue'} · empreinte : {item.source.sourceHash}</Text>
      <Text style={styles.caption}>Création enregistrée : {dateText(item.createdAt)}</Text>
      <Text style={styles.caption}>Paiement enregistré : {dateText(item.paidAt)}</Text>
      <Text style={styles.caption}>Libération enregistrée : {dateText(item.releasedAt)}</Text>
      <Text style={styles.body}>Total de commande : {moneyText(item.amounts.orderTotal)}</Text>
      <Text style={styles.caption}>Prix de l’article : {moneyText(item.amounts.articlePrice)} · brut vendeur : {moneyText(item.amounts.sellerGross)}</Text>
      <Text style={styles.caption}>Capture carte enregistrée : {moneyText(item.amounts.cardCaptured)}</Text>
      <Text style={styles.caption}>Débit du porte-monnaie enregistré : {moneyText(item.amounts.walletDebited)}</Text>
      <Text style={styles.caption}>Crédit vendeur original, affectation à la dette incluse : {moneyText(item.amounts.sellerCredit)}</Text>
      <Text style={styles.caption}>Libération de ces mêmes fonds : {moneyText(item.amounts.release)}</Text>
      <Text style={styles.caption}>Remboursement natif total : {moneyText(item.amounts.nativeRefund.total)}</Text>
      <Text style={styles.caption}>Part carte du remboursement : {moneyText(item.amounts.nativeRefund.card)}</Text>
      <Text style={styles.caption}>Part porte-monnaie du remboursement : {moneyText(item.amounts.nativeRefund.wallet)}</Text>
      <Text style={styles.caption}>Registre acheteur : {ledgerText(item.financialSources.buyerLedger)}</Text>
      <Text style={styles.caption}>Registre vendeur : {ledgerText(item.financialSources.sellerLedger)}</Text>
      {(['buyerLedger', 'sellerLedger'] as const).map(side => item.financialSources[side]?.sources.map(entry =>
        <Text key={`${side}:${entry.id}`} selectable style={styles.caption}>{side === 'buyerLedger' ? 'Acheteur' : 'Vendeur'} · {entry.id} · révision {entry.revision ?? 'inconnue'} · {entry.sourceHash}</Text>))}
    </View>;
  }, []);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Faits enregistrés de l’activité vendeur</Text>
    <Text style={styles.caption}>Choisissez une commande, même sans dossier de fraude. Le serveur en dérive le vendeur. Cette lecture consultative n’établit ni fraude, statut professionnel ou appréciation de l’activité et n’accorde aucune permission financière, de restriction ou de remise en vente.</Text>
    <TextInput value={reference} onChangeText={chooseReference} autoCapitalize="none" autoCorrect={false} maxLength={128}
      accessibilityLabel="Référence de la commande pour lire l’activité vendeur" placeholder="Référence de commande" placeholderTextColor={colors.muted} style={styles.input} />
    {suggestedTransactionId && suggestedTransactionId !== reference ? <Button variant="secondary" disabled={!context.focused}
      onPress={() => chooseReference(suggestedTransactionId)}>Utiliser la commande proposée : {suggestedTransactionId}</Button> : null}
    <Text style={styles.caption}>La confirmation d’identité ouvre seulement cette lecture privée. Le serveur vérifie une authentification de cinq minutes au plus à chaque page.</Text>
    <AdminFinancialReauthentication uid={uid} sourceKey={JSON.stringify([key, renderSerial])} purpose="commercial" parcel
      disabled={!context.focused || !isSellerActivityTransactionId(reference) || query.isFetching}
      onVerified={() => {void verified();}} />
    <Button variant="secondary" disabled={!context.focused || !authorized || !isSellerActivityTransactionId(reference)} onPress={read}>
      {selected ? 'Relire cette commande depuis le début' : 'Lire les faits de cette commande'}
    </Button>
    {!context.focused ? <Text style={styles.caption}>Revenez à cet écran avec une session opérateur actuelle pour reprendre.</Text> : null}
    {selected && query.isFetching ? <Text style={styles.caption}>Lecture des sources natives ; les pages précédentes sont masquées pendant cette lecture…</Text> : null}
    {selected && (query.isError || !coherent) ? <Text accessibilityRole="alert" style={styles.caption}>Les pages ne sont plus présentées comme actuelles. Une source, la session ou sa qualification a changé : confirmez votre identité si nécessaire, puis relisez cette commande depuis le début.</Text> : null}
    {first && coherent ? <>
      <Text selectable style={styles.caption}>Commande choisie : {first.anchorTransactionId} · révision : {first.source.orderRevision} · empreinte : {first.source.orderSourceHash} · périmètre : {first.source.scopeHash}</Text>
      <Text style={styles.caption}>Ordre par identifiant de document, sans chronologie ni historique exhaustif vérifiés. Chaque page décrit sa propre lecture, sans instantané comptable ni total global. Les crédits, remboursements et libérations restent distincts : ils ne s’additionnent pas comme des ventes. Les dates enregistrées ne prouvent ni l’instant Stripe ni une arrivée bancaire.</Text>
      <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View>
      {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetching || !authorized} onPress={next}>Inspecter les commandes suivantes</Button> : null}
    </> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <AdminSellerActivityReview uid={uid} suggestedAnchor={first && coherent ? {kind: 'order', id: first.anchorTransactionId} : null}/>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, record: {gap: spacing.sm, paddingVertical: spacing.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border}, list: {height: spacing.xl * 14}});
