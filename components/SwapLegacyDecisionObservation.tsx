import {useState} from 'react';
import {StyleSheet,Text,TextInput,View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {resolveSwapDispute,type SwapDisputeIssue} from '@/services/swapService';
import {createSwapReviewInteraction,swapReviewId} from '@/utils/swapDisputeReviewContract';
import {colors,spacing,typography} from '@/constants/theme';
/** SDK-owned legacy receipt observation only. No mutation, replay or new decision. */
export function SwapLegacyDecisionObservation({uid}:{uid:string}){
 const base=useLabelLifecycleContext('swap-legacy-own-receipt',uid),[interaction]=useState(createSwapReviewInteraction);
 const [form,setForm]=useState({swapId:'',issue:'refund_payer' as SwapDisputeIssue,note:''}),[revision,setRevision]=useState(0);
 const [request,setRequest]=useState<{key:string;form:typeof form;assertChoice:()=>void}|null>(null);
 const key=JSON.stringify([uid,base.focusRevision,revision]),choice=interaction.capture();
 const q=useQuery({queryKey:['swap-legacy-own-receipt',uid,key],enabled:base.focused&&request?.key===key,staleTime:0,gcTime:0,retry:false,
  queryFn:()=>{if(!request||request.key!==key)throw new Error('Relisez le même reçu historique.');const op=base.capture();return resolveSwapDispute(request.form.swapId,request.form.issue,request.form.note,{mode:'observe',expectedAdminUid:uid,assertCurrent:()=>{base.assertCurrent(op);request.assertChoice();}});}});
 const value=base.focused&&request?.key===key&&q.isSuccess&&!q.isFetching&&!q.isError?q.data:null;
 const change=(patch:Partial<typeof form>)=>{try{base.capture();choice();interaction.invalidate();setRequest(null);setRevision(n=>n+1);setForm({...form,...patch});}catch{/* An old input callback is inert. */}};
 const observe=()=>{try{base.capture();choice();if(!swapReviewId(form.swapId.trim()))return;interaction.invalidate();const next=revision+1;setRevision(next);setRequest({key:JSON.stringify([uid,base.focusRevision,next]),form:{...form,swapId:form.swapId.trim(),note:form.note.trim()},assertChoice:interaction.capture()});}catch{/* Inactive SDK frame. */}};
 return <View style={styles.section}><Text style={styles.body}>Observer une ancienne décision personnelle</Text>
  <Text style={styles.caption}>Lecture seule du reçu d’origine sous votre compte SDK. Saisissez le même Troc, le même type historique et la note exacte. Cette recherche ne renvoie aucune instruction et ne débloque aucune nouvelle action.</Text>
  <TextInput value={form.swapId} autoCapitalize="none" autoCorrect={false} maxLength={128} onChangeText={swapId=>change({swapId})} style={styles.input} placeholder="Identifiant du Troc historique" placeholderTextColor={colors.muted} accessibilityLabel="Troc du reçu historique personnel"/>
  <Button variant="secondary" disabled={!base.focused} onPress={()=>change({issue:'refund_payer'})}>{form.issue==='refund_payer'?'Type sélectionné : ':''}Ancienne décision de remboursement</Button>
  <Button variant="secondary" disabled={!base.focused} onPress={()=>change({issue:'release_payee'})}>{form.issue==='release_payee'?'Type sélectionné : ':''}Ancienne décision de libération</Button>
  <TextInput multiline maxLength={500} value={form.note} onChangeText={note=>change({note})} style={styles.input} placeholder="Note exacte de la décision ancienne, si présente" placeholderTextColor={colors.muted} accessibilityLabel="Note exacte du reçu historique"/>
  <Button variant="secondary" disabled={!base.focused||!swapReviewId(form.swapId.trim())||q.isFetching} onPress={observe}>Observer uniquement mon reçu historique</Button>
  {q.isFetching?<Text style={styles.caption}>Lecture du reçu d’origine…</Text>:null}
  {value?<><Text selectable style={styles.caption}>{value.observationState==='recorded'?`Instruction et notifications historiques enregistrées le ${value.committedAt}`:'Reçu non confirmé : résultat historique inconnu ; aucune non-exécution n’est démontrée.'}</Text>
   {value.decisionKey?<Text selectable style={styles.caption}>Référence historique {value.decisionKey} · source {value.sourceHash}</Text>:null}
   <Text style={styles.caption}>Ce constat ne confirme aucun remboursement, solde disponible, retour, livraison au téléphone ou lecture. Il ne change ni le formulaire de nouvelle revue ni les fonds ou les articles.</Text></>:null}
  {request?.key===key&&q.isError?<Text accessibilityRole="alert" style={styles.caption}>Le propre reçu historique reste à rapprocher. Rien n’a été réexécuté.</Text>:null}
 </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},body:{...typography.bodySmall,color:colors.foreground},caption:{...typography.caption,color:colors.muted},input:{...typography.bodySmall,color:colors.foreground,borderWidth:1,borderColor:colors.border,padding:spacing.md}});
