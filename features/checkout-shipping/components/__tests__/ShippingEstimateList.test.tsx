import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ShippingEstimateList } from '@/features/checkout-shipping/components/ShippingEstimateList';
import type { ShippingPurchaseRate } from '@/types/shippingPurchase';
const rates: ShippingPurchaseRate[] = ['Standard', 'Express'].map((serviceType, index) => ({ rateId: `rate-${index}`, shipmentId: 'shipment', carrierId: 'carrier', carrierCode: 'canada_post', carrierFriendlyName: 'Postes Canada', serviceCode: serviceType, serviceType, componentsCents: { shipping: index ? 1450 : 850, insurance: 0, confirmation: 0, other: 0 }, shippingCents: index ? 1450 : 850, estimatedDeliveryDays: index ? null : 3, currency: 'CAD', shippingCost: index ? 14.5 : 8.5, amount: 45, serviceFee: 4.5, taxTotal: 0, totalAmount: index ? 64 : 58 }));
it('présente les tarifs natifs et leur sélection sans inventer de délai', () => {
 render(<ShippingEstimateList rates={rates} selectedRateId={rates[0].rateId} onSelect={jest.fn()} loading={false} />);
 for (const text of ['Postes Canada · Standard', 'Environ 3 jours', '8,50 $ CA', 'Postes Canada · Express', 'Délai à confirmer', '14,50 $ CA']) expect(screen.getByText(text)).toBeOnTheScreen();
 expect(screen.getByRole('radio', { name: /Standard/ })).toHaveProp('accessibilityState', expect.objectContaining({ checked: true })); expect(screen.getByRole('radio', { name: /Express/ })).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
});
it('transmet le tarif natif exact choisi', () => {
 const onSelect = jest.fn(); render(<ShippingEstimateList rates={rates} selectedRateId={rates[0].rateId} onSelect={onSelect} loading={false} />);
 fireEvent.press(screen.getByRole('radio', { name: /Express/ })); expect(onSelect).toHaveBeenCalledTimes(1); expect(onSelect).toHaveBeenCalledWith(rates[1]);
});
it('ne propose aucun ancien tarif pendant un nouveau calcul', () => {
 render(<ShippingEstimateList rates={rates} selectedRateId={null} onSelect={jest.fn()} loading />);
 expect(screen.queryAllByRole('radio')).toHaveLength(0); expect(screen.queryByText('Aucun service disponible pour cette adresse pour le moment.')).toBeNull();
});
it('explique une réponse vide sans créer de tarif de repli', () => {
 render(<ShippingEstimateList rates={[]} selectedRateId={null} onSelect={jest.fn()} loading={false} />);
 expect(screen.getByText('Aucun service disponible pour cette adresse pour le moment.')).toBeOnTheScreen(); expect(screen.queryAllByRole('radio')).toHaveLength(0);
});
it('refuse la sélection lorsque le dossier est désactivé', () => {
 const onSelect = jest.fn(); render(<ShippingEstimateList rates={rates} selectedRateId={null} onSelect={onSelect} loading={false} disabled />);
 fireEvent.press(screen.getByRole('radio', { name: /Standard/ })); expect(onSelect).not.toHaveBeenCalled();
});
