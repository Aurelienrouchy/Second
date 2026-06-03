/**
 * transactionStatusMeta — copy & badge des statuts, vus côté wallet vendeur.
 *
 * Domaine wallet : le cycle de vie des fonds du porte-monnaie est dicté par le
 * statut de la transaction. La métadonnée de statut est la source unique de la
 * copy FR (acheteur vs vendeur) et de la variante de badge. Ce module n'a aucune
 * dépendance UI ; on teste donc la LOGIQUE MÉTIER de présentation directement.
 *
 * Placé en .tsx dans tests/jest/ pour rester côté Jest (lib/*.test.ts est le
 * territoire Vitest) — pas de collision entre runners.
 *
 * Comportement MÉTIER vérifié (pas de tautologie) :
 *  - perspectives divergentes : acheteur et vendeur voient le MÊME statut
 *    technique mais une formulation distincte (le vendeur attend un paiement /
 *    doit expédier, l'acheteur attend un colis). On le prouve sur `paid` où les
 *    labels diffèrent réellement.
 *  - cycle des fonds (poches du wallet) :
 *      delivered  → fonds gelés, copy avec date de libération {fundsReleaseAt}
 *                   (poche "bientôt disponible") ;
 *      completed  → fonds disponibles dans le porte-monnaie (poche disponible) ;
 *      disputed   → litige, retraits suspendus (badge warning) ;
 *      refunded   → vente remboursée (badge neutre).
 *  - variante de badge cohérente avec la tonalité (success / warning / danger).
 *  - fillFundsReleaseAt substitue la date formatée, et retombe sur "sous peu"
 *    quand aucune date n'est fournie, sans toucher aux textes sans placeholder.
 */

import {
  fillFundsReleaseAt,
  getStatusDescription,
  getStatusLabel,
  getStatusVariant,
} from '@/lib/transactionStatusMeta';

describe('transactionStatusMeta — perspectives acheteur vs vendeur', () => {
  it('formule différemment le statut "paid" selon la perspective (même statut technique)', () => {
    // Le paiement est reçu : l'acheteur voit "en préparation", le vendeur voit
    // l'action attendue "À expédier".
    expect(getStatusLabel('paid', 'buyer')).toBe('Payée — en préparation');
    expect(getStatusLabel('paid', 'seller')).toBe('À expédier');
    expect(getStatusLabel('paid', 'buyer')).not.toBe(
      getStatusLabel('paid', 'seller'),
    );
  });

  it('describe acheteur ≠ describe vendeur pour une livraison (protection des fonds)', () => {
    const buyer = getStatusDescription('delivered', 'buyer');
    const seller = getStatusDescription('delivered', 'seller');
    expect(buyer).not.toBe(seller);
    // Côté vendeur : la copy annonce la disponibilité future des fonds.
    expect(seller).toContain('disponibles');
  });
});

describe('transactionStatusMeta — cycle de vie des fonds (poches wallet)', () => {
  it('delivered : fonds gelés avec placeholder de date de libération (poche bientôt disponible)', () => {
    const seller = getStatusDescription('delivered', 'seller');
    // La copy porte la marque temporelle de la fenêtre de protection 7 j.
    expect(seller).toContain('{fundsReleaseAt}');
    // Livré = badge succès (l'acheminement a abouti).
    expect(getStatusVariant('delivered')).toBe('success');
  });

  it('completed : montant disponible dans le porte-monnaie (poche disponible)', () => {
    const seller = getStatusDescription('completed', 'seller');
    expect(seller).toContain('porte-monnaie');
    expect(getStatusVariant('completed')).toBe('success');
  });

  it('disputed : litige → badge warning (retraits suspendus côté wallet)', () => {
    expect(getStatusVariant('disputed')).toBe('warning');
    expect(getStatusLabel('disputed', 'seller')).toBe('Litige en cours');
  });

  it('refunded : vente remboursée → badge neutre', () => {
    expect(getStatusVariant('refunded')).toBe('default');
    expect(getStatusLabel('refunded', 'seller')).toBe('Remboursée');
  });

  it('delivery_failed et lost gèlent les fonds → badge danger', () => {
    expect(getStatusVariant('delivery_failed')).toBe('danger');
    expect(getStatusVariant('lost')).toBe('danger');
  });
});

describe('transactionStatusMeta — fillFundsReleaseAt', () => {
  it('substitue la date formatée dans la copy "delivered" vendeur', () => {
    const raw = getStatusDescription('delivered', 'seller');
    const filled = fillFundsReleaseAt(raw, '10 juin 2026');
    expect(filled).toContain('10 juin 2026');
    expect(filled).not.toContain('{fundsReleaseAt}');
  });

  it('retombe sur "sous peu" quand aucune date n’est fournie', () => {
    const raw = getStatusDescription('delivered', 'buyer');
    const filled = fillFundsReleaseAt(raw);
    expect(filled).toContain('sous peu');
    expect(filled).not.toContain('{fundsReleaseAt}');
  });

  it('laisse intacte une copy sans placeholder (no-op)', () => {
    const completed = getStatusDescription('completed', 'seller');
    // Pas de {fundsReleaseAt} dans "completed" → renvoyé tel quel.
    expect(fillFundsReleaseAt(completed, '10 juin 2026')).toBe(completed);
  });
});
