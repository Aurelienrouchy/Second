import { describe, it, expect } from 'vitest';
import { classifyStripePaymentError } from './stripePaymentError';

describe('classifyStripePaymentError', () => {
  it('classifies a network / connection error as retryable', () => {
    const r = classifyStripePaymentError({ errorType: 'api_connection_error' });
    expect(r.title).toBe('Connexion interrompue');
    expect(r.retryable).toBe(true);
  });

  it('classifies a Timeout code as a connection error', () => {
    const r = classifyStripePaymentError({ errorCode: 'Timeout' });
    expect(r.title).toBe('Connexion interrompue');
    expect(r.retryable).toBe(true);
  });

  it('classifies a generic card decline (card_error) as carte refusée', () => {
    const r = classifyStripePaymentError({ errorType: 'card_error' });
    expect(r.title).toBe('Carte refusée');
    expect(r.retryable).toBe(true);
  });

  it('gives a specific message for insufficient_funds', () => {
    const r = classifyStripePaymentError({
      errorType: 'card_error',
      declineCode: 'insufficient_funds',
    });
    expect(r.title).toBe('Fonds insuffisants');
    expect(r.message).toMatch(/fonds insuffisants/i);
  });

  it('gives a specific message for an expired card', () => {
    const r = classifyStripePaymentError({
      errorType: 'card_error',
      declineCode: 'expired_card',
    });
    expect(r.title).toBe('Carte expirée');
  });

  it('classifies a hard decline (lost_card) as carte refusée', () => {
    const r = classifyStripePaymentError({
      errorType: 'card_error',
      declineCode: 'lost_card',
    });
    expect(r.title).toBe('Carte refusée');
    expect(r.message).toMatch(/contactez votre banque/i);
  });

  it('classifies an abandoned 3DS / authentication step', () => {
    const r = classifyStripePaymentError({ errorType: 'authentication_error' });
    expect(r.title).toBe('Authentification incomplète');
    expect(r.retryable).toBe(true);
  });

  it('detects 3DS from the message text when no type is provided', () => {
    const r = classifyStripePaymentError({ error: '3D Secure authentication failed' });
    expect(r.title).toBe('Authentification incomplète');
  });

  it('falls back to a generic retryable error and surfaces the raw message', () => {
    const r = classifyStripePaymentError({ error: 'Une erreur inattendue' });
    expect(r.retryable).toBe(true);
    expect(r.message).toBe('Une erreur inattendue');
  });

  it('falls back to a default message when nothing is provided', () => {
    const r = classifyStripePaymentError({});
    expect(r.title).toBe('Le paiement a échoué');
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.retryable).toBe(true);
  });
});
