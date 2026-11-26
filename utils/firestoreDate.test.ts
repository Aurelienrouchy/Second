import { describe, it, expect } from 'vitest';
import { toDate, formatMeetupDateTime } from './firestoreDate';

const ISO = '2026-06-12T18:30:00.000Z';

describe('toDate', () => {
  it('reconnaît un Timestamp Firestore', () => {
    const d = new Date(ISO);
    expect(toDate({ toDate: () => d, seconds: 0, nanoseconds: 0 })).toEqual(d);
  });

  it('laisse passer une Date valide', () => {
    const d = new Date(ISO);
    expect(toDate(d)).toBe(d);
  });

  it('accepte une chaîne ISO et un nombre', () => {
    expect(toDate(ISO)?.toISOString()).toBe(ISO);
    expect(toDate(new Date(ISO).getTime())?.toISOString()).toBe(ISO);
  });

  it('rend null plutôt qu’une date invalide', () => {
    // C'est tout l'enjeu : `new Date(timestamp)` rendait une date invalide,
    // dont `.toISOString()` LÈVE — après que le serveur avait déjà agi.
    expect(toDate(undefined)).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate('pas une date')).toBeNull();
    expect(toDate(new Date('nawak'))).toBeNull();
    expect(toDate({ toDate: () => new Date('nawak') })).toBeNull();
    expect(toDate({})).toBeNull();
    expect(toDate(NaN)).toBeNull();
  });
});

describe('formatMeetupDateTime', () => {
  it('rend une date lisible depuis un Timestamp', () => {
    const d = new Date(ISO);
    const out = formatMeetupDateTime({ toDate: () => d }, 'fr-CA');
    expect(out.startsWith('le ')).toBe(true);
    expect(out).not.toContain('Invalid');
  });

  it('replie sur le libellé métier quand aucun horaire n’est convenu', () => {
    expect(formatMeetupDateTime(undefined, 'fr-CA')).toBe('à une date à convenir');
    expect(formatMeetupDateTime('nawak', 'fr-CA')).toBe('à une date à convenir');
  });
});
