/**
 * stripeRequirements — helpers purs (shared) du cycle de vie compte vendeur.
 *
 * On vérifie le COMPORTEMENT métier visible par l'utilisateur :
 *   - traduction FR lisible des clés Stripe (jamais la clé brute exposée) ;
 *   - détection d'une exigence de document d'identité (déclenche le flow KYC) ;
 *   - traduction d'un disabled_reason en phrase actionnable.
 */

import {
  needsIdentityDocument,
  translateBankStatus,
  translateDisabledReason,
  translateRequirement,
} from '@/utils/stripeRequirements';

describe('translateRequirement', () => {
  it('traduit les clés courantes en FR lisible', () => {
    expect(translateRequirement('individual.verification.document')).toBe(
      "Pièce d'identité à fournir",
    );
    expect(translateRequirement('external_account')).toBe(
      'Compte bancaire à ajouter',
    );
    expect(translateRequirement('individual.address.postal_code')).toBe(
      'Code postal à compléter',
    );
  });

  it('traite les clés dynamiques person_xxx.verification.document', () => {
    expect(
      translateRequirement('person_abc123.verification.document.front'),
    ).toBe("Pièce d'identité à fournir");
  });

  it('n\'expose jamais la clé brute pour une clé inconnue', () => {
    const out = translateRequirement('some.unknown.future_key');
    expect(out).not.toContain('some.unknown');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('needsIdentityDocument', () => {
  it('vrai quand currently_due contient une exigence de document', () => {
    expect(
      needsIdentityDocument({
        requirementsCurrentlyDue: ['individual.verification.document'],
        requirementsPastDue: [],
        disabledReason: null,
      }),
    ).toBe(true);
  });

  it('vrai quand le disabledReason suggère une vérification en retard', () => {
    expect(
      needsIdentityDocument({
        requirementsCurrentlyDue: [],
        requirementsPastDue: [],
        disabledReason: 'requirements.past_due',
      }),
    ).toBe(true);
  });

  it('faux quand seul un compte bancaire est requis (pas un document)', () => {
    expect(
      needsIdentityDocument({
        requirementsCurrentlyDue: ['external_account'],
        requirementsPastDue: [],
        disabledReason: null,
      }),
    ).toBe(false);
  });
});

describe('translateDisabledReason', () => {
  it('retourne null quand aucune raison', () => {
    expect(translateDisabledReason(null)).toBeNull();
  });

  it('traduit une raison connue en phrase actionnable', () => {
    expect(translateDisabledReason('requirements.past_due')).toMatch(
      /retard/i,
    );
  });

  it('fournit un fallback actionnable pour une raison inconnue', () => {
    const out = translateDisabledReason('some_future_reason');
    expect(out).toBeTruthy();
    expect(out).not.toContain('some_future_reason');
  });
});

describe('translateBankStatus', () => {
  it('traduit les statuts bancaires connus', () => {
    expect(translateBankStatus('validated')).toBe('Vérifié');
    expect(translateBankStatus('verification_failed')).toBe(
      'Vérification échouée',
    );
  });

  it('retourne null pour un statut absent', () => {
    expect(translateBankStatus(null)).toBeNull();
  });
});
