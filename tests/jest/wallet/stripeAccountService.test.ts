/**
 * StripeAccountService — cycle de vie du compte vendeur Stripe Connect Custom.
 *
 * Ce service est l'unique point d'entrée client vers les callables de remédiation
 * KYC / gestion bancaire (white-label). Toute la logique d'argent et de
 * conformité vit côté Cloud Function ; le service client se contente d'appeler
 * la bonne callable avec le bon contrat et de normaliser la réponse pour l'UI.
 *
 * Comportement MÉTIER couvert (pas de tautologie) :
 *   - getAccountStatus cible `getStripeAccountStatus` et renvoie l'état complet
 *     tel quel (charges/payouts/requirements/disabledReason/bankLast4).
 *   - uploadIdentityDocument compresse PUIS lit chaque image en base64 SANS
 *     préfixe data-URI, et envoie { frontImageBase64, backImageBase64? } à
 *     `uploadStripeIdentityDocument` (verso omis du payload quand absent).
 *   - replaceBankAccount cible `addBankAccount` avec transit/institution/compte.
 *   - une erreur de garde serveur (failed-precondition) remonte telle quelle.
 *
 * expo-image-manipulator est mocké globalement (jest.setup) → prepareImageForUpload
 * retourne `processed-<uri>` ; on mocke expo-file-system/legacy pour piloter le
 * base64. httpsCallable est mocké globalement.
 */

import { httpsCallable } from 'firebase/functions';

import { StripeAccountService } from '@/services/stripeAccountService';
import type { StripeAccountStatus } from '@/utils/stripeRequirements';

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  // Encode l'URI dans la valeur base64 pour pouvoir assert quel fichier a été lu.
  readAsStringAsync: jest.fn((uri: string) => Promise.resolve(`b64(${uri})`)),
}));

const mockHttpsCallable = httpsCallable as jest.Mock;

function stubCallable(returnData: unknown) {
  const callable = jest.fn().mockResolvedValue({ data: returnData });
  mockHttpsCallable.mockReturnValue(callable);
  return callable;
}

function lastCallableName(): string {
  const calls = mockHttpsCallable.mock.calls;
  return calls[calls.length - 1][1] as string;
}

const RESTRICTED_STATUS: StripeAccountStatus = {
  success: true,
  hasAccount: true,
  chargesEnabled: true,
  payoutsEnabled: false,
  detailsSubmitted: true,
  status: 'restricted',
  requirementsCurrentlyDue: ['individual.verification.document'],
  requirementsPastDue: [],
  disabledReason: 'requirements.past_due',
  currentDeadline: null,
  bankAccountLast4: '6789',
};

describe('StripeAccountService.getAccountStatus', () => {
  it('cible getStripeAccountStatus et renvoie l\'état complet tel quel', async () => {
    const callable = stubCallable(RESTRICTED_STATUS);

    const status = await StripeAccountService.getAccountStatus();

    expect(lastCallableName()).toBe('getStripeAccountStatus');
    expect(callable).toHaveBeenCalledWith({});
    // Le service ne réduit pas l'état : payouts OFF + requirements + last4 préservés.
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(false);
    expect(status.status).toBe('restricted');
    expect(status.requirementsCurrentlyDue).toEqual([
      'individual.verification.document',
    ]);
    expect(status.disabledReason).toBe('requirements.past_due');
    expect(status.bankAccountLast4).toBe('6789');
  });
});

describe('StripeAccountService.uploadIdentityDocument', () => {
  it('compresse puis envoie le recto en base64 (sans verso) à uploadStripeIdentityDocument', async () => {
    const callable = stubCallable({
      success: true,
      status: 'pending_verification',
      chargesEnabled: true,
      payoutsEnabled: false,
      requirementsCurrentlyDue: [],
      requirementsPastDue: [],
      disabledReason: null,
    });

    await StripeAccountService.uploadIdentityDocument('file://front.jpg');

    expect(lastCallableName()).toBe('uploadStripeIdentityDocument');
    // prepareImageForUpload (mock manipulator) → processed-file://front.jpg,
    // readAsStringAsync → b64(processed-...). Verso absent ⇒ clé omise.
    expect(callable).toHaveBeenCalledWith({
      frontImageBase64: 'b64(processed-file://front.jpg)',
    });
    const payload = callable.mock.calls[0][0];
    expect(payload).not.toHaveProperty('backImageBase64');
  });

  it('inclut le verso en base64 quand fourni', async () => {
    const callable = stubCallable({
      success: true,
      status: 'pending_verification',
      chargesEnabled: true,
      payoutsEnabled: false,
      requirementsCurrentlyDue: [],
      requirementsPastDue: [],
      disabledReason: null,
    });

    await StripeAccountService.uploadIdentityDocument(
      'file://front.jpg',
      'file://back.jpg',
    );

    expect(callable).toHaveBeenCalledWith({
      frontImageBase64: 'b64(processed-file://front.jpg)',
      backImageBase64: 'b64(processed-file://back.jpg)',
    });
  });
});

describe('StripeAccountService.replaceBankAccount', () => {
  it('cible addBankAccount avec transit/institution/compte et renvoie le last4', async () => {
    const callable = stubCallable({
      success: true,
      bankAccountLast4: '1234',
      bankAccountStatus: 'new',
    });

    const res = await StripeAccountService.replaceBankAccount({
      transitNumber: '12345',
      institutionNumber: '001',
      accountNumber: '9876543',
    });

    expect(lastCallableName()).toBe('addBankAccount');
    expect(callable).toHaveBeenCalledWith({
      transitNumber: '12345',
      institutionNumber: '001',
      accountNumber: '9876543',
    });
    expect(res).toEqual({
      success: true,
      bankAccountLast4: '1234',
      bankAccountStatus: 'new',
    });
  });

  it('laisse remonter une erreur de garde serveur (failed-precondition)', async () => {
    const err = Object.assign(
      new Error('Aucun compte de paiement trouve.'),
      { code: 'functions/failed-precondition' },
    );
    const callable = jest.fn().mockRejectedValue(err);
    mockHttpsCallable.mockReturnValue(callable);

    await expect(
      StripeAccountService.replaceBankAccount({
        transitNumber: '12345',
        institutionNumber: '001',
        accountNumber: '9876543',
      }),
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });
});
