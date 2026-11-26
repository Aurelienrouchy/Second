import React, {useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import {formatPriceWithCurrency} from '@/utils/formatPrice';
import type {ShippingTransportConfirmation, ShippingTransportTerms as Terms} from '@/types/shippingPurchase';

const confirmationLabels: Record<ShippingTransportConfirmation, string> = {
  none: 'Aucune confirmation demandée', delivery: 'Confirmation de livraison demandée', signature: 'Signature demandée',
  adult_signature: 'Signature d’un adulte demandée', direct_signature: 'Signature directe demandée',
  delivery_mailed: 'Confirmation de livraison par courrier demandée', verbal_confirmation: 'Confirmation verbale demandée',
};
const beneficiaryLabels: Record<Terms['coverage']['beneficiary'], string> = {seconde_operator: 'Exploitant de Seconde', seller: 'Vendeur', buyer: 'Acheteur'};
interface Props {
  terms: Terms; insuranceCostCents?: number; historical?: boolean; disabled?: boolean;
  detailsOnly?: boolean;
  assertCurrent: () => void; onSupport: () => void;
}
/** Display only a qualified public snapshot. No carrier account or private evidence is rendered. */
export function ShippingTransportTerms({terms, insuranceCostCents, historical = false, disabled = false, detailsOnly = false, assertCurrent, onSupport}: Props) {
  const c = terms.coverage;
  const [expanded, setExpanded] = useState(false);
  const open = (url: string) => {
    try {assertCurrent(); if (disabled) return; void Linking.openURL(url).catch(() => undefined);} catch {/* A stale source cannot open its instruction. */}
  };
  const support = () => {try {assertCurrent(); if (!disabled) onSupport();} catch {/* Source or SDK changed. */}};
  if (terms.testMode === 'seconde_dev_commerce_v1') return <View style={styles.container}>
    <Text accessibilityRole="header" style={styles.title}>Livraison de test</Text>
    <Text style={styles.body}>Aucun colis réel ne sera expédié. L’étiquette et le suivi permettent de tester la commande dans Seconde Dev.</Text>
    <Text style={styles.caption}>Aucune assurance ni couverture transport réelle.</Text>
  </View>;
  return <View style={styles.container}>
    {!detailsOnly ? <Button variant="ghost" disabled={disabled} onPress={() => {try {assertCurrent(); setExpanded(value => !value);} catch { /* The current delivery terms must still be available. */ }}}>
      {expanded ? 'Masquer les conditions de livraison' : 'Conditions de livraison'}
    </Button> : null}
    {detailsOnly || expanded ? <>
    <Text accessibilityRole="header" style={styles.title}>{historical ? 'Livraison de cette commande' : 'Couverture et dépôt'}</Text>
    <Text style={styles.body}>Valeur déclarée de l’article : {formatPriceWithCurrency(c.declaredValueCents / 100)} CAD. Valeur visée par les conditions : {formatPriceWithCurrency(c.coveredValueCents / 100)} CAD, hors frais de service et de livraison.</Text>
    <Text style={styles.body}>Plafond : {formatPriceWithCurrency(c.maxCents / 100)} CAD. Franchise : {formatPriceWithCurrency(c.deductibleCents / 100)} CAD. Bénéficiaire prévu : {beneficiaryLabels[c.beneficiary]}.</Text>
    <Text style={styles.body}>Frais d’assurance dans le tarif : {insuranceCostCents === undefined ? 'non fournis dans cette lecture' : `${formatPriceWithCurrency(insuranceCostCents / 100)} CAD`}. Ces frais sont distincts de la valeur déclarée et du plafond.</Text>
    <Text style={styles.body}>Exclusions et limites : {c.exclusions}</Text>
    {(['forward', 'return'] as const).map(direction => {
      const leg = terms[direction], name = direction === 'forward' ? 'Aller' : 'Retour éventuel';
      return <View key={direction} style={styles.leg}>
        <Text style={styles.subtitle}>{name} · {confirmationLabels[leg.confirmation]}</Text>
        <Text style={styles.body}>{leg.handoff.mode === 'ordinary_dropoff' ? 'Dépôt ordinaire selon les consignes du transporteur.' : 'Collecte à organiser par le membre selon les consignes du transporteur.'} {leg.handoff.instructions}</Text>
        <Button variant="ghost" disabled={disabled} onPress={() => open(leg.handoff.officialUrl)}>Consulter les consignes officielles — {name.toLowerCase()}</Button>
        {leg.handoff.alternative ? <>
          <Text style={styles.body}>Solution prévue si cette modalité est indisponible : {leg.handoff.alternative.instructions}</Text>
          <Button variant="ghost" disabled={disabled} onPress={() => open(leg.handoff.alternative!.officialUrl)}>Consulter la solution documentée — {name.toLowerCase()}</Button>
        </> : <Text style={styles.body}>Aucune autre modalité n’est enregistrée. Si le dépôt ou la collecte est indisponible, contactez notre équipe avant d’envoyer.</Text>}
      </View>;
    })}
    <Button variant="secondary" disabled={disabled} onPress={support}>Une question sur la livraison ?</Button>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({container: {gap: spacing.md}, leg: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground},
  subtitle: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foregroundSecondary},
  caption: {...typography.caption, color: colors.muted}});
