/**
 * Après un blocage, la bulle d'offre gardait tous ses boutons : on pouvait
 * accepter une offre — donc créer une transaction et verrouiller l'article — ou
 * confirmer un rendez-vous physique avec une personne à qui l'on ne peut plus
 * écrire. Les sorties, elles, doivent rester ouvertes, sinon une rencontre déjà
 * acceptée reste prisonnière jusqu'au balayage automatique.
 */
import {
  withOfferBlockGuard,
  OFFER_ACTIONS_CLOSED_WHEN_BLOCKED,
} from '@/features/offers/utils/blockGuard';

const handlers = {
  onAcceptOffer: jest.fn(),
  onRejectOffer: jest.fn(),
  onCounterPrice: jest.fn(),
  onCounterLocation: jest.fn(),
  onCounterTime: jest.fn(),
  onConfirmMeetup: jest.fn(),
  onCompleteMeetup: jest.fn(),
  onReportNoShow: jest.fn(),
  onCancelMeetup: jest.fn(),
};

describe('withOfferBlockGuard', () => {
  it('ne touche à rien quand personne n’est bloqué', () => {
    expect(withOfferBlockGuard(handlers, false)).toBe(handlers);
  });

  it('ferme accepter, les trois contre-offres et la confirmation', () => {
    const guarded = withOfferBlockGuard(handlers, true);
    expect(guarded.onAcceptOffer).toBeUndefined();
    expect(guarded.onCounterPrice).toBeUndefined();
    expect(guarded.onCounterLocation).toBeUndefined();
    expect(guarded.onCounterTime).toBeUndefined();
    expect(guarded.onConfirmMeetup).toBeUndefined();
  });

  it('laisse ouvertes les sorties et le recours', () => {
    const guarded = withOfferBlockGuard(handlers, true);
    // Sans ces quatre-là, une rencontre acceptée resterait bloquée jusqu'au
    // balayage automatique, et la personne visée par un signalement d'absence
    // n'aurait plus aucun moyen de donner sa version.
    expect(guarded.onRejectOffer).toBe(handlers.onRejectOffer);
    expect(guarded.onCancelMeetup).toBe(handlers.onCancelMeetup);
    expect(guarded.onReportNoShow).toBe(handlers.onReportNoShow);
    expect(guarded.onCompleteMeetup).toBe(handlers.onCompleteMeetup);
  });

  it('n’invente aucune clé absente de l’objet d’origine', () => {
    const guarded = withOfferBlockGuard({ onRejectOffer: handlers.onRejectOffer }, true);
    expect(Object.keys(guarded)).toEqual(['onRejectOffer']);
  });

  it('la liste des actions fermées est celle qui engage la relation', () => {
    expect([...OFFER_ACTIONS_CLOSED_WHEN_BLOCKED]).toEqual([
      'onAcceptOffer',
      'onCounterPrice',
      'onCounterLocation',
      'onCounterTime',
      'onConfirmMeetup',
    ]);
  });
});
