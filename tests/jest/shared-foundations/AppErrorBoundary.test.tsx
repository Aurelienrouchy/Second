/**
 * Tests composant — components/AppErrorBoundary.tsx.
 *
 * Comportement MÉTIER : c'est le filet de sécurité racine. Il doit
 * - laisser passer les enfants quand tout va bien
 * - capturer une erreur de rendu non gérée et tenter UNE récupération
 *   silencieuse (MAX_AUTO_RETRIES = 1) avant de figer l'écran de repli
 * - afficher un écran de repli recouvrable (titre + CTA "Réessayer") quand la
 *   panne persiste
 * - permettre une reprise MANUELLE qui réarme le budget d'auto-retry
 *
 * On pilote l'échec via un composant enfant qui lance tant qu'un flag global
 * est vrai. console.error est silencié (le boundary logge en dev + React logge
 * la stack), pour garder la sortie de test lisible.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';

// Flag global pilotant l'enfant : tant qu'il est true, l'enfant throw.
let shouldThrow = false;

function Bomb(): React.ReactElement {
  if (shouldThrow) {
    throw new Error('boom-render');
  }
  return <Text>contenu-sain</Text>;
}

describe('AppErrorBoundary', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    shouldThrow = false;
    // React et le boundary logguent l'erreur capturée : on neutralise le bruit.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('rend les enfants quand aucune erreur ne survient', () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    expect(screen.getByText('contenu-sain')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-error-boundary-fallback')).toBeNull();
  });

  it('affiche l’écran de repli quand l’erreur de rendu persiste au-delà du retry auto', () => {
    // L'enfant échoue au rendu initial ET au re-render de l'auto-retry → le
    // boundary épuise son unique tentative silencieuse et fige le fallback.
    shouldThrow = true;

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId('app-error-boundary-fallback')).toBeOnTheScreen();
    expect(screen.getByText('Une erreur est survenue')).toBeOnTheScreen();
    expect(screen.getByTestId('app-error-boundary-retry')).toBeOnTheScreen();
  });

  it('récupère après un appui sur "Réessayer" une fois l’enfant redevenu sain', () => {
    shouldThrow = true;

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    // Fallback affiché.
    expect(screen.getByTestId('app-error-boundary-fallback')).toBeOnTheScreen();

    // L'enfant ne throwera plus, puis on déclenche la reprise manuelle.
    shouldThrow = false;
    fireEvent.press(screen.getByTestId('app-error-boundary-retry'));

    // Le contenu sain est re-rendu, le fallback a disparu.
    expect(screen.getByText('contenu-sain')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-error-boundary-fallback')).toBeNull();
  });

  it('signale l’erreur via console.error (point d’accroche crash reporter)', () => {
    shouldThrow = true;

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    // componentDidCatch logge en dev — sert de hook pour Sentry/Crashlytics.
    const loggedBoundary = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes('[AppErrorBoundary]'),
    );
    expect(loggedBoundary).toBe(true);
  });
});
