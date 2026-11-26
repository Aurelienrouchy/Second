import {useCallback,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {SwapDisputeReviewReceiptSummary} from '@/components/SwapDisputeReviewReceiptSummary';
import {SwapLegacyDecisionObservation} from '@/components/SwapLegacyDecisionObservation';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {SwapDisputeReviewJournal} from '@/services/swapDisputeReviewJournal';
import {createSwapReviewInteraction} from '@/utils/swapDisputeReviewContract';
import type {SwapDisputeReviewAttempt,SwapDisputeReviewReceipt} from '@/types/swapDisputeReview';
import {colors,spacing,typography} from '@/constants/theme';
const keyExtractor=(a:SwapDisputeReviewAttempt)=>JSON.stringify([a.uid,a.swapId,a.requestId]);
const EMPTY:SwapDisputeReviewAttempt[]=[];
export function SwapDisputeReviewCommandHistory({uid}:{uid:string}){
 const base=useLabelLifecycleContext('swap-review-own-journal',uid),key=JSON.stringify([uid,base.focusRevision]),client=useQueryClient();
 const [interaction]=useState(createSwapReviewInteraction),lock=useRef(false),[busy,setBusy]=useState<string|null>(null);
 const [receipt,setReceipt]=useState<{key:string;value:SwapDisputeReviewReceipt}|null>(null),[notice,setNotice]=useState<{key:string;text:string}|null>(null);
 const q=useQuery({queryKey:['swap-review-sdk-journal',uid,key],enabled:base.focused,staleTime:0,gcTime:0,retry:false,queryFn:()=>{const op=base.capture();return SwapDisputeReviewJournal.list(uid,()=>base.assertCurrent(op));}});
 const attempts=base.focused&&q.isSuccess&&!q.isFetching&&!q.isError?q.data:EMPTY;
 const run=useCallback(async(a:SwapDisputeReviewAttempt,mode:'observe'|'neutralize'|'acknowledge')=>{
  if(lock.current||a.uid!==uid||!attempts.some(x=>keyExtractor(x)===keyExtractor(a)))return;
  interaction.invalidate();const choice=interaction.capture();let op;try{op=base.start();}catch{return;}if(!op)return;lock.current=true;setBusy(key);setNotice(null);
  const current=()=>{base.assertCurrent(op);choice();};
  try{const r=await SwapDisputeReviewJournal[mode](a,current);current();setReceipt({key,value:r});await client.invalidateQueries({queryKey:['swap-review-sdk-journal',uid]});current();}
  catch(error){try{current();setNotice({key,text:error instanceof Error?error.message:'Votre propre reçu doit être observé à nouveau.'});await q.refetch();}catch{/* A stale journal callback has no authority. */}}
  finally{base.finish(op);lock.current=false;if(base.isCurrent(op))setBusy(null);}
 },[uid,attempts,interaction,base,key,q,client]);
 const renderItem=useCallback(({item}:{item:SwapDisputeReviewAttempt})=>{const r=receipt?.key===key&&receipt.value.swapId===item.swapId&&receipt.value.requestId===item.requestId?receipt.value:null;return <View style={styles.section}>
  <Text selectable style={styles.caption}>Troc {item.swapId} · intention {item.requestId} · version source {item.command.source.version} · empreinte {item.payloadHash}</Text>
  <Text style={styles.caption}>Motivation et messages conservés avec cette intention privée. Le suivi propre n’en réaffiche pas le contenu. Il reste accessible sans nouvelle admission au dossier.</Text>
  <Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'observe')}>Observer mon propre reçu</Button>
  <Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'neutralize')}>Neutraliser cette intention encore non enregistrée</Button>
  {r?<SwapDisputeReviewReceiptSummary value={r}/>:null}
  {r&&r.state!=='unrecorded'?<Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'acknowledge')}>Relire un reçu terminal frais et terminer ce suivi local</Button>:null}
 </View>;},[receipt,key,busy,run]);
 return <View style={styles.section}><Text style={styles.body}>Mes intentions documentaires de Troc</Text>
  {attempts.length?<View style={styles.viewport}><FlashList data={attempts} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View>:<Text style={styles.caption}>{q.isFetching?'Lecture du journal…':q.isError?'Votre journal reste à rapprocher ; aucune intention inconnue ne doit être recréée.':'Aucune intention locale qualifiée visible.'}</Text>}
  <Button variant="secondary" disabled={!base.focused||busy===key||q.isFetching} onPress={()=>{try{base.capture();interaction.invalidate();setReceipt(null);void q.refetch();}catch{/* Inactive SDK frame. */}}}>Relire mon journal</Button>
  {notice?.key===key?<Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text>:null}
  <SwapLegacyDecisionObservation uid={uid}/>
 </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},body:{...typography.bodySmall,color:colors.foreground},caption:{...typography.caption,color:colors.muted},viewport:{height:spacing['4xl']*5}});
