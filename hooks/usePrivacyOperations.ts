import {useRef, useState} from 'react';
import {useQuery, useQueryClient, type QueryKey} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {PrivacyOperationsService as Service, privacyFailure, privacyGuard} from '@/services/privacyOperationsService';
import {PrivacyOperationsJournal as Journal} from '@/services/privacyOperationsJournal';
import {getAuthSessionGeneration} from '@/store/authStore';
import type {PrivacyCommand, PrivacyReceipt} from '@/types/privacyOperations';
/** The SDK object captured at render is part of every retained callback's authority. */
export function usePrivacyOperations(uid: string, caseId: string | null, sourceKey: string, assertSelection?: () => void) {
  const sdk = auth.currentUser, frame = useLabelLifecycleContext(`privacy-operations:${sourceKey}:${caseId}`, uid), client = useQueryClient(), lock = useRef(false);
  const [identity, setIdentity] = useState({sdk, revision: 0});
  if (identity.sdk !== sdk) setIdentity({sdk, revision: identity.revision + 1});
  const key = JSON.stringify([uid, getAuthSessionGeneration(), caseId, sourceKey, frame.focusRevision, identity.revision]);
  const guard = () => {if (!sdk || auth.currentUser !== sdk || sdk.uid !== uid) throw privacyFailure(); frame.capture(); assertSelection?.();};
  const capture = () => {guard(); const op = frame.capture(); return privacyGuard(uid, () => {guard(); frame.assertCurrent(op);});};
  const [state, setState] = useState({key, busy: false, notice: ''});
  const current = state.key === key ? state : {key, busy: false, notice: ''};
  const query = useQuery({queryKey: ['privacy-operation-own', uid, key], enabled: frame.focused && sdk?.uid === uid, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const check = capture(); return {sdk, value: await Journal.read(uid, check)};}});
  const available = frame.focused && query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === sdk && auth.currentUser === sdk && query.data.value === null && !current.busy;
  const sourceGuard = (queryKey: QueryKey, snapshot: unknown) => {
    const check = capture(); return () => {check(); const q = client.getQueryState(queryKey); if (client.getQueryData(queryKey) !== snapshot || q?.status !== 'success' || q.fetchStatus !== 'idle' || q.isInvalidated) throw privacyFailure();};
  };
  const execute = async (command: PrivacyCommand, verify: () => void, adopt?: (receipt: PrivacyReceipt) => void) => {
    if (!available || !caseId || lock.current) return; let check; try {check = capture(); verify();} catch {return;}
    lock.current = true; setState({key, busy: true, notice: ''});
    try {
      const fresh = () => {check(); verify();}; fresh(); const a = await Service.attempt(uid, caseId, command, fresh); fresh();
      const receipt = await Journal.submit(a, command, fresh, fresh); fresh(); adopt?.(receipt); fresh();
      if (receipt.state !== 'unrecorded') {await Journal.acknowledge(a, fresh); fresh();}
      setState({key, busy: false, notice: receipt.state === 'committed' ? 'Instruction enregistrée. Relisez son résultat natif ; ce reçu ne prouve aucun effacement ni achèvement de la demande.' : 'Issue à rapprocher dans votre suivi minimal avant de poursuivre.'});
      check(); await client.invalidateQueries({queryKey: ['privacy-operations', key]}); check();
    } catch {try {check(); setState({key, busy: false, notice: 'L’issue reste inconnue. Relisez le reçu exact dans votre suivi minimal avant toute nouvelle instruction.'});} catch {/* No adoption from a stale SDK/source. */}}
    finally {lock.current = false; try {check(); void client.invalidateQueries({queryKey: ['privacy-operation-own', uid]});} catch {/* An old operation cannot cause a read in another session or case. */}}
  };
  return {frame, key, sdk, guard, capture, sourceGuard, execute, available, busy: current.busy, notice: current.notice};
}
