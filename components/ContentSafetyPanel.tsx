import {useLayoutEffect,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {Image} from 'expo-image';
import {randomUUID} from 'expo-crypto';
import {useQuery} from '@tanstack/react-query';
import {Button,Checkbox,Input} from '@/components/ui';
import {ContentSafetyEvidence} from '@/components/ContentSafetyEvidence';
import {colors,radius,spacing,typography} from '@/constants/theme';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {ContentSafetyJournal} from '@/services/contentSafetyJournal';
import {ContentSafetyService} from '@/services/contentSafetyService';
import {staleTradeOperation} from '@/services/tradeOperation';
import {CONTENT_SAFETY_ENABLED,CONTENT_REASON_LABELS,type ContentAttempt,type ContentCommand,type ContentDecisionReference,type ContentReceipt,type ContentSafetyReason,type ContentSafetySelection,type ContentUrgency} from '@/types/contentSafety';
const ACTION_LABELS:Record<ContentCommand['action'],string>={report:'Signalement',contest:'Contestation',maintain:'Contenu maintenu',hide:'Contenu masqué',restore:'Contenu rétabli'};
export function ContentSafetyPanel({scope,selection,readable=true}: {scope:'own'|'admin';selection:ContentSafetySelection|null;readable?:boolean}) {
  const uid=useAuthenticatedUid(),base=useLabelLifecycleContext(JSON.stringify(['content-safety',scope,selection,readable]),uid),epoch=useRef(0);
  const [reason,setReason]=useState<ContentSafetyReason>('review_pressure'),[description,setDescription]=useState(''),[urgency,setUrgency]=useState<ContentUrgency>('unknown');
  const [privateNote,setPrivateNote]=useState(''),[ownerMessage,setOwnerMessage]=useState(''),[action,setAction]=useState<ContentCommand['action']>(scope==='admin'?'maintain':'report');
  const [decision,setDecision]=useState<ContentDecisionReference|null>(null),[confirmation,setConfirmation]=useState<string|null>(null),[local,setLocal]=useState<ContentAttempt|null>(null);
  const [receipt,setReceipt]=useState<ContentReceipt|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[neutralize,setNeutralize]=useState(false),[resume,setResume]=useState(false);
  const [cursor,setCursor]=useState<{lastId:string}|null>(null),[pixels,setPixels]=useState<{hash:string;uri:string}|null>(null);
  const frame=JSON.stringify([base.frame,base.focusRevision]),currentFrame=useRef(frame);
  useLayoutEffect(()=>{currentFrame.current=frame;epoch.current++;},[frame]);
  const [previous,setPrevious]=useState(frame);
  if(previous!==frame){setPrevious(frame);setReason('review_pressure');setDescription('');setUrgency('unknown');setPrivateNote('');setOwnerMessage('');setAction(scope==='admin'?'maintain':'report');setDecision(null);setConfirmation(null);setLocal(null);setReceipt(null);setNotice('');setBusy(false);setNeutralize(false);setResume(false);setCursor(null);setPixels(null);}
  const change=(apply:()=>void)=>{epoch.current++;setConfirmation(null);setPixels(null);setResume(false);setNeutralize(false);apply();};
  const capture=()=>{const op=base.capture(),e=epoch.current;return()=>{base.assertCurrent(op);if(currentFrame.current!==frame||epoch.current!==e)throw staleTradeOperation();};};
  const journal=useQuery({queryKey:['content-safety-journal',uid,scope,frame],enabled:!!uid&&base.focused,staleTime:0,gcTime:0,retry:false,queryFn:()=>ContentSafetyJournal.read(uid!,scope,capture())});
  const ready=journal.isSuccess&&!journal.isFetching&&!journal.isError&&base.focused,pending=ready?journal.data??local:local;
  const selected=selection?{...selection,...(decision?{decisionReference:decision}:{})}:null;
  const preview=useQuery({queryKey:['content-safety-preview',uid,scope,selected,frame],enabled:!!uid&&base.focused&&readable&&CONTENT_SAFETY_ENABLED&&ready&&!pending&&!!selected,
    staleTime:0,gcTime:0,retry:false,queryFn:()=>ContentSafetyService.preview(uid!,scope,selected!,capture())});
  const source=CONTENT_SAFETY_ENABLED&&readable&&base.focused&&preview.isSuccess&&!preview.isFetching&&!preview.isError?preview.data:null;
  const history=useQuery({queryKey:['content-safety-history',uid,scope,selection,cursor,frame],enabled:!!uid&&base.focused&&readable&&CONTENT_SAFETY_ENABLED&&!!selection?.reportId,
    staleTime:0,gcTime:0,retry:false,queryFn:()=>ContentSafetyService.preview(uid!,scope,selection!,capture(),cursor)});
  const page=CONTENT_SAFETY_ENABLED&&readable&&base.focused&&history.isSuccess&&!history.isFetching&&!history.isError?history.data:null;
  const reference=source?.selectedDecision&&['maintain','hide','restore'].includes(source.selectedDecision.entry.action)?source.selectedDecision.entry.reference:null;
  const draft:ContentCommand|null=source&&selected&&source.source.qualification==='native_content'&&source.options.includes(action)&&
    (action!=='contest'||reference)&& (scope!=='admin'||!!privateNote.trim()&&!!ownerMessage.trim())?{targetType:selected.targetType,targetId:selected.targetId,scope,action,reportId:selected.reportId,
      sourceHash:source.source.sourceHash,previewId:source.previewId,reason,description:description.trim()||null,urgency,privateNote:scope==='admin'?privateNote.trim():null,ownerMessage:scope==='admin'?ownerMessage.trim():null,
      decisionReference:action==='contest'?reference:null,acknowledged:true,ratingAloneIsNotRemovalGround:true}:null;
  const draftKey=draft?JSON.stringify(draft):null;
  const run=async(mode:'execute'|'observe'|'neutralize'|'acknowledge')=>{
    if(!uid||!ready||busy)return;let a=pending;
    if(!a){if(mode!=='execute'||!draft||confirmation!==draftKey||!CONTENT_SAFETY_ENABLED||!readable)return;a={version:1,uid,requestId:randomUUID(),command:JSON.parse(JSON.stringify(draft)) as ContentCommand};}
    else if(mode==='execute'&&!resume)return;
    if(mode==='neutralize'&&(!neutralize||receipt?.state!=='unrecorded'))return;
    let op;try{op=base.start();}catch{return;}if(!op)return;const e=++epoch.current,current=()=>{base.assertCurrent(op);if(epoch.current!==e||currentFrame.current!==frame)throw staleTradeOperation();};
    setBusy(true);setNotice('');if(mode==='execute')setLocal(a);
    try{const result=await ContentSafetyJournal[mode](a,current);current();setReceipt(result);setResume(false);setNeutralize(false);
      setNotice(result.state==='committed'?'Demande enregistrée.':result.state==='not_executed'?'La demande n’a pas été effectuée. Consultez son suivi.':'Confirmation en attente. Vérifiez le résultat avant de réessayer.');
      if(mode==='acknowledge')setLocal(null);await journal.refetch();current();
      if(mode==='acknowledge'){setReceipt(null);setConfirmation(null);}
    }catch(error){try{current();setReceipt(null);setNotice(error instanceof Error?error.message:'Résultat à vérifier.');await journal.refetch();}catch{/* Keep exact persisted tuple. */}}
    finally{try{current();setBusy(false);}catch{/* New selection owns UI. */}base.finish(op);}
  };
  const readImage=async()=>{if(!uid||!source||!selected||scope!=='admin'||!readable||busy)return;let current:()=>void;try{current=capture();}catch{return;}setBusy(true);setPixels(null);
    try{const file=await ContentSafetyService.originalFile(uid,selected,source.source.sourceHash,'image',current);current();setPixels({hash:file.sourceHash,uri:`data:${file.contentType};base64,${file.base64}`});}
    catch(error){try{current();setNotice(error instanceof Error?error.message:'Image indisponible.');}catch{/* No stale private pixels. */}}finally{try{current();setBusy(false);}catch{/* New selection owns UI. */}}};
  return <View style={styles.card}>
    <Text style={styles.title}>{scope==='admin'?'Examen du contenu':'Signaler un contenu'}</Text>
    {!CONTENT_SAFETY_ENABLED?<Text style={styles.body}>Les nouveaux signalements sont temporairement indisponibles. Vos demandes existantes restent accessibles.</Text>:null}
    {journal.isError?<><Text style={styles.body}>Impossible de charger votre demande en cours.</Text><Button onPress={()=>{change(()=>undefined);void journal.refetch();}}>Réessayer</Button></>:!ready?<Text style={styles.body}>Chargement du suivi…</Text>:null}
    {pending?<>
      <Text style={styles.title}>Demande en cours</Text>
      <Text style={styles.body}>{ACTION_LABELS[pending.command.action]} · {CONTENT_REASON_LABELS[pending.command.reason]}{'\n'}Urgence : {pending.command.urgency==='yes'?'oui':pending.command.urgency==='no'?'non':'non précisée'}{'\n'}{pending.command.description}{'\n'}{pending.command.ownerMessage}{'\n'}{pending.command.privateNote}</Text>
      <Button variant="secondary" disabled={busy||!ready} onPress={()=>void run('observe')}>Vérifier le résultat</Button>
      <Checkbox checked={resume} disabled={busy} onToggle={()=>change(()=>setResume(!resume))}><Text style={styles.body}>Je souhaite reprendre cette demande avec les détails affichés.</Text></Checkbox>
      <Button disabled={busy||!ready||!resume} onPress={()=>void run('execute')}>Reprendre la demande</Button>
      {receipt?.state==='unrecorded'?<><Checkbox checked={neutralize} disabled={busy} onToggle={()=>change(()=>setNeutralize(!neutralize))}><Text style={styles.body}>Abandonner cette demande si elle n’a pas encore été effectuée. Une décision déjà enregistrée sera conservée.</Text></Checkbox><Button variant="secondary" disabled={busy||!neutralize} onPress={()=>void run('neutralize')}>Confirmer l’abandon</Button></>:receipt?<Button disabled={busy} onPress={()=>void run('acknowledge')}>J’ai pris connaissance du résultat</Button>:null}
    </>:source?<>
      <ContentSafetyEvidence value={source} working={busy} onReadImage={scope==='admin'?()=>void readImage():undefined}/>
      {pixels?.hash===source.source.sourceHash?<Image source={{uri:pixels.uri}} style={styles.image} cachePolicy="none" contentFit="contain" accessibilityLabel="Image du contenu examiné"/>:null}
      {scope==='own'&&source.currentDecision?<Button variant="secondary" disabled={busy} onPress={()=>change(()=>{setDecision(source.currentDecision!.reference);setAction('contest');})}>Contester cette décision</Button>:null}
      {source.options.filter(x=>scope==='admin'||x==='report'||reference&&x==='contest').map(x=><Button key={x} variant="secondary" disabled={busy} onPress={()=>change(()=>setAction(x))}>{action===x?'Choisi : ':''}{{report:'Signaler cet avis',contest:'Contester la décision sélectionnée',maintain:'Maintenir après examen',hide:'Masquer le contenu',restore:'Rétablir l’original'}[x]}</Button>)}
      {(Object.keys(CONTENT_REASON_LABELS) as ContentSafetyReason[]).map(x=><Button key={x} variant="secondary" disabled={busy} onPress={()=>change(()=>setReason(x))}>{reason===x?'Choisi : ':''}{CONTENT_REASON_LABELS[x]}</Button>)}
      <Input label="Décrivez brièvement la situation" value={description} multiline maxLength={1000} editable={!busy} onChangeText={v=>change(()=>setDescription(v))}/>
      {(['unknown','yes','no'] as const).map(x=><Button key={x} variant="secondary" disabled={busy} onPress={()=>change(()=>setUrgency(x))}>{urgency===x?'Choisi : ':''}Urgence : {x==='yes'?'oui':x==='no'?'non':'non précisée'}</Button>)}
      {scope==='admin'?<><Input label="Motivation privée opérateur" multiline maxLength={4000} value={privateNote} editable={!busy} onChangeText={v=>change(()=>setPrivateNote(v))}/><Input label="Motif communiqué aux parties, sans données sensibles" multiline maxLength={2000} value={ownerMessage} editable={!busy} onChangeText={v=>change(()=>setOwnerMessage(v))}/></>:null}
      <Checkbox checked={!!draftKey&&confirmation===draftKey} disabled={busy||!draft} onToggle={()=>{epoch.current++;setConfirmation(confirmation===draftKey?null:draftKey);}}><Text style={styles.body}>Je confirme les détails de cette demande. Une mauvaise note seule ne justifie pas un retrait. Cette action ne décide ni d’un remboursement ni d’une sanction.</Text></Checkbox>
      <Button disabled={busy||!draft||confirmation!==draftKey} onPress={()=>void run('execute')}>Confirmer la demande</Button>
    </>:CONTENT_SAFETY_ENABLED&&readable&&selection?<><Text style={styles.body}>{preview.isFetching?'Chargement du contenu…':'Ce contenu est indisponible pour le moment.'}</Text><Button variant="secondary" disabled={busy||preview.isFetching} onPress={()=>{change(()=>undefined);void preview.refetch();}}>Réessayer</Button></>:null}
    {page?<><Text style={styles.title}>Historique</Text>{page.entries.map((row,i)=>row.qualification==='native_content_entry'?<View key={row.entry.reference.id} style={styles.group}><Text style={styles.body}>{ACTION_LABELS[row.entry.action]} · {row.entry.recordedAt}{'\n'}{row.entry.ownerMessage??''}{'\n'}{row.entry.description??''}{'\n'}{scope==='admin'?row.entry.privateNote:''}</Text>{scope==='own'&&['maintain','hide','restore'].includes(row.entry.action)?<Button variant="secondary" disabled={busy||!!pending} onPress={()=>change(()=>{setDecision(row.entry.reference);setAction('contest');})}>Contester cette décision</Button>:null}</View>:<Text key={`${row.entryId}:${i}`} style={styles.body}>Détail indisponible.</Text>)}{page.nextCursor?<Button variant="secondary" disabled={busy} onPress={()=>change(()=>setCursor(page.nextCursor))}>Charger la suite</Button>:null}</>:null}
    {receipt?<Text style={styles.caption}>{receipt.state==='committed'?'Demande enregistrée':receipt.state==='not_executed'?'Demande non effectuée':'Confirmation en attente'}{receipt.recordedAt?` · ${receipt.recordedAt}`:''}{receipt.mediaWithdrawal.state==='pending'?' · Retrait des médias en cours':receipt.mediaWithdrawal.state==='needs_review'||receipt.mediaWithdrawal.state==='unknown'?' · Retrait des médias à vérifier':receipt.mediaWithdrawal.state==='observed_revoked'?' · Accès aux médias gérés par Seconde retiré':''}</Text>:null}
    {notice?<Text accessibilityRole="alert" style={styles.body}>{notice}</Text>:null}
  </View>;
}
const styles=StyleSheet.create({card:{gap:spacing.md,padding:spacing.md,borderRadius:radius.md,backgroundColor:colors.surfaceWarm},group:{gap:spacing.sm},title:{...typography.h3,color:colors.foreground},body:{...typography.bodySmall,color:colors.foregroundSecondary},caption:{...typography.caption,color:colors.muted},image:{width:'100%',aspectRatio:1,backgroundColor:colors.surface}});
