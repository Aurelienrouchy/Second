/**
 * Stripe Account Service — cycle de vie du compte vendeur Stripe Connect Custom.
 *
 * Toutes les fonctions délèguent à des callables Cloud Function (white-label :
 * le vendeur ne visite jamais Stripe, l'app est l'unique surface de
 * remédiation). Les montants restent en cents côté backend ; ce service ne fait
 * que router le bon contrat et normaliser la réponse pour l'UI.
 *
 * - getAccountStatus     → getStripeAccountStatus (état complet : charges/payouts/
 *                          requirements/disabledReason/bankAccountLast4)
 * - uploadIdentityDocument → uploadStripeIdentityDocument (KYC, base64 sans
 *                          data-URI, recto + verso optionnel)
 * - replaceBankAccount   → addBankAccount (remplacement default_for_currency)
 *
 * Upload image RN 0.83 : on resize+compress via prepareImageForUpload PUIS on
 * lit le fichier en base64 via expo-file-system/legacy (le Web SDK
 * uploadString/uploadBytes(Uint8Array) crashe en RN 0.83 ; ici on ne touche pas
 * Storage — on envoie le base64 directement à la callable qui crée le Stripe
 * File).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';

import { functions } from '@/config/firebaseConfig';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type {
  AddBankAccountResponse,
  StripeAccountStatus,
  UploadIdentityDocumentResponse,
} from '@/features/wallet/utils/stripeRequirements';

interface BankOwnershipInput {
  requestId: string;
  accountHolderName: string;
  bankOwnershipAccepted: true;
  bankOwnershipStatementVersion: string;
}

export interface ReplaceBankAccountInput extends BankOwnershipInput {
  mode: 'replace';
  transitNumber: string;
  institutionNumber: string;
  accountNumber: string;
}

export interface DeclareCurrentBankInput extends BankOwnershipInput {
  mode: 'declare_current';
  bankAccountId: string;
}

export type BankAccountOperationInput = ReplaceBankAccountInput | DeclareCurrentBankInput |
  ({mode: 'select_existing'; bankAccountId: string; requestId: string} & Partial<Omit<BankOwnershipInput, 'requestId'>>) |
  {mode: 'delete_existing'; bankAccountId: string; requestId: string} | { requestId: string };

/** A competing Connect observation invalidated this read, not the account. */
export function isStaleConnectObservation(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) ||
      !['functions/aborted', 'aborted'].includes(String(error.code)) || !('details' in error) ||
      !error.details || typeof error.details !== 'object') return false;
  const details = error.details as {reason?: unknown; action?: unknown};
  return details.reason === 'connect_observation_stale' && details.action === 'getStripeAccountStatus';
}

export class StripeAccountService {
  /**
   * État complet du compte vendeur. Le backend persiste également les champs
   * dérivés sur users/{uid} ; ce read est la source de vérité temps réel.
   */
  static async getAccountStatus(expectedUid?: string, assertContext?: () => void, options?: {includeBankAccounts?: true}): Promise<StripeAccountStatus> {
    const session = captureTradeSession(expectedUid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext?.();};
    assertCurrent();
    const callable = httpsCallable<{includeBankAccounts?: true}, StripeAccountStatus>(
      functions,
      'getStripeAccountStatus',
    );
    const input = options?.includeBankAccounts ? {includeBankAccounts: true as const} : {};
    for (let attempt = 0; ; attempt++) {
      assertCurrent();
      try {
        const {data} = await callable(input);
        assertCurrent();
        return data;
      } catch (error: unknown) {
        assertCurrent();
        if (!isStaleConnectObservation(error)) throw error;
        if (attempt >= 2) throw Object.assign(new Error('Impossible d’actualiser votre compte pour le moment. Réessayez.'), {
          code: 'functions/aborted', details: {reason: 'connect_observation_stale', action: 'getStripeAccountStatus'},
        });
        // Read-only recovery under the original owner/session. A new identity,
        // navigation or cancellation must not start the next provider request.
        await new Promise<void>(resolve => setTimeout(resolve, attempt === 0 ? 100 : 250));
      }
    }
  }

  /**
   * Envoie un document d'identité (recto + verso optionnel) pour satisfaire une
   * exigence KYC. Chaque image est resize+compress, puis lue en base64 SANS
   * préfixe data-URI (la callable cap à ~8 Mo décodé).
   * @param frontUri URI locale de l'image recto (obligatoire)
   * @param backUri  URI locale de l'image verso (optionnelle)
   */
  static async uploadIdentityDocument(
    frontUri: string,
    backUri?: string,
    expectedUid?: string,
    assertContext?: () => void,
  ): Promise<UploadIdentityDocumentResponse> {
    const session = captureTradeSession(expectedUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext?.(); };
    assertCurrent();
    const toBase64 = async (uri: string): Promise<string> => {
      const compressedUri = await prepareImageForUpload(uri);
      assertCurrent();
      const image = await FileSystem.readAsStringAsync(compressedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      assertCurrent();
      return image;
    };

    const frontImageBase64 = await toBase64(frontUri);
    const backImageBase64 = backUri ? await toBase64(backUri) : undefined;
    assertCurrent();

    const callable = httpsCallable<
      { expectedUid: string; frontImageBase64: string; backImageBase64?: string },
      UploadIdentityDocumentResponse
    >(functions, 'uploadStripeIdentityDocument');

    const { data } = await callable(
      backImageBase64
        ? { expectedUid: session.uid, frontImageBase64, backImageBase64 }
        : { expectedUid: session.uid, frontImageBase64 },
    );
    assertCurrent();
    return data;
  }

  /**
   * Enregistre ou reprend une opération bancaire. Une reprise ne renvoie que
   * son identifiant ; les anciennes banques sont conservées par le serveur.
   */
  static async replaceBankAccount(
    input: BankAccountOperationInput,
    expectedUid?: string,
    assertContext?: () => void,
  ): Promise<AddBankAccountResponse> {
    const session = captureTradeSession(expectedUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext?.(); };
    assertCurrent();
    const callable = httpsCallable<
      BankAccountOperationInput & { expectedUid: string },
      AddBankAccountResponse
    >(functions, 'addBankAccount');
    const { data } = await callable({ ...input, expectedUid: session.uid });
    assertCurrent();
    return data;
  }
}
