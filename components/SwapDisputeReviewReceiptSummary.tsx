import {StyleSheet,Text,View} from 'react-native';
import type {SwapDisputeReviewReceipt} from '@/types/swapDisputeReview';
import {colors,spacing,typography} from '@/constants/theme';
export function SwapDisputeReviewReceiptSummary({value}:{value:SwapDisputeReviewReceipt}){return <View style={styles.section}>
 <Text selectable style={styles.body}>{value.state==='committed'?'Revue documentaire et deux notifications enregistrées':value.state==='not_executed'?'Non-exécution de cette intention confirmée':'Résultat encore inconnu — conservez la même intention'}</Text>
 <Text selectable style={styles.caption}>Troc {value.swapId} · intention {value.requestId} · {value.recordedAt??'aucune date native confirmée'}{value.reason?` · motif ${value.reason}`:''}</Text>
 {value.reference?<Text selectable style={styles.caption}>Référence {value.reference.id} · version {value.reference.version} · empreinte {value.reference.contentHash}</Text>:null}
 <Text style={styles.caption}>Ce reçu n’autorise aucun remboursement, déblocage de fonds, retour, remise en vente ou clôture du litige. L’enregistrement de notifications ne prouve ni leur livraison au téléphone ni leur lecture.</Text>
 </View>;}
const styles=StyleSheet.create({section:{gap:spacing.sm},body:{...typography.bodySmall,color:colors.foreground},caption:{...typography.caption,color:colors.muted}});
