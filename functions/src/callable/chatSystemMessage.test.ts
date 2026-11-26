/**
 * Le contenu d'un message « système » est rendu par le SERVEUR à partir d'un
 * catalogue fermé : le client ne transmet plus de texte. Ces tests verrouillent
 * les déclarations de participants, qui ne certifient pas un état métier, et le refus
 * de rendre un message dont les paramètres ne permettraient pas un rendu fidèle.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/firebase', () => ({ db: {}, FieldValue: {} }));
import { renderSystemMessage, SYSTEM_MESSAGE_KINDS } from './chatSystemMessage';

describe('renderSystemMessage — déclarations sans autorité métier', () => {
  it('rend une offre acceptée et une offre refusée', () => {
    expect(renderSystemMessage('offer_accepted', { amount: 80 })).toBe(
      'Un participant déclare avoir accepté l’offre de 80 $',
    );
    expect(renderSystemMessage('offer_rejected', { amount: 42.5 })).toBe(
      'Un participant déclare avoir refusé l’offre de 42.5 $',
    );
  });

  it('rend les trois contre-offres', () => {
    expect(
      renderSystemMessage('counter_price', { fromAmount: 100, toAmount: 80 }),
    ).toBe('Contre-offre: 100 $ → 80 $');
    expect(
      renderSystemMessage('counter_location', { locationName: 'Café Olimpico' }),
    ).toBe('Nouveau lieu proposé: Café Olimpico');
    expect(
      renderSystemMessage('counter_time', { dateTime: '2026-09-10T18:30:00.000Z' }),
    ).toMatch(/^Nouvel horaire proposé: /);
  });

  it('rend la confirmation de rencontre, avec et sans date', () => {
    expect(
      renderSystemMessage('meetup_confirmed', { locationName: 'Métro Berri' }),
    ).toBe('Rendez-vous confirmé par un participant :\nMétro Berri\nà une date à convenir');
    expect(
      renderSystemMessage('meetup_confirmed', {
        locationName: 'Métro Berri',
        dateTime: '2026-09-10T18:30:00.000Z',
      }),
    ).toMatch(/^Rendez-vous confirmé par un participant :\nMétro Berri\nle /);
  });

  it('rend les trois déclarations sans paramètre', () => {
    expect(renderSystemMessage('no_show_reported', {})).toBe(
      'Un participant signale une absence au rendez-vous.',
    );
    expect(renderSystemMessage('meetup_completed', {})).toBe(
      'Un participant déclare la remise et le paiement terminés.',
    );
    expect(renderSystemMessage('meetup_cancelled', {})).toBe(
      'Un participant déclare la rencontre annulée. Consultez la commande pour connaître l’état de l’article.',
    );
  });
});

describe('renderSystemMessage — refus plutôt que rendu dégradé', () => {
  it('refuse un montant manquant, négatif ou non numérique', () => {
    expect(renderSystemMessage('offer_accepted', {})).toBeNull();
    expect(renderSystemMessage('offer_accepted', { amount: -5 })).toBeNull();
    expect(renderSystemMessage('offer_accepted', { amount: '80' })).toBeNull();
    expect(renderSystemMessage('offer_accepted', { amount: NaN })).toBeNull();
  });

  it('refuse un lieu vide et une date illisible', () => {
    expect(renderSystemMessage('counter_location', { locationName: '   ' })).toBeNull();
    expect(renderSystemMessage('counter_time', { dateTime: 'pas une date' })).toBeNull();
    expect(renderSystemMessage('meetup_confirmed', { locationName: '' })).toBeNull();
  });

  it("borne un nom de lieu très long plutôt que de le recopier tel quel", () => {
    const rendered = renderSystemMessage('counter_location', {
      locationName: 'x'.repeat(500),
    });
    expect(rendered).not.toBeNull();
    expect(rendered!.length).toBeLessThan(200);
  });

  // Le catalogue est la surface d'attaque : toute nouvelle entrée doit être un
  // ajout délibéré, jamais un effet de bord.
  it('expose exactement neuf types', () => {
    expect([...SYSTEM_MESSAGE_KINDS].sort()).toEqual(
      [
        'meetup_cancelled',
        'counter_location',
        'counter_price',
        'counter_time',
        'meetup_completed',
        'meetup_confirmed',
        'no_show_reported',
        'offer_accepted',
        'offer_rejected',
      ].sort(),
    );
  });
});
