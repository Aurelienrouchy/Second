import {Text,StyleSheet} from 'react-native';
import type {CarrierCostClaimMonetarySummary as Summary} from '@/types/carrierCostClaim';
import {colors,typography} from '@/constants/theme';
export function CarrierCostClaimMonetarySummary({value}:{value:Summary}){return <Text selectable style={styles.caption}>{value.qualification==='coherent_documentary_amounts'?`Rapprochement des seules références sélectionnées, en cents CAD : base ${value.basisAmountCents} ; ajustements signés ${value.adjustmentCents} ; documents de règlement ${value.settlementDocumentCents} ; reste documentaire ${value.remainingDocumentaryCents}.`:'Montants rapprochés inconnus : la base, l’attribution ou les documents ne permettent pas de calculer un reste cohérent.'} L’arrivée d’argent et l’exhaustivité de la comptabilité du transporteur ne sont pas vérifiées. Aucun débit, crédit ou paiement n’est autorisé.</Text>;}
const styles=StyleSheet.create({caption:{...typography.caption,color:colors.muted}});
