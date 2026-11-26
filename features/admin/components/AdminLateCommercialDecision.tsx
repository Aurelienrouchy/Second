import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox, Input } from '@/components/ui';
import { LATE_COMMERCIAL_DECISION_LABELS } from '@/components/LateCommercialHistory';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { LateCommercialRecourseJournal } from '@/services/lateCommercialRecourseJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { COMMERCIAL_CLAIM_REVIEW_ENABLED } from '@/config/featureFlags';
import type { LateCommercialDecision, LateCommercialPreview, LateCommercialReceipt, CommercialClaimReexaminationPreview } from '@/types/lateCommercialRecourse';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';

export function AdminLateCommercialDecision({uid, preview, nativeAdmission, disabled, onRecorded, onJournalChanged, assertSelection}: {
  uid: string; preview: LateCommercialPreview | CommercialClaimReexaminationPreview; nativeAdmission: ProductPhysicalDocumentaryAdmission | null; disabled: boolean; assertSelection?: () => void;
  onRecorded: (receipt: LateCommercialReceipt | null) => void;
  onJournalChanged: () => void;
}) {
  const reexamination = preview.protocol === 'commercial_claim_reexamination_preview_v1';
  const context = useLabelLifecycleContext(`late-commercial-decision:${reexamination ? preview.originalDisputeId : preview.supportRequestId}`, uid);
  const key = JSON.stringify([uid, preview.sourceHash, preview.currentAdmission, nativeAdmission?.key, context.focusRevision]);
  const [draft, setDraft] = useState<{key: string; revision: number; decision: LateCommercialDecision | null; reason: string; partyMessage: string;
    acknowledged: boolean; reauthenticated: boolean} | null>(null);
  const current = draft?.key === key ? draft : {key, revision: 0, decision: null, reason: '', partyMessage: '', acknowledged: false, reauthenticated: false};
  const live = useRef(key), epoch = useRef(0), lock = useRef<symbol | null>(null);
  useLayoutEffect(() => {live.current = key; epoch.current++; return () => {live.current = '';};}, [key]);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const update = (patch: Partial<typeof current>) => {try {context.capture(); assertSelection?.(); epoch.current++; setDraft({...current, ...patch, revision: current.revision + 1, reauthenticated: false});} catch { /* Old source grants no interaction. */ }};
  const ready = (!reexamination || COMMERCIAL_CLAIM_REVIEW_ENABLED) && !disabled && context.focused && !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === 'admin' &&
    nativeAdmission.context.id === preview.transactionId && preview.currentAdmissionQualification !== 'unknown';
  const submit = async () => {
    if (!ready || lock.current || !current.decision || !preview.options.includes(current.decision) || !current.reason.trim() || !current.partyMessage.trim() || !current.acknowledged || !current.reauthenticated || !nativeAdmission) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(), revision = epoch.current; lock.current = token; setBusy(key); setNotice(null);
    const assertCurrent = () => {context.assertCurrent(op); assertSelection?.(); nativeAdmission.assertCurrent(); if (reexamination && !COMMERCIAL_CLAIM_REVIEW_ENABLED || live.current !== key || epoch.current !== revision) throw new Error('Votre décision ou les sources ont changé.');};
    try {
      assertCurrent(); await nativeAdmission.revalidate(); assertCurrent();
      const fresh = reexamination ? await LateCommercialRecourseService.previewReexamination(uid, preview.transactionId, preview.claimReexamination, assertCurrent) : await LateCommercialRecourseService.preview(uid, preview.supportRequestId, assertCurrent); assertCurrent();
      if (fresh.sourceHash !== preview.sourceHash || !productReviewEqual(fresh.currentAdmission, preview.currentAdmission) ||
        fresh.currentAdmissionQualification !== preview.currentAdmissionQualification || !fresh.options.includes(current.decision)) throw new Error('L’admission ou le corpus a changé. Relisez les sources actuelles.');
      const receipt = await LateCommercialRecourseJournal.execute({version: 1, uid, requestId: randomUUID(), command: {
        transactionId: preview.transactionId, ...(reexamination ? {supportRequestId: null, claimReexamination: preview.claimReexamination} : {supportRequestId: preview.supportRequestId}), sourceHash: preview.sourceHash, currentAdmission: preview.currentAdmission,
        decision: current.decision, reason: current.reason.trim(), partyMessage: current.partyMessage.trim(), acknowledged: true,
      }}, assertCurrent); assertCurrent();
      setNotice({key, text: receipt.state === 'committed' ? 'L’instruction et les avis sont enregistrés. Aucun mouvement financier n’a été autorisé.' :
        receipt.state === 'not_executed' ? 'Cette instruction n’a pas été exécutée. Relisez le même reçu et les sources avant un autre choix.' : 'Le résultat reste inconnu. Conservez la même intention.'});
      onRecorded(receipt);
    } catch (error) {
      try {assertCurrent(); setNotice({key, text: error instanceof Error ? error.message : 'Le résultat reste à vérifier dans le même journal.'}); onRecorded(null);} catch { /* No old callback can change the new draft. */ }
    } finally {context.finish(op); if (lock.current === token) {lock.current = null; if (context.isCurrent(op)) {setBusy(null); onJournalChanged();}}}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Instruction d’admission distincte</Text>
    <Text style={styles.caption}>Lisez le corpus et ses limites avant de choisir. L’admission permet l’examen de la réclamation ; elle n’établit ni défaut, faute, remboursement ou prolongation d’un recours. Le vendeur peut apporter une contradiction sans bloquer l’examen.</Text>
    {!nativeAdmission ? <Text style={styles.caption}>La lecture documentaire actuelle doit être qualifiée avant une nouvelle instruction.</Text> : null}
    {preview.options.map(decision => <Button key={decision} variant={current.decision === decision ? 'primary' : 'secondary'} disabled={!ready || busy === key}
      onPress={() => update({decision, acknowledged: false})}>{LATE_COMMERCIAL_DECISION_LABELS[decision]}</Button>)}
    {!preview.options.length ? <Text style={styles.caption}>Aucune nouvelle instruction n’est proposée dans cette source. L’historique et les propres reçus restent distincts.</Text> : null}
    <Input label="Motivation privée de cette instruction" value={current.reason} onChangeText={reason => update({reason, acknowledged: false})} multiline maxLength={4000} disabled={!ready || busy === key} />
    <Input label="Message communiqué à l’acheteur et au vendeur" value={current.partyMessage} onChangeText={partyMessage => update({partyMessage, acknowledged: false})} multiline maxLength={4000} disabled={!ready || busy === key} />
    <Checkbox checked={current.acknowledged} disabled={!ready || busy === key} onToggle={() => update({acknowledged: !current.acknowledged})}>
      <Text style={styles.caption}>J’ai examiné ces sources et leurs limites. Je confirme cette instruction et ce message exacts, sans autoriser de mouvement de fonds ni d’effacement des dossiers antérieurs.</Text>
    </Checkbox>
    <AdminFinancialReauthentication key={`${key}/${current.revision}`} uid={uid} sourceKey={`late-commercial-decision:${key}/${current.revision}`}
      purpose="commercial" parcel disabled={!ready || busy === key} onVerified={() => {
        try {context.capture(); assertSelection?.(); nativeAdmission?.assertCurrent(); if (live.current === key) setDraft(previous => previous?.key === key && previous.revision === current.revision ? {...previous, reauthenticated: true} :
          current.revision === 0 ? {...current, reauthenticated: true} : previous);} catch { /* Old verification. */ }
      }} />
    <Button disabled={!ready || busy === key || !current.decision || !current.reason.trim() || !current.partyMessage.trim() || !current.acknowledged || !current.reauthenticated}
      onPress={() => {void submit();}}>Enregistrer cette instruction et ses avis</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
