import {StyleSheet,Text,View} from 'react-native';
import {Button} from '@/components/ui';
import {TransportContactStatementSummary} from '@/components/TransportContactStatementSummary';
import {TRANSPORT_CONTACT_INSTRUCTION_LABELS} from '@/components/TransportContactInstructionFields';
import type {TransportContactEntry,TransportContactHistory} from '@/types/transportContact';
import {colors,spacing,typography} from '@/constants/theme';
export function TransportContactHistoryEntry({row,uid,disabled,onReply}:{row:TransportContactHistory['entries'][number];uid:string;disabled:boolean;onReply:(entry:TransportContactEntry)=>void}){
  if(row.qualification==='unknown')return <Text style={styles.caption}>Entrée historique inconnue : aucune absence de faits ni conformité n’est déduite.</Text>;
  const e=row.entry;
  return <View style={styles.section}><Text selectable style={styles.caption}>Entrée {e.entryId} · {e.contentHash}{'\n'}{e.recordedAt} · {e.actorRole==='operator'?'Opérateur enregistré':e.actorRole==='buyer'?'Déclarant acheteur enregistré':'Déclarant vendeur enregistré'}.</Text><Text selectable style={styles.body}>{e.partySummary??'Aucun texte communicable dans cette portée.'}</Text>
    {e.command&&e.command.action!=='record_instruction'?<TransportContactStatementSummary value={e.command.statement}/>:null}
    {e.instruction?<Text style={styles.caption}>Instruction historique : {TRANSPORT_CONTACT_INSTRUCTION_LABELS[e.instruction.action]}. Rappel opérateur : {e.instruction.nextFollowUpAt??'inconnu'}. L’échéance du transporteur est une autre donnée.</Text>:null}
    {e.command?.action==='record_instruction'?<><Text selectable style={styles.caption}>Motivation privée accessible dans cette portée : {e.command.instruction.privateNote}</Text><Text selectable style={styles.caption}>Instruction acheteur : {e.command.instruction.buyerMessage}{'\n'}Instruction vendeur : {e.command.instruction.sellerMessage}</Text></>:null}
    {e.kind!=='record_instruction'&&e.actorId!==uid?<Button variant="secondary" disabled={disabled} onPress={()=>onReply(e)}>Répondre à cette déclaration exacte</Button>:null}
  </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},body:{...typography.bodySmall,color:colors.foreground},caption:{...typography.caption,color:colors.muted}});
