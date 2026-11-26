import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateTransportRecoveryService } from '@/services/lateTransportRecoveryService';
import { LateTransportRecoveryJournal } from '@/services/lateTransportRecoveryJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { RECOVERY_CRITERIA, type RecoveryAssessment, type RecoveryAttempt, type RecoveryCriterion, type RecoveryReview, type RecoverySource } from '@/types/lateTransportRecovery';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
const labels: Record<RecoveryCriterion, string> = { article_identity: 'Identité du même article', physical_availability: 'Disponibilité physique déclarée', contradictions: 'Contradictions entre les parties et les pièces', restitution_context: 'Contexte, dates et concordance de restitution' };
export function AdminLateTransportRecoveryDecision({ uid, source, nativeAdmission, disabled, onRecorded, assertSelection }: {
    uid: string;
    source: RecoverySource;
    nativeAdmission: ProductPhysicalDocumentaryAdmission | null;
    disabled: boolean;
    assertSelection?: () => void;
    onRecorded: () => void;
}) {
    const context = useLabelLifecycleContext(`recovery-review:${source.transactionId}:${source.incidentId}`, uid), client = useQueryClient();
    const key = JSON.stringify([uid, source.source, nativeAdmission?.key, context.focusRevision]), epoch = useRef(0), live = useRef(key), lock = useRef(false);
    const empty = { key, revision: 0, action: 'retain_review' as RecoveryReview['action'], assessments: RECOVERY_CRITERIA.map(criterion => ({ criterion, qualification: 'unknown' as const, summary: '' })) as RecoveryAssessment[], privateReason: '', partyMessage: '', acknowledged: false, reauthenticated: false };
    const [draft, setDraft] = useState<typeof empty | null>(null), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null);
    const current = draft?.key === key ? draft : empty;
    useLayoutEffect(() => { live.current = key; epoch.current++; return () => { live.current = ''; }; }, [key]);
    const update = (patch: Partial<typeof current>) => { try {
        context.capture();
        assertSelection?.();
        epoch.current++;
        setDraft({ ...current, ...patch, revision: current.revision + 1, reauthenticated: false, acknowledged: patch.acknowledged ?? false });
    }
    catch { /* Old interaction. */ } };
    const admitted = !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === 'admin' && nativeAdmission.context.kind === 'order' && nativeAdmission.context.id === source.transactionId && nativeAdmission.parcelCapability === 'product_review_parcel_v1' && nativeAdmission.materialCapability === undefined && nativeAdmission.corpusHash === source.source.corpusHash;
    const ready = !disabled && context.focused && source.qualification === 'native_context' && source.source.stateVersion >= 0 && admitted;
    const allExamined = current.assessments.every(a => a.qualification === 'examined');
    const valid = ready && current.privateReason.trim() && current.partyMessage.trim() && current.assessments.every(a => a.summary.trim()) && current.acknowledged && current.reauthenticated && (current.action === 'retain_review' || source.canCompleteOwnReviewNow && source.documentaryComplete && allExamined);
    const submit = async () => {
        if (!valid || !nativeAdmission || lock.current)
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
        const assertCurrent = () => { context.assertCurrent(op); assertSelection?.(); nativeAdmission.assertCurrent(); if (live.current !== key || epoch.current !== revision)
            throw new Error('La décision, les sources ou le corpus ont changé.'); };
        try {
            assertCurrent();
            await nativeAdmission.revalidate();
            assertCurrent();
            const fresh = await LateTransportRecoveryService.source(uid, source.transactionId, source.incidentId, 'admin', assertCurrent);
            assertCurrent();
            if (!productReviewEqual(fresh.source, source.source) || current.action === 'complete_own_review' && !fresh.canCompleteOwnReviewNow)
                throw new Error('Les sources actuelles demandent une nouvelle lecture.');
            const attempt: RecoveryAttempt = { version: 1, uid, scope: 'admin', requestId: randomUUID(), command: { transactionId: source.transactionId, incidentId: source.incidentId, source: source.source, action: current.action, assessments: current.assessments.map(a => ({ ...a, summary: a.summary.trim() })), privateReason: current.privateReason.trim(), partyMessage: current.partyMessage.trim(), examinedCorpus: true } };
            await LateTransportRecoveryJournal.prepare(attempt, assertCurrent);
            assertCurrent();
            const receipt = await LateTransportRecoveryJournal.execute(attempt, assertCurrent);
            assertCurrent();
            setNotice({ key, text: receipt.state === 'committed' ? 'Instruction et avis enregistrés pour la seule revue de récupération. Aucun stock ou fonds n’a été modifié.' : 'Le résultat reste à lire dans le même journal privé.' });
            onRecorded();
        }
        catch (error) {
            try {
                assertCurrent();
                setNotice({ key, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.' });
            }
            catch { /* No old callback. */ }
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
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Instruction de récupération physique</Text>
    <Text style={styles.caption}>Examinez les pièces reçues du corpus natif et les constats actuels des deux parties. Un scan, une déclaration isolée, une contradiction, une date inconnue ou un dossier incomplet ne permet pas d’achever cette revue. Les anciens remboursements et mouvements restent distincts.</Text>
    {!admitted ? <Text style={styles.caption}>Relisez le corpus exact de ce colis avant de consigner une nouvelle instruction.</Text> : null}
    <Button variant={current.action === 'retain_review' ? 'primary' : 'secondary'} disabled={!ready || busy === key} onPress={() => update({ action: 'retain_review' })}>Maintenir l’examen de récupération</Button>
    <Button variant={current.action === 'complete_own_review' ? 'primary' : 'secondary'} disabled={!ready || busy === key || !source.canCompleteOwnReviewNow} onPress={() => update({ action: 'complete_own_review' })}>Achever uniquement cette revue</Button>
    {current.assessments.map((assessment, index) => <View key={assessment.criterion} style={styles.section}><Text style={styles.body}>{labels[assessment.criterion]}</Text>
      <Button variant={assessment.qualification === 'unknown' ? 'primary' : 'secondary'} disabled={!ready || busy === key} onPress={() => update({ assessments: current.assessments.map((a, i) => i === index ? { ...a, qualification: 'unknown' } : a) })}>Qualification inconnue</Button>
      <Button variant={assessment.qualification === 'examined' ? 'primary' : 'secondary'} disabled={!ready || busy === key} onPress={() => update({ assessments: current.assessments.map((a, i) => i === index ? { ...a, qualification: 'examined' } : a) })}>Critère examiné avec ses limites</Button>
      <Input label={`Appréciation : ${labels[assessment.criterion]}`} value={assessment.summary} multiline maxLength={2000} disabled={!ready || busy === key} onChangeText={summary => update({ assessments: current.assessments.map((a, i) => i === index ? { ...a, summary } : a) })}/>
    </View>)}
    <Input label="Motivation privée" value={current.privateReason} multiline maxLength={2000} disabled={!ready || busy === key} onChangeText={privateReason => update({ privateReason })}/>
    <Input label="Message communiqué aux deux parties" value={current.partyMessage} multiline maxLength={2000} disabled={!ready || busy === key} onChangeText={partyMessage => update({ partyMessage })}/>
    <Checkbox checked={current.acknowledged} disabled={!ready || busy === key} onToggle={() => update({ acknowledged: !current.acknowledged })}><Text style={styles.caption}>J’ai examiné ce corpus exact et ses limites. Cette instruction ne certifie ni la possession physique ni le titre juridique, ne libère pas le stock et n’autorise aucun mouvement financier.</Text></Checkbox>
    <AdminFinancialReauthentication key={`${key}/${current.revision}`} uid={uid} sourceKey={`recovery-decision:${key}/${current.revision}`} purpose="commercial" parcel disabled={!ready || busy === key} onVerified={() => { try {
        context.capture();
        assertSelection?.();
        nativeAdmission?.assertCurrent();
        if (live.current === key)
            setDraft(previous => previous?.key === key ? (previous.revision === current.revision ? { ...previous, reauthenticated: true } : previous) : current.revision === 0 ? { ...current, reauthenticated: true } : previous);
    }
    catch { /* Old verification. */ } }}/>
    <Button disabled={!valid || busy === key} onPress={() => { void submit(); }}>Enregistrer cette instruction et ses avis</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
