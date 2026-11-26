import {StyleSheet,Text,View} from 'react-native';
import {Button} from '@/components/ui';
import {BankDisputeCaseSummary} from '@/components/BankDisputeCaseSummary';
import type {BankDisputeCaseList} from '@/types/bankDisputeCase';
import {colors,spacing,typography} from '@/constants/theme';
export function AdminBankDisputeCaseRow({row,disabled,onSelect}:{row:BankDisputeCaseList['rows'][number];disabled:boolean;onSelect:(transactionId:string,disputeId:string)=>void}){if(row.qualification==='unknown')return <Text style={styles.caption}>Dossier historique inconnu {row.caseId}. Aucune commande ou issue bancaire n’est déduite.</Text>;const c=row.case;return <View style={styles.section}><BankDisputeCaseSummary value={c} admin/><Button variant="secondary" disabled={disabled||!c.transactionId||!c.disputeId} onPress={()=>{if(c.transactionId&&c.disputeId)onSelect(c.transactionId,c.disputeId);}}>Examiner ce dossier bancaire exact</Button></View>;}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},caption:{...typography.caption,color:colors.muted}});
