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
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';
import { prepareImageForUpload } from '@/utils/imageUtils';
import type {
  AddBankAccountResponse,
  StripeAccountStatus,
  UploadIdentityDocumentResponse,
} from '@/utils/stripeRequirements';

export interface ReplaceBankAccountInput {
  transitNumber: string;
  institutionNumber: string;
  accountNumber: string;
  accountHolderName?: string;
}

export class StripeAccountService {
  /**
   * État complet du compte vendeur. Le backend persiste également les champs
   * dérivés sur users/{uid} ; ce read est la source de vérité temps réel.
   */
  static async getAccountStatus(): Promise<StripeAccountStatus> {
    const callable = httpsCallable<Record<string, never>, StripeAccountStatus>(
      functions,
      'getStripeAccountStatus',
    );
    const { data } = await callable({});
    return data;
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
  ): Promise<UploadIdentityDocumentResponse> {
    const toBase64 = async (uri: string): Promise<string> => {
      const compressedUri = await prepareImageForUpload(uri);
      return FileSystem.readAsStringAsync(compressedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    };

    const frontImageBase64 = await toBase64(frontUri);
    const backImageBase64 = backUri ? await toBase64(backUri) : undefined;

    const callable = httpsCallable<
      { frontImageBase64: string; backImageBase64?: string },
      UploadIdentityDocumentResponse
    >(functions, 'uploadStripeIdentityDocument');

    const { data } = await callable(
      backImageBase64
        ? { frontImageBase64, backImageBase64 }
        : { frontImageBase64 },
    );
    return data;
  }

  /**
   * Remplace le compte bancaire de retrait (default_for_currency). Le backend
   * supprime les anciens comptes et persiste bankAccountLast4 + statut.
   */
  static async replaceBankAccount(
    input: ReplaceBankAccountInput,
  ): Promise<AddBankAccountResponse> {
    const callable = httpsCallable<
      ReplaceBankAccountInput,
      AddBankAccountResponse
    >(functions, 'addBankAccount');
    const { data } = await callable(input);
    return data;
  }
}
