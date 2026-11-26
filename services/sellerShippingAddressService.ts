import {doc, getDocFromServer, runTransaction, serverTimestamp} from 'firebase/firestore';
import {firestore} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewHash} from '@/services/productReviewService';
import {hasCurrentOrdinaryShippingDeclaration, ordinaryPhysicalAddress} from '@/utils/ordinaryShippingAddress';
import type {SellerShippingAddressObservation, ShippingPurchaseAddress} from '@/types/shippingPurchase';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function selectedSource(data: Record<string, unknown>) {
  const raw = data.addresses;
  if (raw !== undefined && !Array.isArray(raw)) return {qualification: 'malformed_address_collection' as const, index: null, selected: null, fingerprint: ['malformed_collection', raw], canEdit: false};
  const addresses: unknown[] = Array.isArray(raw) ? raw : [];
  if (addresses.length === 0) return {qualification: 'not_recorded' as const, index: null, selected: null, fingerprint: ['no_address', raw === undefined ? 'absent' : 'empty_array'], canEdit: true};
  const preferred = addresses.findIndex(value => object(value) && value.isDefault === true), index = preferred >= 0 ? preferred : 0, chosen = addresses[index];
  const qualification = object(chosen) && ordinaryPhysicalAddress(chosen) ? 'native_selected_address' as const : 'malformed_selected_address' as const;
  return {qualification, index, selected: object(chosen) ? chosen : null, fingerprint: ['selected_address', index, chosen], canEdit: true};
}
async function observation(uid: string, data: Record<string, unknown>, current: () => void): Promise<SellerShippingAddressObservation> {
  const chosen = selectedSource(data), sourceHash = await productReviewHash(chosen.fingerprint); current();
  return {protocol: 'seller_shipping_address_observation_v1', ownerId: uid, sourceHash, selectedIndex: chosen.index,
    qualification: chosen.qualification, selected: chosen.selected, canEdit: chosen.canEdit};
}
export const SellerShippingAddressService = {
  async read(uid: string, guard: () => void): Promise<SellerShippingAddressObservation> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    const snap = await getDocFromServer(doc(firestore, 'users', uid)); current();
    if (!snap.exists()) throw new Error('Le profil privé doit être relu avant de configurer une adresse d’expédition.');
    return observation(uid, snap.data(), current);
  },
  async save(uid: string, source: SellerShippingAddressObservation, address: ShippingPurchaseAddress, guard: () => void): Promise<void> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (source.ownerId !== uid || !source.canEdit || !ordinaryPhysicalAddress(address) || address.province !== 'QC' || typeof address.name !== 'string' || !address.name.trim() || address.name.trim().length > 100 ||
        !await hasCurrentOrdinaryShippingDeclaration(address)) throw new Error('Saisissez et déclarez une adresse d’expédition ordinaire complète au Québec.'); current();
    await runTransaction(firestore, async tx => {
      current(); const ref = doc(firestore, 'users', uid), snap = await tx.get(ref); current();
      if (!snap.exists()) throw new Error('Le profil privé n’est plus disponible.');
      const data = snap.data(), chosen = selectedSource(data), fresh = await observation(uid, data, current); current();
      if (!fresh.canEdit || fresh.sourceHash !== source.sourceHash || fresh.selectedIndex !== source.selectedIndex) throw new Error('L’adresse d’expédition sélectionnée a changé. Relisez-la avant toute mise à jour.');
      const addresses: unknown[] = Array.isArray(data.addresses) ? [...data.addresses] : [];
      const metadata = {...(chosen.selected ?? {})};
      for (const key of ['street', 'line2', 'city', 'province', 'postalCode', 'country', 'name', 'shippingUseDeclaration']) delete metadata[key];
      const next = {...metadata, ...address, name: address.name.trim(),
        ...(chosen.index === null ? {isDefault: true} : {})};
      // An ordinary choice cannot silently erase a structured PO-box/PUDO
      // selection from the same native address. Such a source needs review.
      if (!await hasCurrentOrdinaryShippingDeclaration(next)) throw new Error('Cette ancienne adresse comporte une sélection non ordinaire à faire examiner avant sa réutilisation.'); current();
      if (chosen.index === null) addresses.push(next); else addresses[chosen.index] = next;
      current(); tx.update(ref, {addresses, updatedAt: serverTimestamp()});
    }); current();
  },
};
