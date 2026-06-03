/**
 * Tests métier — helpers OfferBubble (components/offer-bubble/utils.ts).
 *
 * Coeur métier couvert :
 *  - getTimeUntilExpiry : décompte de l'expiration 48h des offres. Ne renvoie
 *    un décompte QUE pour une offre 'pending', tolère les inputs Date /
 *    Firestore Timestamp ({toDate}) / ISO string, et bascule sur "Expirée"
 *    une fois le délai dépassé.
 *  - getStatus* : mapping statut → couleur / icône / libellé FR / fond. Ces
 *    helpers pilotent l'affichage de chaque bulle d'offre dans le chat.
 *
 * Vitest possède les `.test.ts` (logique pure) — ce fichier est en `.tsx`
 * pour rester dans le périmètre Jest et accéder aux mocks RN (theme, locale).
 */

import { colors } from '@/constants/theme';
import type { OfferStatus } from '@/types';

import {
  getStatusBgColor,
  getStatusColor,
  getStatusIcon,
  getStatusIconBackground,
  getStatusText,
  getTimeUntilExpiry,
} from './utils';

describe('getTimeUntilExpiry — décompte expiration 48h', () => {
  const fixedNow = new Date('2026-06-01T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ne renvoie aucun décompte si l’offre n’est pas pending', () => {
    const inOneHour = new Date(fixedNow.getTime() + 60 * 60 * 1000);
    expect(getTimeUntilExpiry(inOneHour, 'accepted')).toBeNull();
    expect(getTimeUntilExpiry(inOneHour, 'rejected')).toBeNull();
    expect(getTimeUntilExpiry(inOneHour, 'expired')).toBeNull();
  });

  it('ne renvoie aucun décompte sans date d’expiration', () => {
    expect(getTimeUntilExpiry(null, 'pending')).toBeNull();
    expect(getTimeUntilExpiry(undefined, 'pending')).toBeNull();
  });

  it('renvoie heures + minutes quand il reste plus d’une heure', () => {
    // 47h30 restantes (offre fraîche, fenêtre 48h)
    const expiresAt = new Date(fixedNow.getTime() + (47 * 60 + 30) * 60 * 1000);
    expect(getTimeUntilExpiry(expiresAt, 'pending')).toBe('Expire dans 47h 30min');
  });

  it('renvoie seulement les minutes quand il reste moins d’une heure', () => {
    const expiresAt = new Date(fixedNow.getTime() + 45 * 60 * 1000);
    expect(getTimeUntilExpiry(expiresAt, 'pending')).toBe('Expire dans 45min');
  });

  it('renvoie "Expirée" une fois le délai dépassé (diff <= 0)', () => {
    const justPast = new Date(fixedNow.getTime() - 1000);
    expect(getTimeUntilExpiry(justPast, 'pending')).toBe('Expirée');
  });

  it('traite l’instant exact d’expiration comme expiré', () => {
    expect(getTimeUntilExpiry(new Date(fixedNow), 'pending')).toBe('Expirée');
  });

  it('accepte un Firestore Timestamp ({ toDate })', () => {
    const expiresAt = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000);
    const timestampLike = { toDate: () => expiresAt };
    // @ts-expect-error — on simule un Timestamp Firestore (toDate) volontairement
    expect(getTimeUntilExpiry(timestampLike, 'pending')).toBe('Expire dans 2h 0min');
  });

  it('accepte une date ISO string', () => {
    const expiresAt = new Date(fixedNow.getTime() + 3 * 60 * 60 * 1000).toISOString();
    expect(getTimeUntilExpiry(expiresAt, 'pending')).toBe('Expire dans 3h 0min');
  });
});

describe('getStatusColor — couleur par statut', () => {
  it('mappe les statuts terminaux positifs sur success', () => {
    expect(getStatusColor('accepted')).toBe(colors.success);
    expect(getStatusColor('completed')).toBe(colors.success);
  });

  it('mappe refus / expiration sur danger', () => {
    expect(getStatusColor('rejected')).toBe(colors.danger);
    expect(getStatusColor('expired')).toBe(colors.danger);
  });

  it('mappe les contre-offres sur sand', () => {
    expect(getStatusColor('counter_price')).toBe(colors.sand);
    expect(getStatusColor('counter_location')).toBe(colors.sand);
    expect(getStatusColor('counter_time')).toBe(colors.sand);
  });

  it('mappe pending (défaut) sur primary', () => {
    expect(getStatusColor('pending')).toBe(colors.primary);
  });
});

describe('getStatusText — libellé FR par statut', () => {
  const cases: Array<[OfferStatus, string]> = [
    ['pending', 'En attente'],
    ['accepted', 'Acceptée'],
    ['completed', 'Terminée'],
    ['rejected', 'Refusée'],
    ['expired', 'Expirée'],
    ['counter_price', 'Contre-offre prix'],
    ['counter_location', 'Autre lieu proposé'],
    ['counter_time', 'Autre horaire proposé'],
  ];

  it.each(cases)('statut %s → "%s"', (status, label) => {
    expect(getStatusText(status)).toBe(label);
  });
});

describe('getStatusIcon — icône Ionicons par statut', () => {
  it('distingue les trois types de contre-offre par leur icône', () => {
    expect(getStatusIcon('counter_price')).toBe('swap-horizontal');
    expect(getStatusIcon('counter_location')).toBe('location');
    expect(getStatusIcon('counter_time')).toBe('calendar');
  });

  it('mappe les statuts de cycle de vie sur l’icône attendue', () => {
    expect(getStatusIcon('accepted')).toBe('checkmark-circle');
    expect(getStatusIcon('completed')).toBe('checkmark-done-circle');
    expect(getStatusIcon('rejected')).toBe('close-circle');
    expect(getStatusIcon('expired')).toBe('time-outline');
    expect(getStatusIcon('pending')).toBe('cash');
  });
});

describe('getStatusIconBackground / getStatusBgColor — fonds par statut', () => {
  it('pending utilise un fond primary clair', () => {
    expect(getStatusIconBackground('pending')).toBe(colors.primaryLight);
    expect(getStatusBgColor('pending')).toBe(colors.primaryLight);
  });

  it('accepted / completed utilisent un fond success clair', () => {
    expect(getStatusIconBackground('accepted')).toBe(colors.successLight);
    expect(getStatusBgColor('completed')).toBe(colors.successLight);
  });

  it('rejected / expired utilisent un fond danger clair', () => {
    expect(getStatusIconBackground('rejected')).toBe(colors.dangerLight);
    expect(getStatusBgColor('expired')).toBe(colors.dangerLight);
  });

  it('les contre-offres utilisent un fond sand clair', () => {
    expect(getStatusIconBackground('counter_price')).toBe(colors.sandLight);
    expect(getStatusBgColor('counter_time')).toBe(colors.sandLight);
  });
});
