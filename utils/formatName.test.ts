import { describe, it, expect } from 'vitest';
import { formatDisplayName } from './formatName';

describe('formatDisplayName', () => {
  it('returns "Utilisateur" for null', () => {
    expect(formatDisplayName(null)).toBe('Utilisateur');
  });

  it('returns "Utilisateur" for undefined', () => {
    expect(formatDisplayName(undefined)).toBe('Utilisateur');
  });

  it('returns "Utilisateur" for empty string', () => {
    expect(formatDisplayName('')).toBe('Utilisateur');
  });

  it('returns single name as-is', () => {
    expect(formatDisplayName('Marie')).toBe('Marie');
  });

  it('abbreviates last name to initial', () => {
    expect(formatDisplayName('Jean Dupont')).toBe('Jean D.');
  });

  it('handles multi-part names by keeping first word and abbreviating last', () => {
    expect(formatDisplayName('Jean-Pierre De La Fontaine')).toBe('Jean-Pierre F.');
  });

  it('trims whitespace', () => {
    expect(formatDisplayName('  Marie  ')).toBe('Marie');
  });

  it('uppercases the last name initial', () => {
    expect(formatDisplayName('jean dupont')).toBe('jean D.');
  });
});
