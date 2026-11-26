import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PayButton } from '@/features/checkout-shipping/components/PayButton';
function setup(overrides: Partial<React.ComponentProps<typeof PayButton>> = {}) {
 const props = { totalAmount: 58, accepted: true, submitting: false, disabled: false, onPress: jest.fn(), ...overrides }; render(<PayButton {...props} />); return props;
}
it('présente le total CAD puis continue vers le paiement distinct', () => {
 const { onPress } = setup(); expect(screen.getByText('58,00 $ CA')).toBeOnTheScreen(); fireEvent.press(screen.getByRole('button', { name: 'Continuer vers le paiement' })); expect(onPress).toHaveBeenCalledTimes(1);
});
it('conserve une étape de continuation pour un montant nul sans prétendre payer', () => {
 setup({ totalAmount: 0 }); expect(screen.getByText('0,00 $ CA')).toBeOnTheScreen(); expect(screen.getByText('Continuer vers le paiement')).toBeOnTheScreen(); expect(screen.queryByText(/PAYER AVEC LE PORTE-MONNAIE/)).toBeNull();
});
it('affiche fidèlement un montant décimal', () => { setup({ totalAmount: 12.5 }); expect(screen.getByText('12,50 $ CA')).toBeOnTheScreen(); });
it.each([{ accepted: false }, { submitting: true }, { disabled: true }])('bloque la continuation pour %j', overrides => {
 const { onPress } = setup(overrides); const button = screen.getByRole('button'); expect(button).toBeDisabled(); fireEvent.press(button); expect(onPress).not.toHaveBeenCalled();
});
