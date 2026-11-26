import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox, Input } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { PRODUCT_ROUTING_REVIEW_ENABLED } from '@/config/featureFlags';
import { ProductRoutingReviewService } from '@/services/productRoutingReviewService';
import { ProductRoutingReviewJournal } from '@/services/productRoutingReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { PRODUCT_ROUTING_CAPABILITY, type ProductRoutingAttempt, type ProductRoutingCommand, type ProductRoutingPreview } from '@/types/productRoutingReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { ProductRoutingReauthentication, type RoutingReauthentication } from '@/components/ProductRoutingReauthentication';
import { colors, spacing, typography } from '@/constants/theme';
const choices = { action: ['maintain_review', 'routing_resolved_for_current_sources'], routingFinding: ['correction_examined', 'no_destination_error_established', 'unresolved'], destinationFinding: ['native_destination_examined', 'unknown'], contradictions: ['resolved_for_reviewed_sources', 'unresolved', 'unknown'] } as const;
const labels: Record<string, string> = { maintain_review: 'Maintenir la revue de routage', routing_resolved_for_current_sources: 'Clore la seule revue pour ces sources', correction_examined: 'Correction rapportée examinée', no_destination_error_established: 'Aucune erreur de destination établie dans les sources', unresolved: 'Non résolu', native_destination_examined: 'Destination native exacte examinée', unknown: 'Inconnu', resolved_for_reviewed_sources: 'Contradictions résolues pour les seules sources examinées' };
export function ProductRoutingDecisionForm({ uid, preview, nativeAdmission, disabled, renderReauthentication, onRecorded, assertSelection }: {
    uid: string;
    preview: ProductRoutingPreview;
    nativeAdmission: ProductPhysicalDocumentaryAdmission;
    disabled: boolean;
    renderReauthentication?: RoutingReauthentication;
    onRecorded: () => void;
    assertSelection: () => void;
}) {
    const context = useLabelLifecycleContext(`product-routing-decision:${preview.context.id}`, uid), epoch = useRef(0), lock = useRef(false);
    const key = JSON.stringify([uid, preview.sourceHash, preview.semanticSourceHash, preview.corpusHash, preview.membersHash, preview.caseVersion, nativeAdmission.key, context.focusRevision]), live = useRef(key);
    const empty = { key, revision: 0, action: null as ProductRoutingCommand['action'] | null, routingFinding: null as ProductRoutingCommand['routingFinding'] | null, destinationFinding: null as ProductRoutingCommand['destinationFinding'] | null, contradictions: null as ProductRoutingCommand['contradictions'] | null, privateNote: '', partyMessage: '', evidenceLimitations: '', acknowledged: false, reauthenticated: false };
    const [draft, setDraft] = useState<typeof empty | null>(null), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null), form = draft?.key === key ? draft : empty;
    useLayoutEffect(() => { live.current = key; epoch.current++; return () => { live.current = ''; }; }, [key]);
    const update = (patch: Partial<typeof form>) => { try {
        context.capture();
        assertSelection();
        nativeAdmission.assertCurrent();
        epoch.current++;
        setDraft({ ...form, ...patch, revision: form.revision + 1, acknowledged: patch.acknowledged ?? false, reauthenticated: false });
    }
    catch { /* Old source. */ } };
    const ready = !disabled && PRODUCT_ROUTING_REVIEW_ENABLED && context.focused && preview.scope === 'admin' && preview.guardQualification === 'native_current_routing_signals' && nativeAdmission.uid === uid && nativeAdmission.scope === 'admin' && nativeAdmission.context.id === preview.context.id && nativeAdmission.sourceHash === preview.sourceHash && nativeAdmission.corpusHash === preview.corpusHash && nativeAdmission.parcelCapability === 'product_review_parcel_v1';
    const resolved = form.action === 'routing_resolved_for_current_sources', valid = ready && form.action && form.routingFinding && form.destinationFinding && form.contradictions && form.privateNote.trim() && form.partyMessage.trim() && form.evidenceLimitations.trim() && form.acknowledged && form.reauthenticated && (!resolved || preview.canConsiderRoutingResolution && form.routingFinding !== 'unresolved' && form.destinationFinding === 'native_destination_examined' && form.contradictions === 'resolved_for_reviewed_sources');
    const submit = async () => {
        if (!valid || lock.current)
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
        const assertCurrent = () => { context.assertCurrent(op); assertSelection(); nativeAdmission.assertCurrent(); if (live.current !== key || epoch.current !== revision || !PRODUCT_ROUTING_REVIEW_ENABLED)
            throw new Error('Le choix, le corpus ou les sources de routage ont changé.'); };
        try {
            assertCurrent();
            await nativeAdmission.revalidate();
            assertCurrent();
            const fresh = await ProductRoutingReviewService.preview(uid, preview.context, 'admin', assertCurrent);
            assertCurrent();
            if (!productReviewEqual([fresh.sourceHash, fresh.semanticSourceHash, fresh.corpusHash, fresh.membersHash, fresh.caseVersion, fresh.guardQualification, fresh.canConsiderRoutingResolution], [preview.sourceHash, preview.semanticSourceHash, preview.corpusHash, preview.membersHash, preview.caseVersion, preview.guardQualification, preview.canConsiderRoutingResolution]))
                throw new Error('Le routage ou le corpus actuel doit être relu avant une nouvelle instruction.');
            const command: ProductRoutingCommand = { context: preview.context, sourceHash: preview.sourceHash, semanticSourceHash: preview.semanticSourceHash, corpusHash: preview.corpusHash, membersHash: preview.membersHash, caseVersion: preview.caseVersion, action: form.action!, routingFinding: form.routingFinding!, destinationFinding: form.destinationFinding!, contradictions: form.contradictions!, privateNote: form.privateNote.trim(), partyMessage: form.partyMessage.trim(), evidenceLimitations: form.evidenceLimitations.trim(), acknowledged: true };
            const attempt: ProductRoutingAttempt = { version: 1, uid, requestId: randomUUID(), context: preview.context, command, routingCapability: PRODUCT_ROUTING_CAPABILITY, parcelCapability: 'product_review_parcel_v1' };
            const receipt = await ProductRoutingReviewJournal.execute(attempt, assertCurrent);
            assertCurrent();
            setNotice({ key, text: receipt.state === 'committed' ? 'Instruction de routage enregistrée. Les autres gardes, le contrat, le label et les décisions financières restent distincts.' : 'Le même reçu reste à vérifier dans le journal.' });
            onRecorded();
        }
        catch (error) {
            try {
                assertCurrent();
                setNotice({ key, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.' });
                onRecorded();
            }
            catch { /* No old callback can alter the new choice. */ }
        }
        finally {
            context.finish(op);
            lock.current = false;
            if (context.isCurrent(op))
                setBusy(null);
        }
    };
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Examen motivé du routage et des contradictions</Text>
    {!PRODUCT_ROUTING_REVIEW_ENABLED ? <Text style={styles.caption}>Les nouvelles instructions de routage restent en préparation. L’historique et vos propres reçus restent consultables.</Text> : null}
    {(Object.keys(choices) as (keyof typeof choices)[]).map(field => <View key={field} style={styles.section}><Text style={styles.body}>{({ action: 'Instruction sur la seule revue de routage', routingFinding: 'Constat examiné', destinationFinding: 'Destination', contradictions: 'Contradictions dans les sources disponibles' })[field]}</Text>{choices[field].map(value => <Button key={value} variant={form[field] === value ? 'primary' : 'secondary'} disabled={!ready || busy === key || value === 'routing_resolved_for_current_sources' && !preview.canConsiderRoutingResolution} onPress={() => update({ [field]: value })}>{labels[value]}</Button>)}</View>)}
    {(['privateNote', 'partyMessage', 'evidenceLimitations'] as const).map(field => <Input key={field} label={({ privateNote: 'Motivation privée', partyMessage: 'Message communiqué aux deux parties', evidenceLimitations: 'Limites du corpus et des éléments examinés' })[field]} value={form[field]} multiline maxLength={field === 'evidenceLimitations' ? 2000 : 4000} disabled={!ready || busy === key} onChangeText={value => update({ [field]: value })}/>)}
    <Checkbox checked={form.acknowledged} disabled={!ready || busy === key} onToggle={() => update({ acknowledged: !form.acknowledged })}><Text style={styles.caption}>J’ai examiné le corpus exact, les lieux déclarés, le contrat, la route native de l’étiquette et les contradictions. Cette instruction ne certifie ni possession ou récupération, ne modifie aucun label/contrat/frais, et n’autorise aucune opération financière.</Text></Checkbox>
    <ProductRoutingReauthentication render={renderReauthentication} uid={uid} sourceKey={`product-routing-decision:${key}/${form.revision}`} disabled={!ready || busy === key} parcel onVerified={() => { try {
            context.capture();
            assertSelection();
            nativeAdmission.assertCurrent();
            if (live.current === key)
                setDraft(old => old?.key === key ? (old.revision === form.revision ? { ...old, reauthenticated: true } : old) : form.revision === 0 ? { ...form, reauthenticated: true } : old);
        }
        catch { /* Old verification. */ } } } />
    <Button disabled={!valid || busy === key} onPress={() => { void submit(); }}>Enregistrer cette instruction de routage exacte</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
