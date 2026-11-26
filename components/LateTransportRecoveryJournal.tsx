import { type ReactNode, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateTransportRecoveryJournal as Journal } from '@/services/lateTransportRecoveryJournal';
import { colors, spacing, typography } from '@/constants/theme';
import type { LateTransportScope } from '@/types/lateTransportIncident';
import type { RecoveryReceipt } from '@/types/lateTransportRecovery';
export function LateTransportRecoveryJournal({ uid, scope, renderReauthentication }: {
    uid: string;
    scope: LateTransportScope;
    renderReauthentication?: (props: {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; parcel?: boolean}) => ReactNode;
}) {
    const context = useLabelLifecycleContext(`recovery-journal:${scope}`, uid), client = useQueryClient();
    const key = JSON.stringify([uid, scope, context.focusRevision]), lock = useRef(false);
    const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null), [receipt, setReceipt] = useState<{
        key: string;
        value: RecoveryReceipt;
    } | null>(null);
    const journal = useQuery({ queryKey: ['late-transport-recovery', uid, 'journal', scope, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
        queryFn: () => { const op = context.capture(); return Journal.read(uid, scope, () => context.assertCurrent(op)); } });
    const pending = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
    const ownReceipt = receipt?.key === key && receipt.value.requestId === pending?.requestId ? receipt.value : null;
    const service = async (mode: 'observe' | 'execute' | 'neutralize' | 'acknowledge') => {
        if (!pending || lock.current)
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
            const result = await Journal[mode](pending, () => context.assertCurrent(op));
            context.assertCurrent(op);
            setReceipt({ key, value: result });
            void client.invalidateQueries({ queryKey: ['late-transport-recovery', uid] });
        }
        catch (error) {
            if (context.isCurrent(op)) {
                setNotice({ key, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.' });
                void journal.refetch();
            }
        }
        finally {
            context.finish(op);
            lock.current = false;
            if (context.isCurrent(op))
                setBusy(null);
        }
    };
    return <View style={styles.section}>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal privé de récupération doit être relu ; aucune nouvelle intention n’est admise.</Text> : null}
    {journal.isError ? <Button variant="secondary" disabled={!context.focused || busy === key} onPress={() => {try {context.capture(); void journal.refetch();} catch { /* Inactive. */ }}}>Relire mon journal privé</Button> : null}
    {pending ? <><Text accessibilityRole="header" style={styles.title}>Instruction de récupération conservée</Text>
      <Text selectable style={styles.caption}>{pending.requestId} · {pending.command.transactionId} · {pending.command.incidentId}</Text>
      <Text style={styles.body}>{pending.command.action === 'statement' ? pending.command.narrative : pending.command.partyMessage}</Text>
      <Text style={styles.caption}>Les reprises gardent exactement le même contenu et les mêmes sources. Une source modifiée demande une nouvelle instruction, après règlement du reçu précédent.</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void service('observe'); }}>Relire le même reçu</Button>
      {scope === 'admin' ? renderReauthentication?.({uid, sourceKey: `recovery-resume:${key}:${pending.requestId}`, disabled: busy === key, parcel: true, onVerified: () => {try {context.capture();} catch { /* Old verification. */ }}}) : null}
      <Button variant="secondary" disabled={busy === key} onPress={() => { void service('execute'); }}>Reprendre exactement cette instruction</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void service('neutralize'); }}>Neutraliser l’intention si elle n’a pas été exécutée</Button>
      {ownReceipt ? <Text style={styles.caption}>{ownReceipt.state === 'committed' ? 'Instruction enregistrée. Elle ne libère ni article ni fonds.' : ownReceipt.state === 'not_executed' ? `Instruction non exécutée : ${ownReceipt.reason}.` : 'Aucun reçu natif enregistré pour cette intention ; le résultat reste inconnu.'}</Text> : null}
      {ownReceipt && ownReceipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => { void service('acknowledge'); }}>Relire le reçu frais et terminer le suivi local</Button> : null}
    </> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
