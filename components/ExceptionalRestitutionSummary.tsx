import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { formatCents } from '@/utils/formatPrice';
import type { ExceptionalRestitutionSource } from '@/types/exceptionalRestitution';
const labels: Record<ExceptionalRestitutionSource['state'], string> = {
  unqualified: 'Les sources ne permettent pas encore de qualifier une restitution.', available: 'Un examen documentaire est possible ; aucune instruction n’est encore exécutée.',
  prepared: 'Une instruction est préparée. Sa préparation ne prouve aucun virement.', operator_attested: 'L’exécution a fait l’objet d’une attestation humaine de Seconde. L’arrivée bancaire n’est pas automatiquement vérifiée.',
  voided: 'Une instruction déclarée jamais exécutée a été close.', reconciliation_required: 'Un rapprochement est nécessaire. Aucun paiement supplémentaire ne doit être déduit de cette lecture.',
};
export function ExceptionalRestitutionSummary({source, audience = 'admin'}: {source: ExceptionalRestitutionSource; audience?: 'admin' | 'owner'}) {
  const credit = source.context.kind === 'refund_error' && source.context.harm === 'seller_debt_compensation';
  return <View style={styles.section}>
    <Text style={styles.body}>{credit ? source.state === 'operator_attested' ? 'Le crédit compensatoire interne de Seconde est enregistré dans le portefeuille.'
      : source.state === 'prepared' ? 'L’instruction de crédit compensatoire est préparée. Aucun crédit n’est encore enregistré.'
        : source.state === 'voided' ? 'L’instruction a été close avant le crédit compensatoire.' : source.state === 'reconciliation_required' ? 'Le crédit compensatoire doit être rapproché ; aucun nouveau crédit n’est déduit.' : labels[source.state] : labels[source.state]}</Text>
    {audience === 'admin' ? <><Text selectable style={styles.caption}>Bénéficiaire natif : {source.beneficiaryId ?? 'non qualifié'}.</Text>
      <Text style={styles.caption}>Plafond natif : {source.maximumCents === null ? 'inconnu' : formatCents(source.maximumCents)} CAD. Montant de l’instruction : {source.amountCents === null ? 'non établi' : formatCents(source.amountCents)} CAD.</Text>
      <Text style={styles.caption}>{source.funding === 'existing_wallet' ? 'Restitution réservée sur le solde existant.' : source.funding === 'seconde_compensation' ? 'Compensation portée par Seconde, selon le préjudice vérifié.' : source.funding === 'seconde_wallet_compensation' ? 'Crédit compensatoire intégral porté par Seconde, distinct de la vente et des écritures historiques.' : source.funding === 'original_refund_allocation' ? 'Allocation de remboursement d’origine à traiter dans son parcours existant.' : 'Origine des fonds non qualifiée.'}</Text></>
      : <Text style={styles.caption}>Montant de l’instruction enregistrée : {source.amountCents === null ? 'à qualifier' : `${formatCents(source.amountCents)} CAD`}.</Text>}
    {source.context.kind === 'refund_error' && source.context.harm === 'seller_undue_debit' ? <Text style={styles.caption}>Cette compensation monétaire porte sur le débit effectivement prélevé. Une dette éventuelle reste distincte et n’est pas corrigée par ce virement.</Text> : null}
    {credit && source.nativeWalletCredit ? <Text style={styles.caption}>Crédit natif enregistré : {formatCents(source.nativeWalletCredit.debtOffsetCents)} CAD imputés sur la dette courante ; {formatCents(source.nativeWalletCredit.balanceCreditCents)} CAD ajoutés au solde. Ce crédit ne réécrit pas le remboursement historique et ne constitue pas un revenu de vente.</Text> : null}
    <Text style={styles.caption}>{audience === 'owner'
      ? 'Ce suivi ne confirme ni la réception du virement ni le rétablissement d’un compte.'
      : 'Aucune confirmation Stripe, arrivée bancaire automatique ou récupération de compte n’est accordée par ce suivi.'}</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
