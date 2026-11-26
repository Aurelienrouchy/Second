import {useState} from 'react';
import {Modal, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Button, ScreenHeader} from '@/components/ui';
import {ShippingTransportTerms} from '@/components/ShippingTransportTerms';
import {colors, spacing, typography} from '@/constants/theme';
import {formatPriceWithCurrency} from '@/utils/formatPrice';
import type {ShippingPurchaseQuote, ShippingPurchaseRate} from '@/types/shippingPurchase';

interface Props {quote: ShippingPurchaseQuote; rate: ShippingPurchaseRate; sourceKey: string; disabled: boolean; assertCurrent: () => void; onSupport: () => void}
/** The chosen quote remains the only source; opening these details changes no acceptance. */
export function ShippingPurchaseConditions({quote, rate, sourceKey, disabled, assertCurrent, onSupport}: Props) {
  const [view, setView] = useState({sourceKey, open: false});
  if (view.sourceKey !== sourceKey) setView({sourceKey, open: false});
  const visible = view.sourceKey === sourceKey && view.open;
  const policy = quote.purchasePolicy.parameters;
  const terms = quote.transport;
  const dev = terms?.testMode === 'seconde_dev_commerce_v1';
  const close = () => setView({sourceKey, open: false});
  return <View style={styles.section}>
    {dev ? <Text style={styles.test}>Livraison de test · aucun colis réel</Text> : terms ? <Text style={styles.caption}>Couverture prévue : {formatPriceWithCurrency(terms.coverage.coveredValueCents / 100)} · franchise {formatPriceWithCurrency(terms.coverage.deductibleCents / 100)}</Text> : null}
    <Text style={styles.caption}>Protection acheteur : {policy.deliveryProtectionMs / 86400000} jours après la livraison.</Text>
    <Button variant="ghost" disabled={disabled} onPress={() => {try {assertCurrent(); setView({sourceKey, open: true});} catch {/* Old quote. */}}}>Conditions de l’achat</Button>
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={close}>
      <SafeAreaProvider style={styles.container}><View style={styles.container}><ScreenHeader title="Conditions de l’achat" onBack={close} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Votre achat avec livraison</Text>
          <Text style={styles.body}>Le vendeur dispose de {policy.nonShipmentMs / 86400000} jours après le paiement pour expédier le colis.</Text>
          <Text style={styles.body}>Vous disposez de {policy.deliveryProtectionMs / 86400000} jours après la livraison pour signaler un problème. Les fonds du vendeur sont retenus pendant {policy.fundsHoldMs / 86400000} jours.</Text>
          {quote.purchasePolicy.policyVersion === 'shipping_purchase_2026_02' ? <Text style={styles.body}>Le paiement doit être terminé dans l’heure qui suit la réservation.</Text> : null}
          <Text style={styles.body}>Un seul colis par commande. L’étiquette doit être imprimée au format 4 × 6 pouces.</Text>
          {terms ? <ShippingTransportTerms terms={terms} insuranceCostCents={rate.componentsCents.insurance} detailsOnly disabled={disabled}
            assertCurrent={assertCurrent} onSupport={() => {try {assertCurrent(); close(); onSupport();} catch {/* Old quote. */}}} /> : null}
        </ScrollView>
      </View></SafeAreaProvider>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, section: {gap: spacing.sm}, content: {padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl']},
  title: {...typography.h3, color: colors.foreground}, body: {...typography.body, color: colors.foregroundSecondary}, caption: {...typography.caption, color: colors.foregroundSecondary}, test: {...typography.bodySmall, color: colors.primary}});
