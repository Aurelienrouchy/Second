import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: View };
});

import { AnalysisFooter } from '../analysis/AnalysisFooter';

function renderError(over: Record<string, unknown> = {}) {
  const onRetry = jest.fn();
  const onManualEntry = jest.fn();
  render(
    <AnalysisFooter
      screenState="error"
      bottomInset={0}
      onContinue={jest.fn()}
      onRetry={onRetry}
      onManualEntry={onManualEntry}
      {...over}
    />,
  );
  return { onRetry, onManualEntry };
}

describe('<AnalysisFooter /> — état erreur', () => {
  it('propose RÉESSAYER et la saisie manuelle pour une erreur passagère', () => {
    const { onRetry } = renderError();
    fireEvent.press(screen.getByText('RÉESSAYER'));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('Remplir manuellement')).toBeTruthy();
  });

  it('ne propose pas RÉESSAYER quand réessayer échouerait (quota atteint)', () => {
    // Le bouton relançait une analyse refusée pendant une heure.
    renderError({ canRetry: false });
    expect(screen.queryByText('RÉESSAYER')).toBeNull();
    expect(screen.getByText('Remplir manuellement')).toBeTruthy();
  });
});

it('opens restored details only on an explicit tap with the standard primary button', () => {
  const onContinue = jest.fn();
  render(<AnalysisFooter screenState="complete" bottomInset={0} onContinue={onContinue} onRetry={jest.fn()} onManualEntry={jest.fn()} />);
  expect(onContinue).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Voir les détails'));
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('CONTINUER')).toBeNull();
});

it('offers only the local opening retry when details are ready but saving failed', () => {
  const onContinue = jest.fn(), onRetry = jest.fn();
  render(<AnalysisFooter screenState="complete" handoffError bottomInset={0} onContinue={onContinue} onRetry={onRetry} onManualEntry={jest.fn()} />);
  expect(screen.getByText('Les détails sont prêts. Réessayez pour les ouvrir.')).toBeTruthy();
  fireEvent.press(screen.getByText('Réessayer'));
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(onRetry).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sell-analysis-relaunch')).toBeNull();
});
