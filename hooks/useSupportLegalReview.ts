import {useRef, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {getAuthSessionGeneration} from '@/store/authStore';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {SupportLegalReviewJournal as Journal} from '@/services/supportLegalReviewJournal';
import {SupportLegalReviewService as Service, legalReviewGuard, legalReviewReceipt, newLegalReviewId} from '@/services/supportLegalReviewService';
import type {LegalReviewArea, LegalReviewCommand, LegalReviewResult} from '@/types/supportLegalReview';
/** Only opaque descriptors enter the query cache. One-shot private results are
 * delivered directly to the caller while its exact SDK/source guard still holds. */
export function useSupportLegalReview(uid: string, area: LegalReviewArea, sourceKey: string) {
  const frame = useLabelLifecycleContext(`legal-command:${area}:${sourceKey}`, uid), client = useQueryClient(), lock = useRef<symbol | null>(null);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), area, sourceKey, frame.focusRevision]);
  const [state, setState] = useState({key, busy: false, notice: ''});
  const own = useQuery({queryKey: ['support-legal-review-journal', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, area, () => frame.assertCurrent(op));}});
  const current = state.key === key ? state : {key, busy: false, notice: ''};
  const available = frame.focused && !current.busy && own.isSuccess && !own.isFetching && !own.isError && own.data === null;
  const execute = async (command: LegalReviewCommand, verify: () => void, adopt: (result: LegalReviewResult, owner: NonNullable<typeof auth.currentUser>) => void) => {
    if (lock.current || !available) return; const ticket = Symbol(); let operation;
    try {verify(); operation = frame.start();} catch {return;} if (!operation) return;
    const owner = auth.currentUser; if (!owner) {frame.finish(operation); return;}
    const guard = legalReviewGuard(uid, () => {frame.assertCurrent(operation); verify();});
    lock.current = ticket; setState({key, busy: true, notice: ''});
    try {
      guard(); const attempt = await Service.attempt(uid, area, newLegalReviewId(), command, guard); guard();
      const result = await Journal.submit(attempt, command, guard, guard); guard(); adopt(result, owner); guard();
      const receipt = legalReviewReceipt(result);
      if (receipt.state !== 'unrecorded') {await Journal.acknowledge(attempt, guard); guard();}
      setState({key, busy: false, notice: receipt.state === 'committed' ? 'Acte privé enregistré ; aucun envoi externe n’a été exécuté.' : receipt.state === 'not_executed' ? 'Cette instruction est close sans nouvel acte. Relisez les sources avant de poursuivre.' : 'L’issue reste à rapprocher dans votre suivi minimal.'});
    } catch {try {guard(); setState({key, busy: false, notice: 'L’issue ou la lecture privée reste inconnue. Relisez votre suivi minimal avant toute nouvelle instruction.'});} catch {/* No private result after SDK/source change. */}}
    finally {frame.finish(operation); if (lock.current === ticket) lock.current = null; if (frame.isCurrent(operation)) setState(old => old.key === key ? {...old, busy: false} : old); void client.invalidateQueries({queryKey: ['support-legal-review-journal']});}
  };
  return {execute, available, busy: current.busy, notice: current.notice};
}
