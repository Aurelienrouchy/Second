/**
 * Test de hook — useDebounce (hooks/useDebounce.ts).
 *
 * Vérifie le comportement métier du debounce :
 * - retourne la valeur initiale immédiatement
 * - ne propage une nouvelle valeur qu'après le délai écoulé
 * - réinitialise le timer à chaque changement rapide (dernière valeur gagne)
 *
 * Utilise renderHook (RNTL) + fake timers Jest. Placé en .tsx pour rester dans
 * le périmètre Jest (les *.test.ts restent à Vitest).
 */

import { act, renderHook } from '@testing-library/react-native';

import { useDebounce } from '@/hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('retourne la valeur initiale immédiatement', () => {
    const { result } = renderHook(() => useDebounce('robe', 300));
    expect(result.current).toBe('robe');
  });

  it('ne propage la nouvelle valeur qu’après le délai', () => {
    const { result, rerender } = renderHook<string, { value: string }>(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'r' } },
    );

    rerender({ value: 'robe' });
    // Avant l'échéance : encore l'ancienne valeur.
    expect(result.current).toBe('r');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe('robe');
  });

  it('garde uniquement la dernière valeur lors de frappes rapides', () => {
    const { result, rerender } = renderHook<string, { value: string }>(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'r' } },
    );

    rerender({ value: 'ro' });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    rerender({ value: 'rob' });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    rerender({ value: 'robe' });

    // Aucune échéance complète atteinte → toujours la valeur initiale.
    expect(result.current).toBe('r');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Seule la dernière valeur est propagée.
    expect(result.current).toBe('robe');
  });
});
