/** Member-operated test transport. No admin grant, production switch, carrier
 * webhook or fabricated carrier event is accepted through this endpoint. */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { advanceDevShipping, devShippingOrder, devShippingId } from '../config/devShippingSimulation';
import { isDevCommerceShippingTestRuntime, isDevCommerceStripeTestRuntime } from '../config/runtimeEnvironment';
import { qualifiedOrderTransportQuote } from '../config/shippingTransportPolicy';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { withFinancialRecoveryScope } from '../utils/financialRecoveryInterlock';
import { readQualifiedTracking, applyTrackingOutcome, trackingOutcomeMatches } from '../utils/trackingTransition';
import { ShipEngineClient } from '../config/shipEngine';
import { releasePurchaseHeldFunds } from '../scheduled/releaseHeldFunds';
import { checkRateLimit } from '../utils/rateLimit';
import { hasUnsettledRefund } from '../utils/refundState';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledReturnRequest, committedReturnReceipt } from '../utils/returnRequest';
import { processReturnDelivered } from '../utils/returnRefund';
import { financialRecoveryCommitCheckpoint, financialRecoverySourceFields } from '../utils/financialRecoverySources';
import { FieldValue } from '../config/firebase';

const actions = ['in_transit', 'delivered', 'release_funds'] as const;
type Action = typeof actions[number];
function input(request: any): {transactionId: string; action: Action; uid: string; leg: 'forward' | 'return'} {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const data = request.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['transactionId','action','expectedUid','leg'].includes(key)) ||
      data.expectedUid !== request.auth.uid || typeof data.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.transactionId) ||
      !actions.includes(data.action) || data.leg !== undefined && !['forward','return'].includes(data.leg) ||
      data.leg === 'return' && data.action === 'release_funds')
    throw new HttpsError('invalid-argument', 'Compte, commande et action de test exacts requis.');
  return { transactionId: data.transactionId, action: data.action, uid: request.auth.uid, leg: data.leg ?? 'forward' };
}
function runtime() {
  if (!isDevCommerceShippingTestRuntime() || !isDevCommerceStripeTestRuntime())
    throw new HttpsError('failed-precondition', 'Ce parcours de test est disponible uniquement dans Seconde Dev avec les clés de test.');
}
export const devAdvanceShipping = onCall({ region: 'northamerica-northeast1', memory: '512MiB',
  secrets: ['SHIPENGINE_API_KEY','STRIPE_SECRET_KEY'] }, async request => {
  runtime();
  const {transactionId, action, uid, leg} = input(request);
  return withFinancialRecoveryScope({operation: 'callable/devCommerce.devAdvanceShipping'}, async () =>
    withPrivateAccountSession(request, async () => {
      await checkRateLimit(uid, true, {functionName: 'devAdvanceShipping', maxCallsAuthenticated: 30,
        maxCallsUnauthenticated: 0, windowMs: 60_000});
      const transactionRef = db.collection('transactions').doc(transactionId);
      const participantGuard = async (tx: FirebaseFirestore.Transaction) => {
        runtime();
        await assertPrivateAccountSession(request, tx);
        const order = (await tx.get(transactionRef)).data();
        if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
        if (order.buyerId !== uid && order.sellerId !== uid) throw new HttpsError('permission-denied', 'Cette commande ne vous appartient pas.');
        if (!devShippingOrder(order) || order.deliveryType !== 'shipping' || typeof order.shippingQuoteId !== 'string' || order.shippingQuoteId.includes('/'))
          throw new HttpsError('failed-precondition', 'Une commande de livraison simulée Seconde Dev est requise.');
        const quote = (await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data();
        if (qualifiedOrderTransportQuote(order, quote, transactionId)?.testMode !== 'seconde_dev_commerce_v1')
          throw new HttpsError('failed-precondition', 'Le devis de cette simulation ne peut pas être confirmé.');
        if (leg === 'return') {
          if (!committedReturnReceipt(transactionId, order) || order.returnCarrierCode !== 'seconde_dev' || !devShippingId(order.returnLabelId))
            throw new HttpsError('failed-precondition', 'Une étiquette de retour de test engagée est requise.');
        } else if (!['label_created','shipped','delivered','completed'].includes(order.status) || order.disputed === true ||
            hasUnsettledRefund(order) || hasActiveBankDispute(order) || hasUnsettledReturnRequest(order))
          throw new HttpsError('failed-precondition', 'La commande doit être réglée et sans réclamation active pour avancer cette simulation.');
        return order;
      };
      const original = await db.runTransaction(participantGuard);
      let changed = false;
      if (action === 'release_funds') {
        if (!['delivered','completed'].includes(original.status)) throw new HttpsError('failed-precondition', 'Simulez la livraison avant la fin du délai.');
        changed = await releasePurchaseHeldFunds(transactionId, original.sellerId, participantGuard, {actorId: uid});
      } else {
        await db.runTransaction(async tx => {
          const order = await participantGuard(tx);
          await advanceDevShipping(tx, leg === 'return' ? order.returnLabelId : order.shipEngineLabelId, action, uid);
        });
        const current = (await transactionRef.get()).data()!;
        const tracking = await readQualifiedTracking(transactionId, current, leg);
        if (leg === 'forward') {
          const outcome = await applyTrackingOutcome(transactionId, ShipEngineClient.mapStatus(tracking.statusCode),
            'seconde_dev_member_test_action', tracking.proof, participantGuard);
          changed = 'changed' in outcome && outcome.changed;
        } else if (tracking.statusCode === 'DE') {
          await processReturnDelivered(transactionId, 'seconde_dev_member_test_action', tracking.proof, participantGuard);
          changed = !current.returnDeliveredAt && (await transactionRef.get()).data()?.returnDeliveredAt != null;
        } else {
          changed = await db.runTransaction(async tx => {
            const order = await participantGuard(tx);
            if (!await trackingOutcomeMatches(tx, transactionId, order, tracking.proof, 'return')) return false;
            const mapped = ShipEngineClient.mapStatus(tracking.statusCode);
            if (order.returnTrackingStatus === mapped) return false;
            const checkpoint = financialRecoveryCommitCheckpoint();
            await checkpoint({refs:[transactionRef.path]});
            tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,order,{
              returnTrackingStatus: mapped, returnTrackingObservation: {...tracking.proof, source: 'seconde_dev_member_test_action', recordedAt: FieldValue.serverTimestamp()}}));
            return true;
          });
        }
      }
      const current = (await transactionRef.get()).data();
      if (!current || current.buyerId !== uid && current.sellerId !== uid) throw new HttpsError('permission-denied', 'La commande a changé.');
      logger.info('Seconde Dev shipping simulation command', {transactionId, action, leg, actorId: uid, changed, realShipment: false});
      return {success: true, transactionId, action, status: current.status as string, changed,
        simulated: true, realShipment: false, fundsReleased: current.fundsReleasedAt != null};
    }));
});
