/** Existing meetup obligations: confirmations and receipts belong to their current dossier. */
import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { track } from '@/lib/analytics';
import { errCode } from './utils';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { meetupStoryMatches, readMeetupReportContext, readMeetupSupportContext } from '@/services/chat/meetup';
import type { RecourseReasonSheetRef } from '@/components/RecourseReasonSheet';
import { useRouter } from 'expo-router';
import type { MeetupSupportReason } from '@/types/supportRequest';

interface UseMeetupDialogsParams {
  chatId: string; articleId?: string; messageId: string; amount: number; isSeller: boolean;
  transactionId?: string | null;
  onConfirmMeetup?: (messageId: string) => Promise<void>;
  onCancelMeetup?: (messageId: string) => Promise<void>;
  onReportNoShow?: (messageId: string, reason?: string, details?: string, expectedDisputeId?: string | null) => Promise<void>;
  onCompleteMeetup?: (messageId: string) => Promise<void>;
}
interface DialogSpec {
  title: string; message: string; button: string; cancel?: string; destructive?: boolean;
  action?: () => Promise<void>; errorTitle: string; errorFallback: string;
  log?: (outcome: 'cancelled' | 'confirmed', result?: 'success' | 'error', errorCode?: string) => void;
  haptic?: Haptics.NotificationFeedbackType;
  receiptAlert?: { title: string; message: string };
}
interface ReportForm {
  uid: string; frame: symbol; focus: number; transactionId: string;
  disputeId: string | null; counter: boolean;
}

