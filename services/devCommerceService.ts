import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { DEV_COMMERCE_TESTING_ENABLED } from '@/config/featureFlags';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';

export type DevShippingAction = 'in_transit' | 'delivered' | 'release_funds';
export type DevShippingLeg = 'forward' | 'return';
export interface DevShippingResult {
  success: true; transactionId: string; action: DevShippingAction; status: string;
  changed: boolean; simulated: true; realShipment: false; fundsReleased: boolean;
}
export async function advanceDevShipping(uid: string, transactionId: string, action: DevShippingAction, guard: () => void, leg: DevShippingLeg = 'forward'): Promise<DevShippingResult> {
  if (!DEV_COMMERCE_TESTING_ENABLED) throw new Error('Les outils de test sont réservés à Seconde Dev.');
  const session = captureTradeSession(uid), current = () => { assertTradeSessionCurrent(session); guard(); };
  current();
  if (leg === 'return' && action === 'release_funds') throw new Error('La fin de retenue ne peut pas être simulée pendant un retour.');
  const { data } = await httpsCallable<{ expectedUid: string; transactionId: string; action: DevShippingAction; leg: DevShippingLeg }, unknown>(functions, 'devAdvanceShipping')({
    expectedUid: uid, transactionId, action, leg,
  });
  current();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Le résultat du test doit être relu dans la commande.');
  const result = data as Record<string, unknown>;
  if (result.success !== true || result.transactionId !== transactionId || result.action !== action ||
      result.simulated !== true || result.realShipment !== false || typeof result.changed !== 'boolean' || typeof result.fundsReleased !== 'boolean' ||
      typeof result.status !== 'string' || !result.status || result.status.length > 80) throw new Error('Le résultat du test doit être relu dans la commande.');
  return result as unknown as DevShippingResult;
}
