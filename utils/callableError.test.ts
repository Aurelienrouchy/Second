import { describe, it, expect } from 'vitest';

import {
  getCallableErrorCode,
  isRateLimitError,
  mapCallableError,
} from './callableError';

/** Build a FirebaseError-shaped object as httpsCallable would throw it. */
function callableError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { code });
}

describe('getCallableErrorCode', () => {
  it('strips the functions/ prefix from a callable error code', () => {
    expect(getCallableErrorCode(callableError('functions/resource-exhausted'))).toBe(
      'resource-exhausted',
    );
  });

  it('returns a bare code unchanged', () => {
    expect(getCallableErrorCode(callableError('failed-precondition'))).toBe(
      'failed-precondition',
    );
  });

  it('returns null for a non-callable error', () => {
    expect(getCallableErrorCode(new Error('plain'))).toBeNull();
    expect(getCallableErrorCode(null)).toBeNull();
    expect(getCallableErrorCode({ code: 42 })).toBeNull();
  });
});

describe('isRateLimitError', () => {
  it('detects a resource-exhausted callable error', () => {
    expect(isRateLimitError(callableError('functions/resource-exhausted'))).toBe(true);
  });

  it('is false for other codes', () => {
    expect(isRateLimitError(callableError('functions/failed-precondition'))).toBe(false);
    expect(isRateLimitError(new Error('x'))).toBe(false);
  });
});

describe('mapCallableError', () => {
  it('maps a rate limit to a "trop de tentatives" message — never the article title', () => {
    const { title, message } = mapCallableError(
      callableError('functions/resource-exhausted'),
    );
    expect(title).toBe('Trop de tentatives');
    expect(message).toMatch(/trop d’actions/i);
    // Must NOT leak a misleading "Article indisponible" framing (F129).
    expect(title).not.toMatch(/indisponible/i);
  });

  it('keeps the server message for a failed-precondition (article vendu, tarif expiré…)', () => {
    const { message } = mapCallableError(
      callableError('functions/failed-precondition', 'Cet article a déjà été vendu'),
    );
    expect(message).toBe('Cet article a déjà été vendu');
  });

  it('maps permission-denied to a clear unauthorized message', () => {
    const { title } = mapCallableError(callableError('functions/permission-denied'));
    expect(title).toBe('Action non autorisée');
  });

  it('maps unavailable / deadline-exceeded to a connectivity message', () => {
    expect(mapCallableError(callableError('functions/unavailable')).title).toBe(
      'Connexion instable',
    );
    expect(mapCallableError(callableError('functions/deadline-exceeded')).title).toBe(
      'Connexion instable',
    );
  });

  it('falls back to the provided fallback for an unknown code', () => {
    const fallback = { title: 'Paiement impossible', message: 'Réessayez.' };
    expect(mapCallableError(new Error('weird'), fallback)).toEqual(fallback);
  });
});
