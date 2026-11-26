import { canOfferCustomBrand, isBrandAlreadyExistsError } from '@/components/BrandSelectionSheet';

// brandDisplay réécrit le libellé au moment de l'ajout (levis -> Levi's), donc
// l'identifiant du document et le libellé affiché divergent.
const catalogue = [
  { value: 'levis', label: "Levi's" },
  { value: 'zara', label: 'Zara' },
];

describe("BS01 — le bouton « Ajouter » ne s'affiche pas pour une marque déjà au catalogue", () => {
  it("reconnaît la marque par son identifiant quand le libellé a été réécrit", () => {
    expect(canOfferCustomBrand('levis', catalogue)).toBe(false);
  });

  it('reconnaît la marque par son libellé', () => {
    expect(canOfferCustomBrand("levi's", catalogue)).toBe(false);
  });

  it('propose toujours une marque réellement absente', () => {
    expect(canOfferCustomBrand('maison tartine', catalogue)).toBe(true);
  });

  it('ignore une saisie trop courte', () => {
    expect(canOfferCustomBrand('l', catalogue)).toBe(false);
  });
});

describe('BS01 — un refus des règles Firestore signale un doublon, pas une panne', () => {
  it('reconnaît permission-denied', () => {
    expect(isBrandAlreadyExistsError({ code: 'permission-denied' })).toBe(true);
  });

  it('ne confond pas une panne réseau avec un doublon', () => {
    expect(isBrandAlreadyExistsError({ code: 'unavailable' })).toBe(false);
    expect(isBrandAlreadyExistsError(new Error('boom'))).toBe(false);
  });
});
