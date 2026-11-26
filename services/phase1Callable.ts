import { httpsCallable, type Functions, type HttpsCallableOptions } from 'firebase/functions';
import { phase1CallableName } from '@/config/catalogueCallableContracts';

/** Only the RPC endpoint is versioned. Journals, operation names and receipt
 * hashes retain their original domain contract, including on an exact retry. */
export function phase1HttpsCallable<RequestData = unknown, ResponseData = unknown, StreamData = unknown>(
  functions: Functions,
  name: string,
  options?: HttpsCallableOptions,
) {
  const endpoint = phase1CallableName(name);
  return options === undefined
    ? httpsCallable<RequestData, ResponseData, StreamData>(functions, endpoint)
    : httpsCallable<RequestData, ResponseData, StreamData>(functions, endpoint, options);
}
