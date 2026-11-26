import {StyleSheet,Text,View} from 'react-native';
import {BankDisputeCasePanel} from '@/components/BankDisputeCasePanel';
import {BankDisputeCommandHistory} from '@/components/BankDisputeCommandHistory';
import {parseBankDisputeCaseNotice} from '@/services/bankDisputeCaseNoticeService';
import type {BankDisputeCaseNotice} from '@/types/bankDisputeCase';
import {bankCaseProviderId} from '@/utils/bankDisputeCaseContract';
import {colors,spacing,typography} from '@/constants/theme';
export function BankDisputeOwnerPanel({uid,transactionId,disputeId,sourceKey,noticeReference,assertSelection,compact=false}:{uid:string;transactionId:string;disputeId?:string;sourceKey:string;noticeReference?:BankDisputeCaseNotice;assertSelection?:()=>void;compact?:boolean}){
  const selected=noticeReference===undefined?null:parseBankDisputeCaseNotice(noticeReference,uid),invalid=noticeReference!==undefined&&(!selected||selected.transactionId!==transactionId),selectedDispute=selected?.disputeId??disputeId;
  return !invalid&&selectedDispute&&bankCaseProviderId(selectedDispute,'du')?<BankDisputeCasePanel uid={uid} transactionId={transactionId} disputeId={selectedDispute} sourceKey={sourceKey} scope="own" noticeReference={selected??undefined} assertSelection={assertSelection} compact={compact}/>:<View style={styles.section}><BankDisputeCommandHistory uid={uid} scope="own" compact={compact}/><Text style={styles.caption}>{compact?(invalid?'Cet avis bancaire ne peut pas être ouvert. Reprenez-le depuis votre notification.':'Les informations de cette contestation sont indisponibles.'):invalid?'La référence bancaire adressée est invalide : aucun autre dossier ne remplace cet avis.':'Aucun dossier bancaire exact n’est sélectionné dans cette commande. Cela ne prouve pas l’absence d’une contestation.'}</Text></View>;
}

const styles=StyleSheet.create({section:{gap:spacing.sm},caption:{...typography.caption,color:colors.muted}});
