import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { ProductRoutingReviewJournal } from '@/services/productRoutingReviewJournal';
import type { ProductRoutingAttempt, ProductRoutingReceipt } from '@/types/productRoutingReview';
import { colors, spacing, typography } from '@/constants/theme';
const keyExtractor = (attempt: ProductRoutingAttempt) => JSON.stringify([attempt.context.id, attempt.requestId]);
export function ProductRoutingCommandHistory({ uid }: {
    uid: string;
}) {
    const context = useLabelLifecycleContext('product-routing-sdk-history', uid), key = JSON.stringify([uid, context.focusRevision]), lock = useRef(false);
    const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null), [receipt, setReceipt] = useState<{
        key: string;
        value: ProductRoutingReceipt;
    } | null>(null);
    const journal = useQuery({ queryKey: ['product-routing-sdk-history', key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => { const op = context.capture(); return ProductRoutingReviewJournal.list(uid, () => context.assertCurrent(op)); } });
    const attempts = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : [];
    const service = useCallback(async (attempt: ProductRoutingAttempt, mode: 'observe' | 'neutralize' | 'acknowledge') => {
        if (lock.current || attempt.uid !== uid)
            return;
        let op;
        try {
            op = context.start();
        }
        catch {
            return;
        }
        if (!op)
            return;
        lock.current = true;
        setBusy(key);
        setNotice(null);
        try {
            const value = await ProductRoutingReviewJournal[mode](attempt, () => context.assertCurrent(op));
            context.assertCurrent(op);
            setReceipt({ key, value });
            void journal.refetch();
        }
        catch (error) {
            if (context.isCurrent(op)) {
                setNotice({ key, text: error instanceof Error ? error.message : 'Le même reçu SDK doit être relu.' });
                void journal.refetch();
            }
        }
        finally {
            context.finish(op);
            lock.current = false;
            if (context.isCurrent(op))
                setBusy(null);
        }
    }, [context, journal, key, uid]);
    const renderItem = useCallback(({ item }: {
        item: ProductRoutingAttempt;
    }) => {
        const current = receipt?.key === key && receipt.value.requestId === item.requestId && receipt.value.command.context.id === item.context.id ? receipt.value : null;
        return <View style={styles.section}><Text selectable style={styles.caption}>Commande {item.context.id} · intention {item.requestId}.</Text><Text selectable style={styles.body}>{item.command.partyMessage}</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void service(item, 'observe'); }}>Relire mon propre reçu de routage</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void service(item, 'neutralize'); }}>Neutraliser ma même intention non engagée</Button>
      {current ? <Text style={styles.caption}>{current.state === 'committed' ? 'Instruction historique enregistrée ; aucune permission actuelle n’est qualifiée.' : current.state === 'not_executed' ? `Instruction non exécutée : ${current.reason}.` : 'Aucun reçu natif enregistré pour cette intention ; résultat inconnu.'}</Text> : null}
      {current && current.state !== 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => { void service(item, 'acknowledge'); }}>Relire le reçu frais et terminer le suivi local</Button> : null}
    </View>;
    }, [busy, key, receipt, service]);
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Mes intentions de routage conservées</Text>
    <Text style={styles.caption}>Seuls les propres reçus du compte connecté sont relus. Ce journal local ne donne aucun accès à de nouvelles sources privées et ne qualifie aucune permission actuelle ou exhaustivité historique.</Text>
    {attempts.length ? <View style={styles.viewport}><FlashList data={attempts} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View> : journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal doit être relu ; aucun résultat ne peut être déduit.</Text> : journal.isFetching ? <Text style={styles.caption}>Lecture du journal SDK…</Text> : <Text style={styles.caption}>Aucune intention locale qualifiée visible pour ce compte.</Text>}
    <Button variant="secondary" disabled={!context.focused || journal.isFetching || busy === key} onPress={() => { try {
        context.capture();
        void journal.refetch();
    }
    catch { /* Inactive. */ } }}>Relire mes intentions de routage conservées</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, viewport: { height: spacing['4xl'] * 5 } });