export function useMeetupDialogs({ chatId, articleId, messageId, amount, isSeller, transactionId,
  onConfirmMeetup, onCancelMeetup, onReportNoShow, onCompleteMeetup }: UseMeetupDialogsParams) {
  const context = useTradeOperation(JSON.stringify([chatId, articleId, messageId, amount, isSeller, transactionId]));
  const uid = useAuthenticatedUid();
  const router = useRouter();
  const reportContext = useShippingPurchaseContext(`meetup-report:${chatId}:${messageId}`, uid);
  const reportSheet = useRef<RecourseReasonSheetRef>(null);
  const reportBusy = useRef(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // Every opening owns its callbacks, even when the dossier is unchanged.
  // Closing a form revokes its old submit/close handlers synchronously.
  const reportOwner = useRef<ReportForm | null>(null);
  const [reportForm, setReportForm] = useState<ReportForm | null>(null);
  const currentReportForm = reportForm?.frame === reportContext.frame && reportForm.focus === reportContext.focusRevision && reportForm.uid === uid ? reportForm : null;
  const [isExiting, setIsExiting] = useState(false);
  const [reportPrevious, setReportPrevious] = useState({ frame: reportContext.frame, focus: reportContext.focusRevision });
  if (reportPrevious.frame !== reportContext.frame || reportPrevious.focus !== reportContext.focusRevision) {
    setReportPrevious({ frame: reportContext.frame, focus: reportContext.focusRevision });
    setReportForm(null); setReportSubmitting(false);
  }
  useLayoutEffect(() => { reportOwner.current = null; reportBusy.current = false; }, [reportContext.frame, reportContext.focusRevision]);
  useEffect(() => { if (currentReportForm) reportSheet.current?.present(); }, [currentReportForm]);
  const [previous, setPrevious] = useState({ frame: context.frame, focus: context.focusRevision });
  if (previous.frame !== context.frame || previous.focus !== context.focusRevision) {
    setPrevious({ frame: context.frame, focus: context.focusRevision }); setIsExiting(false);
  }
  const role = isSeller ? 'seller' as const : 'buyer' as const;
  const common = { chat_id: chatId, article_id: articleId ?? '', role };
  const open = async (spec: DialogSpec): Promise<void> => {
    if (!spec.action || !context.isOriginCurrent()) return;
    let operation;
    try { operation = context.start(); }
    catch (error) { if (context.isOriginCurrent()) Alert.alert(spec.errorTitle, error instanceof Error ? error.message : spec.errorFallback); return; }
    if (!operation) return;
    setIsExiting(true);
    await new Promise<void>(resolve => {
      let cancelled = false; let dispatched = false; let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (context.isCurrent(operation) && context.ownsLock(operation)) setIsExiting(false);
        context.finish(operation); resolve();
      };
      const cancel = () => {
        if (dispatched || cancelled || settled) return;
        cancelled = true;
        if (context.isCurrent(operation)) spec.log?.('cancelled');
        finish();
      };
      Alert.alert(spec.title, spec.message, [
        { text: spec.cancel ?? 'Annuler', style: 'cancel', onPress: cancel },
        { text: spec.button, style: spec.destructive ? 'destructive' : 'default', onPress: async () => {
          if (dispatched) return;
          if (cancelled || settled || !context.isCurrent(operation) || !context.ownsLock(operation)) { finish(); return; }
          dispatched = true;
          try {
            context.assertCurrent(operation);
            await spec.action!();
            context.assertCurrent(operation);
            if (spec.haptic) Haptics.notificationAsync(spec.haptic);
            spec.log?.('confirmed', 'success');
            if (spec.receiptAlert) Alert.alert(spec.receiptAlert.title, spec.receiptAlert.message);
          } catch (error) {
            if (!context.isCurrent(operation)) return;
            spec.log?.('confirmed', 'error', errCode(error));
            Alert.alert(spec.errorTitle, error instanceof Error && error.message ? error.message : spec.errorFallback);
          } finally { finish(); }
        } },
      ], { onDismiss: () => { if (!dispatched) cancel(); } });
    });
  };
  const handleConfirmMeetup = () => open({
    title: 'Confirmer le rendez-vous', message: 'Confirmez-vous ce rendez-vous ? Vous validerez la remise en main propre après la rencontre.', button: 'Confirmer le rendez-vous',
    action: onConfirmMeetup ? () => onConfirmMeetup(messageId) : undefined,
    errorTitle: 'Rendez-vous non confirmé', errorFallback: 'Impossible de confirmer le meetup.',
    haptic: Haptics.NotificationFeedbackType.Success,
    log: (dialog_outcome, result) => track('meetup_confirmed', { ...common, message_id: messageId, offer_amount_cents: Math.round(amount * 100), dialog_outcome, ...(result ? { result } : {}) }),
  });
  const handleCancelMeetup = () => open({
    title: 'Annuler la rencontre', message: "La rencontre sera annulée et l'article remis en vente. Personne n'est mis en cause. Cette action est définitive.",
    button: 'Annuler la rencontre', cancel: 'Retour', destructive: true,
    action: onCancelMeetup ? () => onCancelMeetup(messageId) : undefined,
    errorTitle: 'Rencontre non annulée', errorFallback: "Impossible d'annuler la rencontre.",
  });
  const openReportForm = async (counter: boolean) => {
    if (!onReportNoShow || reportBusy.current) return;
    let operation;
    try { operation = reportContext.start(); } catch { return; }
    if (!operation) return;
    reportBusy.current = true; setIsExiting(true);
    try {
      const native = await readMeetupReportContext(chatId, messageId, operation.session.uid, () => reportContext.assertCurrent(operation!));
      reportContext.assertCurrent(operation);
      if (counter && (!native.disputeId || !native.initialReporterId || native.initialReporterId === operation.session.uid)) throw new Error('Le signalement initial et la partie visée doivent être rapprochés.');
      const form = { uid: operation.session.uid, frame: reportContext.frame, focus: reportContext.focusRevision,
        transactionId: native.transactionId, disputeId: native.disputeId, counter };
      reportOwner.current = form;
      setReportForm(form);
    } catch (error) {
      if (reportContext.isCurrent(operation)) { setIsExiting(false); Alert.alert('Dossier à vérifier', error instanceof Error ? error.message : 'Le dossier exact doit être rapproché.'); }
    } finally { reportContext.finish(operation); if (reportContext.isCurrent(operation)) reportBusy.current = false; }
  };
  const handleContestNoShow = () => openReportForm(true);
  const handleReportNoShow = () => openReportForm(false);
  const openMeetupSupport = async (meetupReason: MeetupSupportReason) => {
    if (reportBusy.current) return;
    let operation;
    try { operation = reportContext.start(); } catch { return; }
    if (!operation) return;
    reportBusy.current = true;
    try {
      const native = await readMeetupSupportContext(chatId, messageId, operation.session.uid, () => reportContext.assertCurrent(operation!));
      reportContext.assertCurrent(operation);
      router.push({ pathname: '/settings/support', params: { kind: 'commercial_late', transactionId: native.transactionId, meetupReason } } as never);
    } catch (error) {
      if (reportContext.isCurrent(operation)) Alert.alert('Accord à rapprocher', error instanceof Error ? error.message : 'Contactez notre équipe depuis Aide avec la référence de votre accord.');
    } finally { reportContext.finish(operation); if (reportContext.isCurrent(operation)) reportBusy.current = false; }
  };
  const submitReport = async (reason: string, details: string) => {
    if (!currentReportForm || reportOwner.current !== currentReportForm || !onReportNoShow || reportBusy.current) return;
    let operation;
    try { operation = reportContext.start(); } catch { return; }
    if (!operation) return;
    const assertFormCurrent = () => {
      reportContext.assertCurrent(operation);
      if (reportOwner.current !== currentReportForm) throw new Error('Ce formulaire a été fermé.');
    };
    const isFormCurrent = () => reportOwner.current === currentReportForm && reportContext.isCurrent(operation);
    reportBusy.current = true; setReportSubmitting(true);
    try {
      const before = await readMeetupReportContext(chatId, messageId, operation.session.uid, assertFormCurrent);
      assertFormCurrent();
      const ownReplay = meetupStoryMatches(before.ownDeclaration, operation.session.uid, reason, details);
      if (before.transactionId !== currentReportForm.transactionId || before.disputeId !== currentReportForm.disputeId &&
          !(currentReportForm.disputeId === null && ownReplay)) throw new Error('Le dossier a changé. Votre brouillon reste conservé.');
      await onReportNoShow(messageId, reason, details, currentReportForm.disputeId);
      assertFormCurrent();
      const native = await readMeetupReportContext(chatId, messageId, operation.session.uid, assertFormCurrent);
      assertFormCurrent();
      if (native.transactionId !== currentReportForm.transactionId || currentReportForm.disputeId && native.disputeId !== currentReportForm.disputeId ||
          !native.disputeId || !meetupStoryMatches(native.ownDeclaration, operation.session.uid, reason, details)) throw new Error('Votre récit doit être relu avec ce dossier. Le brouillon reste conservé.');
      await reportSheet.current?.clearAcknowledgedDraft(); assertFormCurrent();
      reportOwner.current = null;
      reportSheet.current?.dismiss(); setReportForm(null); setIsExiting(false);
      Alert.alert('Récit enregistré', `Votre récit est enregistré dans le dossier ${native.disputeId}. Notre équipe pourra examiner les versions des deux personnes.`);
    } catch (error) {
      if (isFormCurrent()) Alert.alert('Récit à vérifier', error instanceof Error ? error.message : 'Le brouillon reste conservé.');
    } finally {
      reportContext.finish(operation);
      if (reportContext.isCurrent(operation) && (reportOwner.current === currentReportForm || reportOwner.current === null)) { reportBusy.current = false; setReportSubmitting(false); }
    }
  };
  const reportSheetProps = currentReportForm ? {
    ref: reportSheet, title: currentReportForm.counter ? 'Donner ma version' : 'Décrire les faits de la rencontre',
    intro: currentReportForm.counter ? `Votre récit sera ajouté au dossier ${currentReportForm.disputeId}, en conservant le signalement initial.` : 'Décrivez ce qui s’est passé, sans supposer les intentions de l’autre personne.',
    reasons: [{ code: 'other_party_no_show', label: 'Absence ou désaccord sur la présence' }, { code: 'cancelled_last_minute', label: 'Annulation au dernier moment' },
      { code: 'unsafe_situation', label: 'Situation dangereuse ou pression' }, { code: 'other', label: 'Autres faits' }],
    showDetailsField: true, detailsRequired: true, modal: true, detailsMaxLength: 1000, submitLabel: 'Enregistrer mon récit', isSubmitting: reportSubmitting,
    draftScope: { uid: currentReportForm.uid, transactionId: currentReportForm.transactionId, purpose: currentReportForm.counter ? `meetup_counter_${currentReportForm.disputeId}` : `meetup_report_${messageId}` },
    onSubmit: submitReport, onClose: () => {
      if (!reportBusy.current && reportOwner.current === currentReportForm) {
        reportOwner.current = null; setReportForm(null); setIsExiting(false);
      }
    },
  } : null;
  const handleCompleteMeetup = () => open({
    title: 'Terminer la transaction', message: 'Confirmez-vous que la remise en main propre a bien eu lieu ?', button: 'Terminer',
    action: onCompleteMeetup ? () => onCompleteMeetup(messageId) : undefined,
    errorTitle: 'Transaction non finalisée', errorFallback: 'Impossible de terminer la transaction. Réessayez ou contactez le support.',
    haptic: Haptics.NotificationFeedbackType.Success, log: (dialog_outcome, result, error_code) => track('meetup_completed', { ...common, ...(transactionId ? { transaction_id: transactionId } : {}), offer_amount_cents: Math.round(amount * 100), dialog_outcome, ...(result ? { result } : {}), ...(error_code ? { error_code } : {}) }),
  });
  // Each handler owns the lock across both Alert and IO, including callers that do not wrap it.
  const guardExit = (fn: () => Promise<void>) => fn;
  return { isExiting, guardExit, handleConfirmMeetup, handleCancelMeetup, handleContestNoShow, handleReportNoShow, handleCompleteMeetup, reportSheetProps, openMeetupSupport };
}
