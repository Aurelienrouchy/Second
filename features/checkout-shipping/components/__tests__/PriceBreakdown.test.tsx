import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PriceBreakdown } from '@/features/checkout-shipping/components/PriceBreakdown';
import type { ShippingPurchaseRate, ServiceFeeTaxSnapshot } from '@/types/shippingPurchase';
const rate: ShippingPurchaseRate = { rateId: 'rate', shipmentId: 'shipment', carrierId: 'carrier', carrierCode: 'canada_post', carrierFriendlyName: 'Postes Canada', serviceCode: 'standard', serviceType: 'Standard', componentsCents: { shipping: 850, insurance: 0, confirmation: 0, other: 0 }, shippingCents: 850, estimatedDeliveryDays: 3, currency: 'CAD', shippingCost: 8.5, amount: 45, serviceFee: 4.5, taxTotal: 0, totalAmount: 58 };
const tax: ServiceFeeTaxSnapshot = { schemaVersion: 1, protocol: 'service_fee_tax_v1', currency: 'CAD', taxableServiceFee: 4.5, gst: 0, qst: 0, taxTotal: 0, technicalConfiguration: { enabled: false, gstRate: .05, qstRate: .09975 }, registrationStatusVerified: false };
it('restitue les quatre montants du tarif natif en CAD, sans les recalculer', () => {
 render(<PriceBreakdown rate={rate} taxSnapshot={tax} />);
 for (const text of ['Article', 'Livraison', 'Frais de service', 'Total', '45,00 $ CA', '8,50 $ CA', '4,50 $ CA', '58,00 $ CA']) expect(screen.getByText(text)).toBeOnTheScreen();
});
it('ne présente aucune taxe lorsque la capture native est à zéro', () => {
 render(<PriceBreakdown rate={rate} taxSnapshot={tax} />);
 expect(screen.queryByText('TPS sur le service')).toBeNull(); expect(screen.queryByText('TVQ sur le service')).toBeNull();
});
it('conserve les frais de service à zéro dans la ventilation', () => {
 render(<PriceBreakdown rate={{ ...rate, serviceFee: 0, totalAmount: 53.5 }} taxSnapshot={tax} />);
 expect(screen.getByText('Frais de service')).toBeOnTheScreen(); expect(screen.getByText('0,00 $ CA')).toBeOnTheScreen(); expect(screen.getByText('53,50 $ CA')).toBeOnTheScreen();
});
it('affiche les taxes enregistrées sur le service et le total figé', () => {
 render(<PriceBreakdown rate={{ ...rate, taxTotal: .67, totalAmount: 58.67 }} taxSnapshot={{ ...tax, gst: .22, qst: .45, taxTotal: .67 }} />);
 for (const text of ['TPS sur le service', 'TVQ sur le service', '0,22 $ CA', '0,45 $ CA', '58,67 $ CA']) expect(screen.getByText(text)).toBeOnTheScreen();
});
