import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import { BusinessCessationJournal as Journal } from '@/services/businessCessationJournal';
import { purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import type { BusinessCessationAccess as Access, BusinessCessationCommand as Command, BusinessCessationReference as Reference, BusinessCessationReceipt as Receipt } from '@/types/businessCessation';
import { BusinessCessationReauthentication } from './BusinessCessationReauthentication';

const labels: Record<Command['action'], string> = {create_plan: 'Créer un plan documentaire', advance_inventory: 'Inventorier la prochaine page native', seal_inventory: 'Sceller l’inventaire parcouru', export_next_page: 'Archiver la prochaine page expurgée', seal_export: 'Sceller le manifeste d’archive', link_claim: 'Rattacher cette obligation à ma réclamation', export_claim: 'Archiver ma réclamation privée'};
/** One guarded action, including explicit resume without any recovered client body. */
export function BusinessCessationAction({uid, access, sourceKey, command, reference, onRecorded}: {
  uid: string; access: Access; sourceKey: string; command?: Command; reference?: Reference; onRecorded: (receipt: Receipt) => void;
}) {
  const native = useShippingPurchaseContext(`cessation-action-native:${sourceKey}`, uid), context = useLabelLifecycleContext(`cessation-action:${sourceKey}`, uid), client = useQueryClient(), owner = auth.currentUser;
  const key = JSON.stringify([uid, access, sourceKey, native.focusRevision]), lock = useRef<symbol | null>(null);
  type Lease = {key: string; owner: typeof owner; op: ReturnType<typeof native.capture>; verified: boolean};
  const lease = useRef<Lease | null>(null), live = useRef({key, context});
  const [ready, setReady] = useState<{key: string; owner: typeof owner; activityRevision: string; requestId: string; accepted: boolean; receipt: Receipt | null} | null>(null);
  const readyRef = useRef(ready);
  const replaceReady = (value: typeof ready) => {readyRef.current = value; setReady(value);};
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), identity = useRef({key, owner});
  useLayoutEffect(() => {if (identity.current.key !== key || identity.current.owner !== owner) {identity.current = {key, owner}; lease.current = null; lock.current = null; readyRef.current = null; setReady(null); setBusy(false); setNotice('');} live.current = {key, context};}, [key, context, owner]);
  const current = context.focused && ready?.key === key && ready.owner === auth.currentUser && ready.activityRevision === context.focusRevision ? ready : null;
  const assertOwner = () => {if (auth.currentUser !== owner || live.current.key !== key) throw new Error('Le dossier ou la connexion a changé.');};
  const qualify = async (guard: () => void) => {
    guard();
    if (reference) {
      const r = await Service.command(reference, 'observe', guard); guard(); if (r.state !== 'pending' || r.action === null || !r.planId) throw new Error('Seul un export réservé peut reprendre.');
      if (access === 'admin') await Service.plan(uid, r.planId, guard); else {if (!r.claimId) throw new Error('Réclamation native requise.'); await Service.claim(uid, r.claimId, guard);} guard(); return r;
    }
    if (!command) throw new Error('Instruction documentaire requise.');
    if (command.action === 'create_plan') await Service.status(uid, guard);
    else if (command.action === 'link_claim') {const s = await Service.status(uid, guard); guard(); if (s.planId !== command.planId) throw new Error('Le plan indiqué par le contrôle a changé.');}
    else if (command.action === 'export_claim') {const c = await Service.claim(uid, command.claimId, guard); guard(); if (c.planId !== command.planId) throw new Error('Réclamation modifiée.');}
    else {const p = await Service.plan(uid, command.planId, guard); guard(); if (p.version !== command.expectedVersion) throw new Error('Relisez la version actuelle du plan avant une nouvelle instruction.');}
    guard(); return null;
  };
  const startChallenge = () => {assertOwner(); context.capture(); if (lease.current || lock.current) throw new Error('Instruction déjà en cours.'); lease.current = {key, owner, op: native.capture(), verified: false}; replaceReady(null);};
  const assertLease = (value: Lease) => {native.assertCurrent(value.op); assertOwner(); if (lease.current !== value || auth.currentUser !== value.owner) throw new Error('Vérification périmée.');};
  const verified = () => {const value = lease.current; if (!value) return; value.verified = true;
    void (async () => {const token = Symbol(); lock.current = token; setBusy(true); try {
      await new Promise<void>((resolve, reject) => {const check = () => {try {assertLease(value); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      const active = live.current.context, op = active.capture(), guard = () => {assertLease(value); active.assertCurrent(op);};
      const receipt = await qualify(guard); guard(); replaceReady({key, owner: value.owner, activityRevision: active.focusRevision, requestId: reference?.requestId ?? randomUUID(), accepted: false, receipt});
    } catch (error) {try {assertLease(value); setNotice(error instanceof Error ? error.message : 'Les sources restent à relire.');} catch { /* No former-context result. */ }}
    finally {if (lease.current === value) lease.current = null; if (lock.current === token) {lock.current = null; setBusy(false);}}})();
  };
  const endChallenge = () => {if (lease.current && !lease.current.verified) lease.current = null;};
  const execute = async () => {
    if (!current || readyRef.current !== current || current.owner !== auth.currentUser || auth.currentUser !== owner || !current.accepted || lock.current) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const selected = current, token = Symbol(); lock.current = token; setBusy(true); setNotice('');
    const guard = () => {context.assertCurrent(op); assertOwner(); if (selected.owner !== auth.currentUser || readyRef.current !== selected) throw new Error('La connexion a changé.');};
    try {
      const fresh = await qualify(guard); guard(); if (reference && (!fresh || !selected.receipt || !equal(fresh, selected.receipt))) throw new Error('Le reçu réservé a changé.');
      let result: Receipt;
      if (reference) result = await Journal.resume(reference, guard);
      else {if (!command) throw new Error('Instruction absente.'); const a = await Service.reference(uid, access, selected.requestId, command, guard); guard(); result = await Journal.execute(a, command, guard);}
      guard(); replaceReady(null); setNotice('Le reçu natif de cette même instruction est conservé dans votre suivi. Les obligations restent à traiter séparément.'); onRecorded(result);
    } catch {if (context.isCurrent(op) && selected.owner === auth.currentUser) {replaceReady(null); setNotice('Relisez la même intention dans votre suivi. Aucun corps restauré n’est renvoyé, aucun règlement ou disponibilité future n’est supposé.');}}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} if (context.isCurrent(op) && selected.owner === auth.currentUser) {void client.invalidateQueries({queryKey: ['business-cessation-history', uid]}); void client.invalidateQueries({queryKey: ['business-cessation-discovery', uid]});}}
  };
  if (!native.focused || auth.currentUser !== owner) return null;
  return <View style={styles.section}>
    {context.focused ? <Text style={styles.body}>{reference ? 'Reprendre ce seul export réservé avec sa référence conservée' : command ? labels[command.action] : 'Instruction à sélectionner'}</Text> : null}
    <BusinessCessationReauthentication uid={uid} access={access} sourceKey={key} disabled={busy} onStart={startChallenge} onEnd={endChallenge} onVerified={verified} />
    {current ? <><Text style={styles.caption}>Les sources actuelles ont été relues. Cette instruction ne modifie pas le contrôle commercial, ne finance aucune réserve et ne règle aucune obligation.</Text>
      <Checkbox checked={current.accepted} disabled={busy} onToggle={() => {try {assertOwner(); context.capture(); if (readyRef.current === current) replaceReady({...current, accepted: !current.accepted});} catch { /* Exact current confirmation only. */ }}}><Text style={styles.caption}>Je confirme cette seule instruction sur les sources et la version relues.</Text></Checkbox>
      <Button disabled={busy || !current.accepted} onPress={() => {void execute();}}>{reference ? 'Reprendre le même export réservé' : 'Enregistrer cette instruction de continuité'}</Button></> : null}
    {context.focused && notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
