import {useRef,useState,type ComponentType} from 'react';
import {StyleSheet,Text,TextInput,View} from 'react-native';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {Button,Checkbox} from '@/components/ui';
import {SwapDisputeReviewCommandHistory} from '@/components/SwapDisputeReviewCommandHistory';
import {SwapDisputeReviewFacts,swapDisputeReviewFacts} from '@/components/SwapDisputeReviewFacts';
import {SwapDisputeReviewReceiptSummary} from '@/components/SwapDisputeReviewReceiptSummary';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SwapDisputeReviewService} from '@/services/swapDisputeReviewService';
import {SwapDisputeReviewJournal} from '@/services/swapDisputeReviewJournal';
import {productReviewEqual,productReviewHash} from '@/services/productReviewService';
import {createSwapReviewInteraction,swapReviewId} from '@/utils/swapDisputeReviewContract';
import {SWAP_DISPUTE_REVIEW_ENABLED} from '@/config/featureFlags';
import {SWAP_DISPUTE_REVIEW_CAPABILITY,type SwapDisputeReviewAttempt,type SwapDisputeReviewCommand,type SwapDisputeReviewReceipt} from '@/types/swapDisputeReview';
import {colors,spacing,typography} from '@/constants/theme';
export interface SwapDisputeReviewReauthenticationProps {uid:string;sourceKey:string;disabled:boolean;onVerified:()=>void;purpose?:'commercial';parcel?:boolean}
export interface SwapDisputeReviewPanelProps {uid:string;ReauthenticationComponent:ComponentType<SwapDisputeReviewReauthenticationProps>}
const recommendations:Record<SwapDisputeReviewCommand['recommendation'],string>={retain_frozen:'Conserver le gel et documenter la situation',refund_review_required:'Demander un examen distinct du remboursement',payee_release_review_required:'Demander un examen distinct de la libération',physical_resolution_review_required:'Demander un examen distinct des articles et du retour'};
type Form={key:string;recommendation:SwapDisputeReviewCommand['recommendation'];motivation:string;first:string;second:string;examined:boolean};
const emptyForm=(key:string):Form=>({key,recommendation:'retain_frozen',motivation:'',first:'',second:'',examined:false});
export function SwapDisputeReviewPanel({uid,ReauthenticationComponent}:SwapDisputeReviewPanelProps){
 const base=useLabelLifecycleContext('swap-dispute-review',uid),client=useQueryClient(),[selection]=useState(createSwapReviewInteraction);
 const [draft,setDraft]=useState(''),[selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const key=JSON.stringify([uid,getAuthSessionGeneration(),selected,revision,base.focusRevision]);
 const [frame,setFrame]=useState(()=>({key,interaction:createSwapReviewInteraction()}));let liveFrame=frame;
 if(frame.key!==key){frame.interaction.invalidate();liveFrame={key,interaction:createSwapReviewInteraction()};setFrame(liveFrame);}
 const choice=liveFrame.interaction.capture(),selectedChoice=selection.capture();
 const [authenticated,setAuthenticated]=useState<string|null>(null),[unavailable,setUnavailable]=useState<string|null>(null);
 const guardChoice=()=>{base.capture();choice();selectedChoice();};
 const enabled=base.focused&&SWAP_DISPUTE_REVIEW_ENABLED&&selected!==null&&authenticated===key&&unavailable!==key;
 const previewKey=['swap-review-private-preview',key];
 const preview=useQuery({queryKey:previewKey,enabled,staleTime:0,gcTime:0,retry:false,queryFn:()=>{const op=base.capture();return SwapDisputeReviewService.preview(uid,selected!,()=>{base.assertCurrent(op);guardChoice();});}});
 const previewReadable=enabled&&preview.isSuccess&&preview.fetchStatus==='idle'&&!preview.isError&&client.getQueryState(previewKey)?.isInvalidated===false;
 const nativePreview=previewReadable?preview.data:null;
 const historyKey=['swap-review-private-history',key,nativePreview?.source.sourceHash];
 const history=useInfiniteQuery({queryKey:historyKey,enabled:previewReadable,initialPageParam:null as string|null,staleTime:0,gcTime:0,retry:false,queryFn:({pageParam})=>{
  const op=base.capture();return SwapDisputeReviewService.history(uid,selected!,nativePreview!.source.sourceHash,pageParam,()=>{base.assertCurrent(op);guardChoice();const state=client.getQueryState(previewKey);if(!state||state.status!=='success'||state.fetchStatus!=='idle'||state.error!==null||state.isInvalidated||state.data!==preview.data||state.dataUpdatedAt!==preview.dataUpdatedAt)throw new Error('La source actuelle du Troc a changé.');});
 },getNextPageParam:p=>p.nextCursor??undefined});
 const ownKey=['swap-review-sdk-journal',uid,'new-admission',key];
 const own=useQuery({queryKey:ownKey,enabled:base.focused,staleTime:0,gcTime:0,retry:false,queryFn:()=>{const op=base.capture();return SwapDisputeReviewJournal.list(uid,()=>base.assertCurrent(op));}});
 const readable=nativePreview!==null&&history.isSuccess&&history.fetchStatus==='idle'&&!history.isError&&client.getQueryState(historyKey)?.isInvalidated===false;
 const source=readable?nativePreview:null,pages=readable?history.data.pages:[],rows=pages.flatMap(p=>p.entries),ids=rows.map(r=>r.reference.id);
 const coherent=source!==null&&new Set(ids).size===ids.length&&pages.every((p,i)=>p.sourceHash===source.source.sourceHash&&p.cursor===(i===0?null:pages[i-1].nextCursor)&&history.data?.pageParams[i]===p.cursor);
 const historyComplete=readable&&coherent&&!history.hasNextPage&&pages.at(-1)?.nextCursor===null&&rows.every(r=>r.qualification==='native_documentary_entry')&&rows.length===source?.capture.coverage.historyCount&&source.capture.coverage.historyQualified;
 const assertRead=()=>{guardChoice();for(const[qKey,q]of[[previewKey,preview],[historyKey,history]]as const){const s=client.getQueryState(qKey);if(!readable||!coherent||!s||s.status!=='success'||s.fetchStatus!=='idle'||s.error!==null||s.isInvalidated||s.data!==q.data||s.dataUpdatedAt!==q.dataUpdatedAt)throw new Error('Le dossier privé et toutes ses pages doivent être relus.');}};
 const facts=source&&coherent?swapDisputeReviewFacts(source,pages):[],factKey=JSON.stringify([key,preview.dataUpdatedAt,history.dataUpdatedAt,source?.source.sourceHash]);
 const [seen,setSeen]=useState<{key:string;ids:string[]}>({key:'',ids:[]});const seenIds=new Set(seen.key===factKey?seen.ids:[]),allSeen=facts.length>0&&facts.every(f=>seenIds.has(f.id));
 const [form,setForm]=useState<Form>(()=>emptyForm(factKey)),currentForm=form.key===factKey?form:emptyForm(factKey);
 const formKey=JSON.stringify([factKey,currentForm]),[formFrame,setFormFrame]=useState(()=>({key:formKey,interaction:createSwapReviewInteraction()}));let liveForm=formFrame;
 if(formFrame.key!==formKey){formFrame.interaction.invalidate();liveForm={key:formKey,interaction:createSwapReviewInteraction()};setFormFrame(liveForm);}
 const formFence=liveForm.interaction.capture(),lock=useRef(false),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState<{key:string;text:string}|null>(null),[receipt,setReceipt]=useState<{key:string;value:SwapDisputeReviewReceipt}|null>(null);
 const changeForm=(patch:Partial<Omit<Form,'key'>>)=>{try{assertRead();liveForm.interaction.invalidate();setForm({...currentForm,...patch,key:factKey});}catch{/* Changed private source cannot mutate NEW. */}};
 const onSeen=(visible:string[])=>{try{assertRead();const allowed=new Set(facts.map(f=>f.id));setSeen(old=>({key:factKey,ids:[...new Set([...(old.key===factKey?old.ids:[]),...visible.filter(id=>allowed.has(id))])]}));}catch{/* An old viewport never qualifies a new corpus. */}};
 const ownClear=own.isSuccess&&own.fetchStatus==='idle'&&!own.isError&&client.getQueryState(ownKey)?.isInvalidated===false&&own.data.length===0;
 const canRecord=source?.canRecord===true&&historyComplete&&allSeen&&currentForm.examined&&currentForm.motivation.trim().length>0&&currentForm.first.trim().length>0&&currentForm.second.trim().length>0&&source.capture.episode.parties.length===2&&ownClear;
 const submit=async()=>{
  if(lock.current||!canRecord||!source||!selected||!SWAP_DISPUTE_REVIEW_ENABLED)return;let op;try{op=base.start();}catch{return;}if(!op)return;lock.current=true;setBusy(key);setNotice(null);
  const current=()=>{base.assertCurrent(op);assertRead();formFence();const s=client.getQueryState(ownKey);if(!canRecord||!s||s.status!=='success'||s.fetchStatus!=='idle'||s.error!==null||s.isInvalidated||s.data!==own.data||s.dataUpdatedAt!==own.dataUpdatedAt)throw new Error('Le corpus complet, le formulaire et votre journal doivent être requalifiés.');};
  const command:SwapDisputeReviewCommand={action:'record_review',source:source.source,recommendation:currentForm.recommendation,motivation:currentForm.motivation.trim(),partyMessages:[{userId:source.capture.episode.parties[0],message:currentForm.first.trim()},{userId:source.capture.episode.parties[1],message:currentForm.second.trim()}],acknowledged:true};
  try{current();const payloadHash=await productReviewHash(command);current();const attempt:SwapDisputeReviewAttempt={version:1,uid,swapId:selected,requestId:randomUUID(),capability:SWAP_DISPUTE_REVIEW_CAPABILITY,payloadHash,command};
   const r=await SwapDisputeReviewJournal.execute(attempt,current,async()=>{current();const fresh=await SwapDisputeReviewService.preview(uid,selected,current);current();if(!fresh.canRecord||!productReviewEqual(fresh.source,command.source)||!productReviewEqual(fresh.capture,source.capture))throw new Error('La source native du Troc a changé ; cette intention doit rester suivie par son propre reçu.');});
   current();setReceipt({key,value:r});liveFrame.interaction.invalidate();setAuthenticated(null);setRevision(n=>n+1);
  }catch(error){try{current();liveFrame.interaction.invalidate();setUnavailable(key);setNotice({key,text:error instanceof Error?error.message:'Observez la même intention depuis votre journal.'});}catch{/* Superseded NEW callbacks do not clear another form. */}}
  finally{base.finish(op);lock.current=false;void client.invalidateQueries({queryKey:['swap-review-sdk-journal',uid]});if(base.isCurrent(op))setBusy(null);}
 };
 const lookup=()=>{try{guardChoice();selection.invalidate();liveFrame.interaction.invalidate();setAuthenticated(null);setSelected(swapReviewId(draft.trim())?draft.trim():null);setRevision(n=>n+1);setNotice(null);}catch{/* No inactive lookup. */}};
 return <View style={styles.section}><SwapDisputeReviewCommandHistory uid={uid}/><Text style={styles.title}>Revue documentaire d’un litige Troc</Text>
  <Text style={styles.caption}>Consigner une orientation et informer les deux parties. Le litige reste gelé. Ce parcours ne peut ni rembourser, ni libérer les fonds, ni organiser un retour, ni modifier les articles, ni clôturer le litige.</Text>
  <TextInput value={draft} editable={busy!==key} autoCapitalize="none" autoCorrect={false} maxLength={128} placeholder="Identifiant exact du Troc" placeholderTextColor={colors.muted} accessibilityLabel="Identifiant du Troc à examiner" style={styles.input} onChangeText={value=>{try{base.capture();selection.invalidate();liveFrame.interaction.invalidate();setAuthenticated(null);setDraft(value);setSelected(null);setRevision(n=>n+1);}catch{/* Inactive frame. */}}}/>
  <Button variant="secondary" disabled={!base.focused||busy===key||!swapReviewId(draft.trim())} onPress={lookup}>Choisir ce Troc et requalifier l’accès</Button>
  <ReauthenticationComponent uid={uid} sourceKey={`swap-review:${key}`} purpose="commercial" parcel disabled={!base.focused||selected===null||busy===key||!SWAP_DISPUTE_REVIEW_ENABLED} onVerified={()=>{try{guardChoice();setAuthenticated(key);}catch{/* Old verification is inert after a new choice. */}}}/>
  {source&&coherent?<><Text selectable style={styles.caption}>Épisode {source.source.episodeHash} · version {source.source.version} · empreinte {source.source.sourceHash}</Text>
   <Text style={styles.caption}>Historique consultable : {rows.length} / {source.capture.coverage.historyCount}. Les entrées inconnues ou manquantes bloquent toute nouvelle instruction.</Text>
   {history.hasNextPage?<Button variant="secondary" disabled={busy===key} onPress={()=>{try{assertRead();liveForm.interaction.invalidate();void history.fetchNextPage();}catch{/* Stale pagination is refused. */}}}>Lire la page suivante de l’historique</Button>:null}
   <Text style={styles.caption}>Faits et limites réellement affichés : {seenIds.size} / {facts.length}. Parcourez chaque ligne avant de confirmer l’examen. Les montants sont en cents dans la devise affichée ; une devise inconnue reste inconnue. Les témoins enregistrés restent distincts d’un règlement financier.</Text>
   <SwapDisputeReviewFacts key={factKey} facts={facts} onSeen={onSeen}/>
   {(Object.keys(recommendations)as SwapDisputeReviewCommand['recommendation'][]).map(recommendation=><Button key={recommendation} variant="secondary" disabled={busy===key} onPress={()=>changeForm({recommendation,examined:false})}>{currentForm.recommendation===recommendation?'Choix actuel : ':''}{recommendations[recommendation]}</Button>)}
   <TextInput multiline maxLength={4000} editable={busy!==key} value={currentForm.motivation} onChangeText={motivation=>changeForm({motivation,examined:false})} style={styles.input} placeholder="Motivation privée et limites de l’examen" placeholderTextColor={colors.muted} accessibilityLabel="Motivation documentaire privée"/>
   <Text selectable style={styles.caption}>Message à {source.capture.episode.parties[0]??'partie inconnue'}</Text><TextInput multiline maxLength={2000} editable={busy!==key} value={currentForm.first} onChangeText={first=>changeForm({first,examined:false})} style={styles.input} placeholder="Message à la première partie" placeholderTextColor={colors.muted} accessibilityLabel="Message à la première partie du Troc"/>
   <Text selectable style={styles.caption}>Message à {source.capture.episode.parties[1]??'partie inconnue'}</Text><TextInput multiline maxLength={2000} editable={busy!==key} value={currentForm.second} onChangeText={second=>changeForm({second,examined:false})} style={styles.input} placeholder="Message à la deuxième partie" placeholderTextColor={colors.muted} accessibilityLabel="Message à la deuxième partie du Troc"/>
   <Checkbox checked={currentForm.examined} disabled={busy===key||!historyComplete||!allSeen} onToggle={()=>changeForm({examined:!currentForm.examined})}><Text style={styles.caption}>J’ai consulté tous les faits, limites et entrées de toutes les pages de l’historique. Les deux messages correspondent aux parties natives. Cette revue reste documentaire et ne règle ni l’argent ni les articles.</Text></Checkbox>
   {!ownClear?<Text style={styles.caption}>Une intention locale ou un journal non qualifié bloque une nouvelle revue. Observez et terminez explicitement son suivi à partir d’un reçu terminal frais.</Text>:null}
   <Button disabled={busy===key||!canRecord} onPress={()=>void submit()}>Enregistrer cette revue documentaire</Button>
  </>:<Text style={styles.caption}>{preview.isFetching||history.isFetching?'Lecture privée des sources et de l’historique…':preview.isError||history.isError?'Les sources privées sont masquées ; requalifiez l’accès et relisez depuis le début.':'Choisissez un Troc puis confirmez votre identité pour lire ses sources privées.'}</Text>}
  {receipt?.key===key?<SwapDisputeReviewReceiptSummary value={receipt.value}/>:null}{notice?.key===key?<Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text>:null}
  {!SWAP_DISPUTE_REVIEW_ENABLED?<Text style={styles.caption}>Les nouvelles revues documentaires restent fermées pendant la contrelecture. Votre propre journal reste accessible.</Text>:null}
 </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},title:{...typography.body,color:colors.foreground},caption:{...typography.caption,color:colors.muted},input:{...typography.bodySmall,color:colors.foreground,borderWidth:1,borderColor:colors.border,padding:spacing.md}});
