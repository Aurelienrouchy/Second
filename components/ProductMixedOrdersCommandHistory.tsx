import {useCallback,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useQuery} from '@tanstack/react-query';
import {Button,Checkbox} from '@/components/ui';
import {ProductRoutingReauthentication,type RoutingReauthentication} from '@/components/ProductRoutingReauthentication';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {ProductMixedOrdersJournal} from '@/services/productMixedOrdersJournal';
import {PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} from '@/config/featureFlags';
import {colors,spacing,typography} from '@/constants/theme';
import type {ProductMixedOrderAttempt,ProductMixedOrderReceipt} from '@/types/productMixedOrders';
const keyExtractor=(a:ProductMixedOrderAttempt)=>a.requestId;
const EMPTY_ATTEMPTS:ProductMixedOrderAttempt[]=[];
export function ProductMixedOrdersCommandHistory({uid,renderReauthentication}:{uid:string;renderReauthentication?:RoutingReauthentication}){
  const base=useLabelLifecycleContext('product-mixed-orders-own-journal',uid),key=JSON.stringify([base.frame,base.focusRevision,uid]),lock=useRef(false),epoch=useRef(0);
  const [busy,setBusy]=useState<string|null>(null),[receipt,setReceipt]=useState<{key:string;value:ProductMixedOrderReceipt}|null>(null),[notice,setNotice]=useState<{key:string;text:string}|null>(null),[confirmed,setConfirmed]=useState<string|null>(null),[reauthenticated,setReauthenticated]=useState<string|null>(null);
  const q=useQuery({queryKey:['product-mixed-orders-sdk-journal',uid,key],enabled:base.focused,staleTime:0,gcTime:0,retry:false,queryFn:()=>{const op=base.capture();return ProductMixedOrdersJournal.list(uid,()=>base.assertCurrent(op));}});
  const attempts=base.focused&&q.isSuccess&&!q.isFetching&&!q.isError?q.data:EMPTY_ATTEMPTS;
  const run=useCallback(async(a:ProductMixedOrderAttempt,mode:'observe'|'resume'|'neutralize'|'acknowledge')=>{
    if(lock.current||a.uid!==uid||!attempts.some(x=>x.requestId===a.requestId)||mode==='resume'&&(confirmed!==a.requestId||reauthenticated!==`${key}:${a.requestId}`))return;
    let op;try{op=base.start();}catch{return;}if(!op)return;lock.current=true;const e=++epoch.current,current=()=>{base.assertCurrent(op);if(epoch.current!==e)throw new Error('Une autre intention a été choisie.');};setBusy(key);setNotice(null);
    try{const r=mode==='resume'?await ProductMixedOrdersJournal.resume(a,current,async()=>{current();if(!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED)throw new Error('Les nouveaux effets du mélange restent fermés.');}):await ProductMixedOrdersJournal[mode](a,current);current();setReceipt({key,value:r});setConfirmed(null);setReauthenticated(null);await q.refetch();current();}
    catch(error){try{current();setNotice({key,text:error instanceof Error?error.message:'Relisez le même reçu exact.'});await q.refetch();}catch{/* Journal remains independent. */}}finally{base.finish(op);lock.current=false;if(base.isCurrent(op))setBusy(null);}
  },[uid,attempts,confirmed,reauthenticated,key,base,q]);
  const renderItem=useCallback(({item}:{item:ProductMixedOrderAttempt})=>{const r=receipt?.key===key&&receipt.value.requestId===item.requestId?receipt.value:null;return <View style={styles.section}>
    <Text selectable style={styles.caption}>Intention propre : {item.requestId} · {item.command.kind==='link_orders'?'liaison privée':`réexamen de ${item.command.reference.context.id}`}.</Text><Text selectable style={styles.body}>{item.command.privateNote}</Text><Text style={styles.caption}>Les sources et instructions d’origine sont conservées exactement ; aucun état courant ou accès aux nouveaux dossiers n’est accordé par ce journal.</Text>
    <Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'observe')}>Observer le reçu exact</Button>
    {renderReauthentication&&r?.state==='unrecorded'?<><Checkbox checked={confirmed===item.requestId} disabled={busy===key} onToggle={()=>{epoch.current++;setConfirmed(confirmed===item.requestId?null:item.requestId);setReauthenticated(null);}}><Text style={styles.caption}>Reprendre seulement cette même intention et ses anciennes références ; toute nouvelle mutation reste soumise au rôle, aux sources et au stage serveur.</Text></Checkbox>
      <ProductRoutingReauthentication render={renderReauthentication} uid={uid} sourceKey={`${key}:${item.requestId}`} parcel disabled={busy===key||confirmed!==item.requestId||!PRODUCT_MIXED_ORDERS_REVIEW_ENABLED} onVerified={()=>{try{base.capture();if(confirmed===item.requestId)setReauthenticated(`${key}:${item.requestId}`);}catch{/* Old authentication. */}}}/>
      <Button variant="secondary" disabled={busy===key||confirmed!==item.requestId||reauthenticated!==`${key}:${item.requestId}`} onPress={()=>void run(item,'resume')}>Reprendre exactement l’intention conservée</Button></>:null}
    <Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'neutralize')}>Neutraliser cette intention non engagée</Button>
    {r?<Text style={styles.caption}>{r.state==='committed'?'Résultat historique enregistré':r.state==='not_executed'?`Non exécuté : ${r.reason}`:'Aucun reçu visible ; le résultat reste inconnu'} · {r.recordedAt??'date inconnue'}. Ce reçu ne certifie pas l’état actuel ou une récupération.</Text>:null}
    {r&&r.state!=='unrecorded'?<Button variant="secondary" disabled={busy===key} onPress={()=>void run(item,'acknowledge')}>Relire le reçu frais et terminer le suivi local</Button>:null}
  </View>;},[receipt,key,busy,confirmed,reauthenticated,renderReauthentication,uid,base,run]);
  return <View style={styles.section}><Text style={styles.title}>Mes intentions de mélange conservées</Text>{attempts.length?<View style={styles.viewport}><FlashList data={attempts} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View>:<Text style={styles.caption}>{q.isError?'Journal propre à relire.':q.isFetching?'Lecture du journal SDK…':'Aucune intention locale qualifiée visible.'}</Text>}<Button variant="secondary" disabled={!base.focused||busy===key||q.isFetching} onPress={()=>{try{base.capture();epoch.current++;void q.refetch();}catch{/* Inactive. */}}}>Relire mes intentions conservées</Button>{notice?.key===key?<Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text>:null}</View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},title:{...typography.body,color:colors.foreground},body:{...typography.bodySmall,color:colors.foreground},caption:{...typography.caption,color:colors.muted},viewport:{height:spacing['4xl']*5}});
