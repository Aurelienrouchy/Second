import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../../utils/privateAccountSession';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { quotePurchase, saveShippingParcel, readShippingParcel } from '../../utils/shippingPurchase';
const options = { region: 'northamerica-northeast1', memory: '512MiB' as const };
async function guard(request: any, name: string) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, { functionName: name, maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60_000 });
}
export const setArticleShippingParcel = onCall(options, async request => withFinancialRecoveryScope({operation: "callable/payments/shippingPurchase.setArticleShippingParcel"}, async () => withPrivateAccountSession(request, async () => {
  await guard(request, 'setArticleShippingParcel');
  return saveShippingParcel(request.auth!.uid, request.data, tx => assertPrivateAccountSession(request, tx));
})));
export const quoteShippingPurchase = onCall({ ...options, secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] }, async request => withFinancialRecoveryScope({operation: "callable/payments/shippingPurchase.quoteShippingPurchase"}, async () => withPrivateAccountSession(request, async () => {
  await guard(request, 'quoteShippingPurchase');
  return quotePurchase(request.auth!.uid, request.data, tx => assertPrivateAccountSession(request, tx));
})));

export const getArticleShippingParcel = onCall(options, async request => withFinancialRecoveryScope({operation: "callable/payments/shippingPurchase.getArticleShippingParcel"}, async () => withPrivateAccountSession(request, async () => {
  await guard(request, 'getArticleShippingParcel');
  return readShippingParcel(request.auth!.uid, request.data?.articleId, tx => assertPrivateAccountSession(request, tx));
})));
