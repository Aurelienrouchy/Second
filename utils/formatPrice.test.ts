import { describe, it, expect } from 'vitest';
import { formatCents, formatPrice, formatPriceWithCurrency } from './formatPrice';

describe('formatPrice', () => {
  it('formats whole numbers without decimals', () => {
    expect(formatPrice(45)).toBe('45 $');
  });

  it('formats decimal numbers with comma separator', () => {
    expect(formatPrice(45.5)).toBe('45,50 $');
  });

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0 $');
  });

  it('formats large numbers', () => {
    expect(formatPrice(1500)).toBe('1500 $');
  });

  it('formats small decimals correctly', () => {
    expect(formatPrice(0.99)).toBe('0,99 $');
  });

  it('rounds to two decimal places', () => {
    expect(formatPrice(10.999)).toBe('11,00 $');
  });

  it('preserves single decimal digit with trailing zero', () => {
    expect(formatPrice(25.1)).toBe('25,10 $');
  });

  // Le prix est souvent posé au milieu d'une phrase : une espace ordinaire
  // autoriserait un retour à la ligne entre le montant et le symbole.
  it('ne laisse aucune espace sécable devant le symbole', () => {
    expect(formatPrice(45)).not.toMatch(/ \$/);
    expect(formatPrice(45.5)).not.toMatch(/ \$/);
  });
});

describe('formatPriceWithCurrency', () => {
  it('always shows two decimal places', () => {
    expect(formatPriceWithCurrency(45)).toBe('45,00 $ CA');
  });

  it('formats decimal amounts', () => {
    expect(formatPriceWithCurrency(45.5)).toBe('45,50 $ CA');
  });

  it('formats zero', () => {
    expect(formatPriceWithCurrency(0)).toBe('0,00 $ CA');
  });

  it('formats large numbers', () => {
    expect(formatPriceWithCurrency(1500)).toBe('1500,00 $ CA');
  });

  // « $ CA » est un bloc : ni le symbole ni le code pays ne doivent partir seuls
  // à la ligne suivante.
  it('ne laisse aucune espace sécable dans le suffixe monétaire', () => {
    expect(formatPriceWithCurrency(45)).not.toMatch(/ /);
  });
});

describe('formatCents', () => {
  it('convertit les cents en dollars avec deux décimales', () => {
    expect(formatCents(4500)).toBe('45,00 $');
  });

  it('formate zéro', () => {
    expect(formatCents(0)).toBe('0,00 $');
  });

  it('ne laisse aucune espace sécable devant le symbole', () => {
    expect(formatCents(12000)).not.toMatch(/ \$/);
  });
});
