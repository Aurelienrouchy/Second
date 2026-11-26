import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateTransportRecoveryJournal } from '@/services/lateTransportRecoveryJournal';
import { LateTransportRecoveryService } from '@/services/lateTransportRecoveryService';
import { productReviewEqual } from '@/services/productReviewService';
import { colors, spacing, typography } from '@/constants/theme';
import type { RecoveryAttempt, RecoveryPossession, RecoveryRestitution, RecoverySource } from '@/types/lateTransportRecovery';
const possessionLabels: Record<RecoveryPossession, string> = { held_by_me: 'Je détiens actuellement l’article', not_held_by_me: 'Je ne détiens pas actuellement l’article', unknown: 'Possession inconnue' };
const restitutionLabels: Record<RecoveryRestitution, string> = { returned_to_seller_declared: 'Retour au vendeur déclaré', retained_by_buyer_declared: 'Conservation par l’acheteur déclarée', not_returned_declared: 'Article non restitué déclaré', unknown: 'Restitution inconnue' };
export function LateTransportRecoveryStatement({ uid, source, disabled, assertSelection }: {
    uid: string;
    source: RecoverySource;
    disabled: boolean;
    assertSelection?: () => void;
}) {
    const context = useLabelLifecycleContext(`recovery-statement:${source.transactionId}:${source.incidentId}`, uid), client = useQueryClient();
    const key = JSON.stringify([uid, source.source, context.focusRevision]), live = useRef(key), epoch = useRef(0), lock = useRef(false);
    const [possession, setPossession] = useState<RecoveryPossession>('unknown'), [restitution, setRestitution] = useState<RecoveryRestitution>('unknown');
    const [narrative, setNarrative] = useState(''), [date, setDate] = useState(''), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null);
    useLayoutEffect(() => { live.current = key; epoch.current++; return () => { live.current = ''; }; }, [key]);
    const edit = (work: () => void) => {try {context.capture(); assertSelection?.(); epoch.current++; work();} catch { /* Old selection. */ }};
    const submit = async () => {
        if (disabled || !source.canRecordStatementNow || lock.current)
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
        const revision = epoch.current;
        const assertCurrent = () => { context.assertCurrent(op); assertSelection?.(); if (live.current !== key || epoch.current !== revision)
            throw new Error('Votre déclaration a changé. Relisez-la avant de confirmer.'); };
        try {
            if (date.trim() && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date.trim()))
                throw new Error('Précisez la date, l’heure et le fuseau, par exemple 2026-10-14T14:30-04:00, ou laissez vide.');
            const occurredAt = date.trim() ? new Date(date.trim()).toISOString() : null;
            if (occurredAt && Date.parse(occurredAt) > Date.now())
                throw new Error('La date déclarée doit être passée ; laissez vide si elle est inconnue.');
            const fresh = await LateTransportRecoveryService.source(uid, source.transactionId, source.incidentId, 'owner', assertCurrent);
            assertCurrent();
            if (!fresh.canRecordStatementNow || !productReviewEqual(fresh.source, source.source))
                throw new Error('Les sources ont changé. Relisez le dossier.');
            const attempt: RecoveryAttempt = { version: 1, uid, scope: 'owner', requestId: randomUUID(), command: { transactionId: source.transactionId, incidentId: source.incidentId, source: source.source, action: 'statement', possession, restitution, narrative: narrative.trim(), occurredAt } };
            await LateTransportRecoveryJournal.prepare(attempt, assertCurrent);
            assertCurrent();
            const receipt = await LateTransportRecoveryJournal.execute(attempt, assertCurrent);
            assertCurrent();
            setNotice({ key, text: receipt.state === 'committed' ? 'Votre déclaration est enregistrée. Elle reste déclarative et ne confirme aucune remise en vente.' : 'Le même reçu reste à consulter dans le journal de récupération.' });
        }
        catch (error) {
            try {
                assertCurrent();
                setNotice({ key, text: error instanceof Error ? error.message : 'La déclaration doit être relue.' });
            }
            catch { /* Old interaction. */ }
        }
        finally {
            context.finish(op);
            lock.current = false;
            if (context.isCurrent(op)) {
                setBusy(null);
                void client.invalidateQueries({ queryKey: ['late-transport-recovery', uid] });
            }
        }
    };
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Ma déclaration de possession et de restitution</Text>
    <Text style={styles.caption}>Décrivez votre situation actuelle pour cet article et cet incident. Une déclaration ne certifie ni la possession physique ni la propriété juridique. Une partie absente ou un désaccord maintient l’examen nécessaire.</Text>
    {(Object.keys(possessionLabels) as RecoveryPossession[]).map(value => <Button key={value} variant={possession === value ? 'primary' : 'secondary'} disabled={disabled || busy === key} onPress={() => edit(() => setPossession(value))}>{possessionLabels[value]}</Button>)}
    {(Object.keys(restitutionLabels) as RecoveryRestitution[]).map(value => <Button key={value} variant={restitution === value ? 'primary' : 'secondary'} disabled={disabled || busy === key} onPress={() => edit(() => setRestitution(value))}>{restitutionLabels[value]}</Button>)}
    <TextInput accessibilityLabel="Date déclarée avec heure et fuseau" placeholder="Date et heure ISO avec fuseau, ou vide si inconnues" placeholderTextColor={colors.muted} value={date} onChangeText={v => edit(() => setDate(v))} editable={!disabled && busy !== key} style={styles.input}/>
    <TextInput accessibilityLabel="Mon constat de récupération" placeholder="Décrivez les faits et les limites de votre connaissance" placeholderTextColor={colors.muted} multiline maxLength={2000} value={narrative} onChangeText={v => edit(() => setNarrative(v))} editable={!disabled && busy !== key} style={styles.input}/>
    <Button disabled={disabled || busy === key || !narrative.trim() || !source.canRecordStatementNow || source.source.stateVersion < 0} onPress={() => { void submit(); }}>Enregistrer ma déclaration pour ces sources</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, input: { ...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md } });
