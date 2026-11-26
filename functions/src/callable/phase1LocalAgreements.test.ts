/** Actual callable handlers + native transaction adapter. Only external I/O
 * (Auth, private control, object promotion and provider clients) is substituted. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FieldPath,FieldValue as NativeFieldValue,GeoPoint,Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {FieldValue as ConfiguredFieldValue} from '../config/firebase';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('../utils/testHelpers/firestoreMock');
  const fs=createFirestoreMock({enforceReadBeforeWrite:true});
  const db=fs.db as any;
  const hooks={beforeRead:null as null|((path:string)=>void),retryOnce:false,retryMutation:null as null|(()=>void),attempts:0};
  db.doc=(path:string)=>{const parts=path.split('/');let ref:any=db.collection(parts[0]).doc(parts[1]);for(let i=2;i<parts.length;i+=2)ref=ref.collection(parts[i]).doc(parts[i+1]);return ref;};
  const original=db.runTransaction.bind(db);
  db.runTransaction=async(fn:any)=>{const retry=hooks.retryOnce;hooks.retryOnce=false;
    for(let attempt=0;;attempt++)try{return await original(async(tx:any)=>{
    hooks.attempts++;
    const persisted=(v:any):any=>v instanceof NativeFieldValue&&v.isEqual(NativeFieldValue.delete())?fs.FieldValue.delete():
      Array.isArray(v)?v.map(persisted):v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype?
        Object.fromEntries(Object.entries(v).map(([k,x])=>[k,persisted(x)])):v;
    for(const method of ['create','set','update']){const write=tx[method].bind(tx);tx[method]=(...a:any[])=>write(a[0],persisted(a[1]),...a.slice(2));}
    const get=tx.get.bind(tx);
    tx.get=async(target:any)=>{if(target.path)hooks.beforeRead?.(target.path);const snap=await get(target);const {Timestamp}=await import('firebase-admin/firestore');
      const withTime=(row:any)=>({...row,updateTime:Timestamp.fromMillis(10000+fs.writeOps.findLastIndex(v=>v.path===row.ref.path))});
      return snap.docs?{...snap,docs:snap.docs.map(withTime)}:snap.exists?withTime(snap):snap;};
    tx.getAll=(...refs:any[])=>Promise.all(refs.map(ref=>tx.get(ref)));
    const result=await fn(tx);if(retry&&attempt===0){hooks.retryMutation?.();throw Error('SYNTHETIC_NATIVE_CONFLICT');}return result;
  });}catch(error){if(!retry||attempt!==0||!(error instanceof Error)||error.message!=='SYNTHETIC_NATIVE_CONFLICT')throw error;}};
  return {fs,db,hooks,evidence:[] as any[],mode:'normal',realRateLimit:false,
    photoMetadataRead:null as null|((path:string)=>void),promotedImages:new Map<string,string>(),authCutoffs:new Map<string,number>(),photoObjects:new Map<string,Record<string,any>>(),provider:vi.fn(()=>{throw Error('provider must not be contacted');})};
});
describe('shared documentary triggers with the real native adapter',()=>{
  const legacy=(path:string)=>{const data={...h.fs.getDoc(path)};delete data.localCatalogueWitness;delete data.localAgreementWitness;
    data.financialRecoveryWitness={protocol:'financial_recovery_source_witness_v1',installationId:'test-old',epoch:'test-old',ref:path,nativeSourceHash:'a'.repeat(64)};h.fs.setDoc(path,data);};
  it.each(['local','legacy-unconfigured','legacy-test'])('projects current owner identity without touching %s stock/proofs',async kind=>{
    const id=await article('alice','projection-'+kind),path='articles/'+id;if(kind!=='local')legacy(path);
    const before=h.fs.getDoc(path)!;
    if(kind==='legacy-test')vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
    h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),displayName:'Current Alice',profileImage:'https://public.invalid/new.jpg',preferences:{privacy:{showProfilePhoto:false}}});
    await (onUserProfileUpdated as any).run({params:{uid:'alice'},data:{before:{data:()=>({displayName:'Old Alice'})},after:{data:()=>({displayName:'Delayed Alice'})}}});
    expect(h.fs.getDoc(path)).toEqual({...before,sellerName:'Current Alice',sellerImage:null});
  });
  it.each(['local','legacy-unconfigured','legacy-test'])('counts live favorites idempotently without touching %s stock/proofs',async kind=>{
    const id=await article('alice','favorite-projection-'+kind),path='articles/'+id;if(kind!=='local')legacy(path);const before=h.fs.getDoc(path)!;
    if(kind==='legacy-test')vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
    h.fs.setDoc('favorites/bob',{articleIds:[id]});
    const event={params:{userId:'bob'},data:{before:{data:()=>undefined},after:{data:()=>({articleIds:[id]})}}};
    await (onArticleFavorited as any).run(event);await (onArticleFavorited as any).run(event);
    expect(h.fs.getDoc(path)).toEqual({...before,favoritesCount:1,likes:1});
    h.fs.setDoc('favorites/bob',{articleIds:[]});await (onArticleFavorited as any).run(event);
    expect(h.fs.getDoc(path)).toEqual({...before,favoritesCount:0,likes:0});
  });
  it.each(['local','legacy-unconfigured','legacy-test'])('commits one documentary swap notice and never rewrites its %s parent',async kind=>{
    const p=await proposal('notice-projection-'+kind),path='swaps/'+p.id;if(kind!=='local')legacy(path);const before=h.fs.getDoc(path)!;
    if(kind==='legacy-test')vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
    const event={id:'projection-native-create',params:{swapId:p.id},data:{data:()=>before,updateTime:Timestamp.now()}};
    await runSwapNotice(onSwapCreated,event);const writes=h.fs.writeOps.length;
    await runSwapNotice(onSwapCreated,event);expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc(path)).toEqual(before);
    expect(h.fs.writeOps.filter(v=>v.path.startsWith(path+'/notice_events/'))).toHaveLength(1);
    expect(h.fs.writeOps.filter(v=>/^(wallets|platform_ledger|ledger)\//.test(v.path))).toHaveLength(0);
  });
  const identityEvent=()=>({params:{uid:'alice'},data:{before:{data:()=>({displayName:'Old Alice'})},after:{data:()=>({displayName:'Delayed Alice'})}}});
  it.each(['stock','financialWitness','catalogueWitness','contract','counter','privacyMarker','fieldPath'])('refuses an injected %s field in the real identity handler before commit',async kind=>{
    const id=await article('alice','identity-attack-'+kind),path='articles/'+id,writes=h.fs.writeOps.length,original=h.db.runTransaction;
    h.db.runTransaction=(fn:any)=>original((tx:any)=>fn(new Proxy(tx,{get(target,key){if(key==='update')return(ref:any,value:any)=>{
      if(ref.path!==path)return target.update(ref,value);
      if(kind==='fieldPath')return target.update(ref,new FieldPath('financialRecoveryWitness'),NativeFieldValue.delete());
      const extra=kind==='stock'?{quantity:2}:kind==='financialWitness'?{financialRecoveryWitness:null}:kind==='catalogueWitness'?{localCatalogueWitness:NativeFieldValue.delete()}:
        kind==='contract'?{saleDeclaration:{forged:true}}:kind==='counter'?{likes:999}:{privacyWithdrawal:null};
      return target.update(ref,{...value,...extra});};return Reflect.get(target,key);}})));
    try{await expect((onUserProfileUpdated as any).run(identityEvent())).rejects.toBeDefined();}finally{h.db.runTransaction=original;}
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('keeps a withdrawn listing pseudonymous while its current owner profile changes',async()=>{
    const id=await article('alice','identity-private');await invoke(withdrawArticlePrivacy,'alice',{articleId:id,requestId:'projection-privacy-12345678',mode:'request'});
    const path='articles/'+id,before=h.fs.getDoc(path)!;
    h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),displayName:'New Alice',profileImage:'https://public.invalid/new.jpg',preferences:{privacy:{showProfilePhoto:true}}});
    await (onUserProfileUpdated as any).run(identityEvent());
    expect(h.fs.getDoc(path)).toEqual({...before,sellerName:'Utilisateur',sellerImage:null});
  });
  it('refuses owner privacy changes between identity callback and native flush',async()=>{
    await article('alice','identity-race');const writes=h.fs.writeOps.length;let reads=0;
    h.hooks.beforeRead=path=>{if(path==='users/alice'&&++reads===2)h.fs.setDoc(path,{...h.fs.getDoc(path),preferences:{privacy:{showProfilePhoto:false}}});};
    await expect((onUserProfileUpdated as any).run(identityEvent())).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('replans identity from the latest private choice on a real native retry',async()=>{
    const id=await article('alice','identity-retry');h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),displayName:'Alice latest',profileImage:'https://public.invalid/image',preferences:{privacy:{showProfilePhoto:true}}});
    h.hooks.retryOnce=true;h.hooks.retryMutation=()=>h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),preferences:{privacy:{showProfilePhoto:false}}});
    await (onUserProfileUpdated as any).run(identityEvent());expect(h.fs.getDoc('articles/'+id)).toMatchObject({sellerName:'Alice latest',sellerImage:null});
  });
  it('projects reviews, deposits and private conversation identity from their current native owner',async()=>{
    const image='https://public.invalid/visible.jpg';h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),displayName:'Current Alice',profileImage:image,preferences:{privacy:{showProfilePhoto:false}}});
    h.fs.setDoc('avis/projection-review',{reviewerId:'alice',reviewerName:'Old',reviewerImage:image,note:5,text:'Frozen review'});
    h.fs.setDoc('swapPartyItems/projection-party',{sellerId:'alice',articleId:'historical-item',sellerName:'Old',sellerImage:image,isPending:true,pendingSwapId:'historical-swap'});
    const bob={userId:'bob',userName:'Bob',userImage:'https://other.invalid/image',role:'unchanged'};
    h.fs.setDoc('chats/projection-chat',{participants:['alice','bob'],participantsInfo:[{userId:'alice',userName:'Old',userImage:null},bob],lastMessage:'Unchanged'});
    await (onUserProfileUpdated as any).run(identityEvent());
    expect(h.fs.getDoc('avis/projection-review')).toMatchObject({reviewerName:'Current Alice',reviewerImage:null,note:5,text:'Frozen review'});
    expect(h.fs.getDoc('swapPartyItems/projection-party')).toMatchObject({sellerName:'Current Alice',sellerImage:null,isPending:true,pendingSwapId:'historical-swap'});
    expect(h.fs.getDoc('chats/projection-chat')).toEqual({participants:['alice','bob'],participantsInfo:[{userId:'alice',userName:'Current Alice',userImage:image},bob],lastMessage:'Unchanged'});
  });
  it.each(['counter','membership','index','stock','witness'])('refuses an injected %s change in the real favorites handler',async kind=>{
    const id=await article('alice','favorite-attack-'+kind),path='articles/'+id,writes=h.fs.writeOps.length,original=h.db.runTransaction;
    h.fs.setDoc('search_index/'+id,{articleId:id,likes:0});
    h.fs.setDoc('favorites/bob',{articleIds:[id]});
    h.db.runTransaction=(fn:any)=>original((tx:any)=>fn(new Proxy(tx,{get(target,key){
      if(key==='update')return(ref:any,value:any)=>target.update(ref,ref.path===path&&kind!=='membership'&&kind!=='index'?{...value,...(kind==='counter'?{likes:999}:kind==='stock'?{isSold:true}:{localCatalogueWitness:null})}:
        ref.path==='search_index/'+id&&kind==='index'?{...value,likes:999}:value);
      if(key==='set')return(ref:any,value:any)=>target.set(ref,kind==='membership'?{...value,counted:false}:value);
      return Reflect.get(target,key);}})));
    try{await expect((onArticleFavorited as any).run({params:{userId:'bob'},data:{before:{data:()=>undefined},after:{data:()=>({articleIds:[id]})}}})).rejects.toBeDefined();}finally{h.db.runTransaction=original;}
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('refuses live favorite source changes and replans a retried unlike without a negative count',async()=>{
    const id=await article('alice','favorite-race'),event={params:{userId:'bob'},data:{before:{data:()=>undefined},after:{data:()=>({articleIds:[id]})}}};
    h.fs.setDoc('favorites/bob',{articleIds:[id]});const writes=h.fs.writeOps.length;let reads=0;
    h.hooks.beforeRead=path=>{if(path==='favorites/bob'&&++reads===2)h.fs.setDoc(path,{articleIds:[]});};
    await expect((onArticleFavorited as any).run(event)).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);
    h.hooks.beforeRead=null;h.fs.setDoc('favorites/bob',{articleIds:[id]});h.hooks.retryOnce=true;h.hooks.retryMutation=()=>h.fs.setDoc('favorites/bob',{articleIds:[]});
    await (onArticleFavorited as any).run(event);expect(h.fs.getDoc('articles/'+id)).toMatchObject({likes:0,favoritesCount:0});
  });
  it.each(['parent','wallet','article','notification','receipt','eventProof'])('refuses an injected %s mutation in the real swap notice handler',async kind=>{
    const p=await proposal('notice-attack-'+kind),path='swaps/'+p.id,after=h.fs.getDoc(path)!,writes=h.fs.writeOps.length,original=h.db.runTransaction;
    h.db.runTransaction=(fn:any)=>original(async(tx:any)=>{
      const guarded=new Proxy(tx,{get(target,key){if(key==='create')return(ref:any,value:any)=>target.create(ref,
        kind==='notification'&&ref.path.startsWith('notifications/')?{...value,userId:'mallory'}:
        kind==='receipt'&&ref.path.startsWith('operational_notice_receipts/')?{...value,payloadHash:'f'.repeat(64)}:
        kind==='eventProof'&&ref.path.includes('/notice_events/')?{...value,sourceHash:'f'.repeat(64)}:value);return Reflect.get(target,key);}});
      const result=await fn(guarded);if(kind==='parent')tx.update(h.db.doc(path),{status:'completed'});if(kind==='wallet')tx.set(h.db.doc('wallets/alice'),{available:999});
      if(kind==='article')tx.update(h.db.doc('articles/'+p.a),{isSold:false});return result;});
    try{await expect(runSwapNotice(onSwapCreated,{id:'notice-attack',params:{swapId:p.id},data:{data:()=>after,updateTime:Timestamp.now()}})).rejects.toBeDefined();}finally{h.db.runTransaction=original;}
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(after);
  });
  it('notifies acceptance, tolerates native retry and preserves deletion on event replay',async()=>{
    const p=await proposal('notice-accept'),path='swaps/'+p.id,before=h.fs.getDoc(path)!;await accept(p.id);const after=h.fs.getDoc(path)!;
    const event={id:'notice-accepted',params:{swapId:p.id},data:{before:{data:()=>before},after:{data:()=>after,updateTime:Timestamp.now()}}};
    h.hooks.retryOnce=true;await runSwapNotice(onSwapStatusUpdated,event);
    const notices=h.fs.writeOps.filter(v=>v.path.startsWith('notifications/'));expect(notices).toHaveLength(2);
    h.fs.setDoc(notices[0].path,null);const writes=h.fs.writeOps.length;await runSwapNotice(onSwapStatusUpdated,event);
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(notices[0].path)).toBeUndefined();expect(h.fs.getDoc(path)).toEqual(after);
  });
  it('projects a first reception to its counterpart while the accepted status remains unchanged',async()=>{
    const p=await proposal('notice-partial'),path='swaps/'+p.id;await accept(p.id);const before=h.fs.getDoc(path)!;
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});const after=h.fs.getDoc(path)!,writes=h.fs.writeOps.length;
    await runSwapNotice(onSwapStatusUpdated,{id:'native-first-reception',params:{swapId:p.id},data:{before:{data:()=>before},after:{data:()=>after,updateTime:Timestamp.now()}}});
    const notices=h.fs.writeOps.slice(writes).filter(v=>v.path.startsWith('notifications/'));
    expect(notices).toHaveLength(1);expect(notices[0].data).toMatchObject({userId:'bob',data:{actorUid:'alice',progressField:'initiatorReceivedAt'}});
    expect(h.fs.getDoc(path)).toEqual(after);
  });
  it('refuses a native parent changed before a notice commit and retries without mutating its current state',async()=>{
    const p=await proposal('notice-source-race'),path='swaps/'+p.id,after=h.fs.getDoc(path)!,event={id:'native-source-race',params:{swapId:p.id},data:{data:()=>after,updateTime:Timestamp.now()}};
    let reads=0;const writes=h.fs.writeOps.length;h.hooks.beforeRead=ref=>{if(ref===path&&++reads===2)h.fs.setDoc(path,{...h.fs.getDoc(path),message:'Concurrent revision'});};
    await expect(runSwapNotice(onSwapCreated,event)).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);
    h.hooks.beforeRead=null;const current=h.fs.getDoc(path);h.hooks.retryOnce=true;await runSwapNotice(onSwapCreated,event);
    expect(h.fs.getDoc(path)).toEqual(current);
  });
  it('preserves a current private withdrawal overlay and refuses its corrupted native evidence',async()=>{
    const p=await proposal('notice-private'),path='swaps/'+p.id,before=h.fs.getDoc(path)!;await accept(p.id);const after=h.fs.getDoc(path)!;
    await invoke(withdrawArticlePrivacy,'alice',{articleId:p.a,requestId:'notice-privacy-12345678',mode:'request'});
    const parent=h.fs.getDoc(path)!,event={params:{swapId:p.id},data:{before:{data:()=>before},after:{data:()=>after,updateTime:Timestamp.now()}}};
    await runSwapNotice(onSwapStatusUpdated,{...event,id:'dated-native-acceptance'});expect(h.fs.getDoc(path)).toEqual(parent);
    const writes=h.fs.writeOps.length,epath='article_privacy_evidence/'+p.a;h.fs.setDoc(epath,{...h.fs.getDoc(epath),ownerId:'bob'});
    await expect(runSwapNotice(onSwapStatusUpdated,{...event,id:'corrupt-evidence-acceptance'})).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each([false,true])('qualifies the expiry producer receipts without duplicating their notices (corrupt=%s)',async corrupt=>{
    const p=await proposal('notice-producer-'+corrupt),path='swaps/'+p.id,before=h.fs.getDoc(path)!;
    vi.stubEnv('SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT','phase1-runtime@seconde-dev.iam.gserviceaccount.com');
    vi.useFakeTimers();vi.setSystemTime(Date.now()+8*86400000);
    try{
      await (expirePhase1LocalProposals as any).run({});const after=h.fs.getDoc(path)!;
      const receipt=h.fs.writeOps.find(v=>v.path.startsWith('operational_notice_receipts/')&&(v.data.data as any)?.swapId===p.id)!;
      expect(receipt).toBeDefined();const sourceAt=receipt.data.committedAt as Timestamp,writes=h.fs.writeOps.length;
      if(corrupt)h.fs.setDoc(receipt.path,{...h.fs.getDoc(receipt.path),payloadHash:'f'.repeat(64)});
      const pending=runSwapNotice(onSwapStatusUpdated,{id:'expiry-producer-event',params:{swapId:p.id},data:{before:{data:()=>before},after:{data:()=>after,updateTime:sourceAt}}});
      if(corrupt){await expect(pending).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);}
      else{await pending;const effects=h.fs.writeOps.slice(writes);expect(effects).toHaveLength(1);expect(effects[0].path).toContain('/notice_events/');expect(effects[0].data.noticeSource).toBe('native_producer_receipts');}
      expect(h.fs.getDoc(path)).toEqual(after);
    }finally{vi.useRealTimers();}
  });
});
describe('phase1 native privacy withdrawal preserves obligations',()=>{
  const withdrawal=(articleId:string,requestId='privacy-request-12345678')=>invoke(withdrawArticlePrivacy,'alice',{articleId,requestId,mode:'request'});
  const privateWrite=<T>(articleId:string,requestId:string,fn:()=>Promise<T>)=>withFinancialRecoveryScope({operation:'callable/articlePrivacy.withdrawArticlePrivacy'},()=>
    withArticlePrivacyScope('alice',articleId,requestId,fn));
  const without=(value:any,key:string)=>Object.fromEntries(Object.entries(value).filter(([k])=>k!==key));
  it('withdraws a reserved cash listing, replays privately and completes the same frozen contract',async()=>{
    const c=await cash('privacy-cash'),path='transactions/'+c.id,apath='articles/'+c.articleId;
    h.fs.setDoc(apath,{...h.fs.getDoc(apath),legacyFreeText:'https://private.invalid/bearer-token'});
    const originalArticle=h.fs.getDoc(apath)!,originalOrder=h.fs.getDoc(path)!,unitId=originalOrder.inventoryUnitCommitment.unitId;
    const unit=h.fs.getDoc('inventory_units/'+unitId)!,writes=h.fs.writeOps.length;
    await withdrawal(c.articleId);
    const hidden=h.fs.getDoc(apath)!;
    expect(hidden).toMatchObject({isActive:false,isSold:true,quantity:1,inventoryUnit:originalArticle.inventoryUnit,
      inventoryAvailability:originalArticle.inventoryAvailability,localCatalogueWitness:{protocol:'local_catalogue_source_v1'}});
    expect(hidden).not.toHaveProperty('legacyFreeText');
    expect(h.fs.getDoc('article_privacy_evidence/'+c.articleId)).toMatchObject({sourceSnapshot:originalArticle});
    expect(without(h.fs.getDoc(path)!,'articlePrivacyWithdrawal')).toEqual(originalOrder);
    expect(h.fs.getDoc('inventory_units/'+unitId)).toEqual(unit);
    expect(h.fs.writeOps.slice(writes).filter(v=>/^(wallets|platform_ledger|ledger|stripe_checkout_intents)\//.test(v.path))).toHaveLength(0);
    await withdrawal(c.articleId);
    expect(h.fs.getDoc('article_privacy_evidence/'+c.articleId)?.sourceSnapshot).toEqual(originalArticle);
    await invoke(confirmMeetupTransaction,'alice',{transactionId:c.id,messageId:c.messageId});
    await invoke(completeMeetupTransaction,'bob',{transactionId:c.id,messageId:c.messageId});
    expect(h.fs.getDoc(path)).toMatchObject({status:'meetup_completed',amount:originalOrder.amount,articleSnapshot:originalOrder.articleSnapshot,
      articlePrivacyWithdrawal:hidden.privacyWithdrawal});
    expect(h.fs.getDoc(apath)).toMatchObject({isActive:false,inventoryAvailability:{state:'consumed'}});
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('withdraws an accepted swap projection and completes its two receptions without changing the agreement',async()=>{
    const p=await proposal('privacy-swap');await accept(p.id);
    const path='swaps/'+p.id,before=h.fs.getDoc(path)!;
    h.fs.setDoc('swapPartyItems/privacy-item',{partyId:'generalist',articleId:p.a,sellerId:'alice',swapId:p.id,isPending:true,
      pendingSwapId:p.id,isSwapped:false,title:'Original',imageUrl:'https://private.invalid/image',sellerName:'Alice',price:25});
    await withdrawal(p.a);
    const hidden=h.fs.getDoc('articles/'+p.a)!;
    expect(without(h.fs.getDoc(path)!,'articlePrivacyWithdrawals')).toEqual(before);
    expect(h.fs.getDoc('swapPartyItems/privacy-item')).toMatchObject({isPending:true,pendingSwapId:p.id,swapId:p.id,imageUrl:null,
      phase1Contract:'phase1_v2',privacyWithdrawal:hidden.privacyWithdrawal});
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});
    expect(h.fs.getDoc(path)).toMatchObject({status:'completed',exchangeAgreement:before.exchangeAgreement,initiatorItems:before.initiatorItems,
      receiverItems:before.receiverItems,articlePrivacyWithdrawals:{[p.a]:hidden.privacyWithdrawal}});
    expect(h.fs.getDoc('articles/'+p.a)).toMatchObject({isActive:false,inventoryAvailability:{state:'consumed'}});
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('redacts an ambiguous paid legacy source while preserving its monetary contract and financial witness',async()=>{
    const now=Timestamp.now(),witness={protocol:'financial_recovery_source_witness_v1',installationId:'old-install',epoch:'old-epoch',ref:'articles/legacy-paid',nativeSourceHash:'a'.repeat(64)};
    const original={sellerId:'alice',title:'Secret',images:[],isSold:true,quantity:2,stock:2,isActive:true,activeTransactionId:'paid-order',soldAt:now,financialRecoveryWitness:witness};
    const order={articleId:'legacy-paid',sellerId:'alice',buyerId:'bob',status:'paid',amount:60,totalAmount:65,stripePaymentIntentId:'pi_old',articleSnapshot:{title:'Frozen'}};
    h.fs.setDoc('articles/legacy-paid',original);h.fs.setDoc('transactions/paid-order',order);
    await withdrawal('legacy-paid');
    expect(h.fs.getDoc('articles/legacy-paid')).toMatchObject({isActive:false,isSold:true,quantity:2,stock:2,activeTransactionId:'paid-order',financialRecoveryWitness:witness});
    expect(h.fs.getDoc('articles/legacy-paid')).not.toHaveProperty('localCatalogueWitness');
    expect(without(h.fs.getDoc('transactions/paid-order')!,'articlePrivacyWithdrawal')).toEqual(order);
    expect(h.fs.getDoc('article_privacy_evidence/legacy-paid')?.sourceSnapshot).toEqual(original);
    expect(h.fs.writeOps.filter(v=>/^(wallets|platform_ledger|ledger)\//.test(v.path))).toHaveLength(0);
  });
  it('creates an exact durable nonexecution receipt for a different later intention',async()=>{
    const c=await cash('privacy-late');await withdrawal(c.articleId);
    const before=h.fs.getDoc('article_privacy_evidence/'+c.articleId),articleBefore=h.fs.getDoc('articles/'+c.articleId);
    const second='privacy-request-late-12345678';await withdrawal(c.articleId,second);
    expect(h.fs.getDoc('article_privacy_evidence/'+c.articleId)).toEqual(before);
    expect(h.fs.getDoc('articles/'+c.articleId)).toEqual(articleBefore);
    expect(h.fs.getDoc('article_privacy_commands/'+articlePrivacyHash(['alice',c.articleId,second]))).toMatchObject({state:'not_executed',noWithdrawalEffectsCommitted:true});
  });
  it.each(['status','amount','contract','wallet','inventory','eraseMarker','rewriteEvidence','unsupportedFieldPath'])('refuses a privacy-scope %s attack before any native write',async kind=>{
    const c=await cash('privacy-attack-'+kind);await withdrawal(c.articleId);
    const path='transactions/'+c.id,opPath='article_privacy_evidence/'+c.articleId,requestId='privacy-request-12345678';
    const before=h.fs.writeOps.length;
    await expect(privateWrite(c.articleId,requestId,()=>h.db.runTransaction((tx:any)=>{
      if(kind==='status')tx.update(h.db.doc(path),{status:'paid'});
      if(kind==='amount')tx.update(h.db.doc(path),{amount:999});
      if(kind==='contract')tx.update(h.db.doc(path),{articleSnapshot:{title:'Forged'}});
      if(kind==='wallet')tx.set(h.db.doc('wallets/alice'),{available:999});
      if(kind==='inventory')tx.update(h.db.doc('inventory_units/'+(h.fs.getDoc(path) as any).inventoryUnitCommitment.unitId),{state:'available',engagement:null});
      if(kind==='eraseMarker')tx.update(h.db.doc(path),{articlePrivacyWithdrawal:NativeFieldValue.delete()});
      if(kind==='rewriteEvidence')tx.update(h.db.doc(opPath),{sourceSnapshot:{sellerId:'alice',title:'Forged'}});
      if(kind==='unsupportedFieldPath')tx.update(h.db.doc(path),new FieldPath('articlePrivacyWithdrawal'),NativeFieldValue.delete());
    }))).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(before);expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(['erase','replace','foreignEvidence'])('refuses %s of a privacy overlay during the ordinary local lifecycle',async kind=>{
    const c=await cash('privacy-marker-'+kind);await withdrawal(c.articleId);
    const path='transactions/'+c.id,before=h.fs.getDoc(path)!,writes=h.fs.writeOps.length;
    if(kind==='foreignEvidence')h.fs.setDoc('article_privacy_evidence/'+c.articleId,{...h.fs.getDoc('article_privacy_evidence/'+c.articleId),ownerId:'bob'});
    await expect(inQualifiedLocalScope('callable/payments/meetup.confirmMeetupTransaction',()=>h.db.runTransaction((tx:any)=>tx.update(h.db.doc(path),
      kind==='erase'?{articlePrivacyWithdrawal:NativeFieldValue.delete()}:kind==='replace'?{articlePrivacyWithdrawal:{...before.articlePrivacyWithdrawal,operationId:'f'.repeat(64)}}:{updatedAt:Timestamp.now()}))))
      .rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each(['articleMarker','articleMergeField','partyMarker','privateEvidence'])('keeps %s immutable outside the dedicated owner withdrawal scope',async kind=>{
    const c=await cash('privacy-closed-'+kind);
    h.fs.setDoc('swapPartyItems/closed-party',{partyId:'generalist',articleId:c.articleId,sellerId:'alice',isPending:true,pendingSwapId:'swap-kept'});
    await withdrawal(c.articleId);
    const writes=h.fs.writeOps.length;
    const operation='callable/products.incrementProductView';
    await expect(withFinancialRecoveryScope({operation},async()=>{await assertFinancialRecoveryEffect('firestore_commit',{refs:['articles/'+c.articleId]});return h.db.runTransaction((tx:any)=>{
      if(kind==='articleMarker')tx.update(h.db.doc('articles/'+c.articleId),{privacyWithdrawal:NativeFieldValue.delete()});
      if(kind==='articleMergeField')tx.set(h.db.doc('articles/'+c.articleId),{privacyWithdrawal:NativeFieldValue.delete()},{mergeFields:['privacyWithdrawal']});
      if(kind==='partyMarker')tx.update(h.db.doc('swapPartyItems/closed-party'),{privacyWithdrawal:NativeFieldValue.delete()});
      if(kind==='privateEvidence')tx.update(h.db.doc('article_privacy_evidence/'+c.articleId),{sourceSnapshot:{sellerId:'alice',title:'Forged'}});
    });})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('rejects a source changed between the handler read and native privacy validation',async()=>{
    const c=await cash('privacy-race'),path='articles/'+c.articleId,writes=h.fs.writeOps.length;let reads=0;
    h.hooks.beforeRead=ref=>{if(ref===path&&++reads===2)h.fs.setDoc(path,{...h.fs.getDoc(path),activeTransactionId:'competing-contract'});};
    await expect(withdrawal(c.articleId)).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc('article_privacy_evidence/'+c.articleId)).toBeUndefined();
  });
  it('replans the private source capture after a native transaction retry',async()=>{
    const c=await cash('privacy-retry'),path='articles/'+c.articleId;
    const writes=h.fs.writeOps.length,attempts=h.hooks.attempts;
    h.hooks.retryOnce=true;h.hooks.retryMutation=()=>h.fs.setDoc(path,{...h.fs.getDoc(path),legacyFreeText:'A concurrent content revision'});
    await withdrawal(c.articleId);
    expect(h.hooks.attempts-attempts).toBeGreaterThan(1);
    expect(h.fs.getDoc('article_privacy_evidence/'+c.articleId)?.sourceSnapshot).toMatchObject({legacyFreeText:'A concurrent content revision'});
    expect(h.fs.writeOps.slice(writes).filter(v=>v.method==='create'&&v.path==='article_privacy_evidence/'+c.articleId)).toHaveLength(1);
    expect(h.fs.getDoc(path)).not.toHaveProperty('legacyFreeText');
  });
});
vi.mock('../config/firebase',async()=>{
  const {Timestamp}=await import('firebase-admin/firestore');
  return {get db(){return h.db;},FieldValue:{...h.fs.FieldValue,serverTimestamp:()=>Timestamp.now(),delete:()=>NativeFieldValue.delete()},
    auth:{getUser:async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(h.authCutoffs.get(uid)??0).toISOString()})},
    storage:{bucket:()=>({name:'seconde-dev.firebasestorage.app',getFiles:async()=>[[],null],file:(path:string)=>({getMetadata:async()=>{
      h.photoMetadataRead?.(path);const value=h.photoObjects.get(path);if(!value)throw Object.assign(Error('Synthetic object absent'),{code:404});return [value];
    },setMetadata:async(patch:any,precondition:any)=>{const value=h.photoObjects.get(path);
      if(!value||String(value.generation)!==precondition.ifGenerationMatch||String(value.metageneration)!==precondition.ifMetagenerationMatch)throw Object.assign(Error('CAS conflict'),{code:412});
      const metadata={...value.metadata};for(const [key,entry]of Object.entries(patch.metadata??{}))if(entry===null)delete metadata[key];else metadata[key]=entry;
      h.photoObjects.set(path,{...value,...patch,metadata,metageneration:String(Number(value.metageneration)+1)});
    }})})}};
});
vi.mock('../config/recoveryControl',async original=>({...await original<typeof import('../config/recoveryControl')>(),
  readFinancialRecoveryControl:async()=>({control:{mode:h.mode,financialEnvironment:'unconfigured',installationId:'local-test',epoch:'local-epoch',
    previousEpoch:null,
    businessAdmission:{protocol:'business_admission_control_v1',state:'open',planId:null}},installation:{prefix:'local-test'},generation:'1',sha256:'a'.repeat(64)}),
  createRecoveryEvidence:async(_path:string,value:any)=>{h.evidence.push(value);}}));
vi.mock('../utils/articleMedia',async original=>({...await original<typeof import('../utils/articleMedia')>(),promoteArticleImages:async(images:any[],_uid:string,articleId:string)=>h.promotedImages.has(articleId)?images.map(image=>({...image,url:h.promotedImages.get(articleId)})):images}));
vi.mock('../services/brands',()=>({matchBrand:async()=>({brandName:null}),BRAND_MATCHING:{autoSelectThreshold:1}}));
vi.mock('../utils/rateLimit',async original=>{const actual=await original<typeof import('../utils/rateLimit')>();return {
  ...actual,checkRateLimit:async(...args:Parameters<typeof actual.checkRateLimit>)=>{if(h.realRateLimit)return actual.checkRateLimit(...args);}};});
vi.mock('../lib/analytics',()=>({captureServerEvent:async()=>{}}));
vi.mock('../utils/profileMediaPrivacy',()=>({synchronizeProfileMediaVisibility:vi.fn()}));
vi.mock('../config/stripe',()=>({getStripe:()=>h.provider()}));
vi.mock('../config/shipEngine',()=>({getShipEngine:()=>h.provider()}));
vi.mock('firebase-functions/logger',()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()}));
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';
import {createArticle,toggleArticleSold} from './products';
import {sendMeetupProposal,rejectMeetupProposal} from './offers';
import {acceptMeetupOffer,confirmMeetupTransaction,completeMeetupTransaction} from './payments/meetup';
import {reportMeetupNoShow} from './payments/meetup';
import {cancelPendingTransaction,sellerCancelTransaction,closeMeetupNoShow} from './payments/disputes';
import {createReview} from './reviews';
import {withdrawArticlePrivacy,readPrivateArticleEvidence} from './articlePrivacy';
import {onUserProfileUpdated} from '../triggers/users';
import {onArticleFavorited} from '../triggers/favorites';
import {onSwapCreated,onSwapStatusUpdated} from '../triggers/swaps';
import {onArticleSold} from '../triggers/articles';
import {submitReport} from './shopModeration';
import {articleReportProjection} from '../utils/reportEvidence';
import {SWAP_DISPUTE_REVIEW_CAPABILITY} from '../utils/swapDisputeReview';
import {withArticlePrivacyScope} from '../utils/localArticlePrivacy';
import {articlePrivacyHash} from '../utils/articlePrivacyContract';
import {readNativeOrderAgreement} from '../utils/privateMedia';
import {meetupThreadId} from '../utils/meetupOffers';
import {expirePhase1LocalProposals,expireStaleProposedSwaps,postAcceptanceStaleSource} from '../scheduled/swaps';
import {expirePhase1LocalOffers,phase1OfferCanExpire} from '../scheduled/phase1Offers';
import {withFinancialRecoveryScope,assertFinancialRecoveryEffect,financialRecoveryNewSourceWitness,assertFinancialRecoverySource} from '../utils/financialRecoveryInterlock';
import {financialRecoverySourceFields,financialRecoverySourceHash,prepareFinancialRecoverySource,prepareFinancialRecoveryNewSource} from '../utils/financialRecoverySources';
import {localServerTimestamps,withLocalAgreementScope,bindLocalAgreementControl,localCashCaseFields} from '../utils/localAgreement';
import * as privateControl from '../config/recoveryControl';
import * as swaps from './swaps';
import {SWAP_AGREEMENT_PROTOCOL} from '../utils/swapLaunchPolicy';
import {SELLER_ACTIVITY_STATEMENT_VERSION,SELLER_ACTIVITY_STATEMENTS,QUEBEC_RESIDENCE_DECLARATION_VERSION,QUEBEC_RESIDENCE_STATEMENT} from '../shared/eligibility';
installFinancialSubjectTransactions(h.db);
const invoke=(fn:any,uid:string,data:any)=>fn.run({auth:{uid,token:{email_verified:true,auth_time:Math.floor(Date.now()/1000)}},data:{...data,expectedUid:uid}});
// These real trigger paths use server-time sentinels in their documentary
// receipts. Concrete per-call clock values would invent distinct commit times.
async function runSwapNotice(handler:any,event:any) {
  const serverTime=vi.spyOn(ConfiguredFieldValue,'serverTimestamp').mockImplementation(()=>NativeFieldValue.serverTimestamp() as any);
  try{return await handler.run(event);}finally{serverTime.mockRestore();}
}

describe('new article reports keep their stock witness under the native adapter',()=>{
  async function capture(attack?:string){
    const id=await article('alice','article-report-native'),path='articles/'+id,before=h.fs.getDoc(path)!,collection=h.db.collection,transaction=h.db.runTransaction;
    h.db.collection=(root:string)=>new Proxy(collection.call(h.db,root),{get(target,key){if(key==='doc')return(id:string)=>{
      const ref=target.doc(id),get=ref.get.bind(ref);ref.get=async()=>{const s=await get();return {...s,updateTime:Timestamp.fromMillis(10000+h.fs.writeOps.findLastIndex(v=>v.path===s.ref.path))};};return ref;};return Reflect.get(target,key);}});
    try{
      const preview=await invoke(submitReport,'bob',{operation:'previewArticleReport',targetId:id,expectedArticle:articleReportProjection(before)});
      const payload={targetType:'article',targetId:id,requestId:'native_report_12345678',reason:'other',description:'Version observée.',
        expectedArticleRevision:preview.articleRevision,expectedArticleContentHash:preview.contentHash,expectedMedia:preview.expectedMedia};
      const writes=h.fs.writeOps.length;
      if(attack)h.db.runTransaction=(fn:any)=>transaction((tx:any)=>fn(new Proxy(tx,{get(target,key){if(key==='update')return(ref:any,value:any)=>
        target.update(ref,ref.path===path?{...value,...(attack==='stock'?{isSold:true}:attack==='witness'?{localCatalogueWitness:null}:{privacyWithdrawal:null})}:value);
        return Reflect.get(target,key);}})));
      if(attack){await expect(invoke(submitReport,'bob',payload)).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(before);return;}
      const receipt=await invoke(submitReport,'bob',payload),after=h.fs.getDoc(path)!;
      expect(receipt.protocol).toBe('article_report_receipt_v1');expect(receipt.conservation).toBe('needs_review');
      expect(after).toEqual({...before,articleReportEvidenceReportIds:[receipt.reportId]});
      expect(after.localCatalogueWitness).toEqual(before.localCatalogueWitness);
      expect(h.fs.getDoc('reports/'+receipt.reportId+'/native_evidence/capture')).toMatchObject({writer:'submitReport_capture_v1',articleId:id,reporterId:'bob'});
      expect((await invoke(submitReport,'bob',payload)).replay).toBe(true);
      expect(h.fs.writeOps.slice(writes).filter(v=>v.path===path)).toHaveLength(1);
    }finally{h.db.collection=collection;h.db.runTransaction=transaction;}
  }
  it('captures the exact native source with immutable report anchor and replays the same intention',()=>capture());
  it.each(['stock','witness','privacy'])('rejects injected %s mutation without partial report/evidence writes',kind=>capture(kind));
});
async function article(owner:string,requestId:string) {
  const result=await invoke(createArticle,owner,{clientRequestId:requestId,quantity:1,title:'Pull en coton',description:'Un pull en coton bleu.',price:25,
    images:[{url:`https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/drafts%2F${owner}%2Fd%2Fa.jpg?alt=media`}],
    categoryIds:['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],condition:'très bon état',
    size:{value:'M',system:'EU'},brand:null,isHandDelivery:true,isShipping:false,neighborhoods:[{id:'n',name:'Plateau',borough:'Montréal'}]});
  return result.articleId as string;
}
async function proposal(requestId='swap-gesture',mode='hand_delivery',topup:any=null) {
  const a=await article('alice','own-'+requestId),b=await article('bob','other-'+requestId);
  const source=await h.db.runTransaction((tx:any)=>swaps.readSwapAgreementPreview(tx,'alice',{operation:'swap_proposal_preview',expectedUid:'alice',
    receiverId:'bob',initiatorArticleIds:[a],receiverArticleIds:[b],exchangeMode:mode,arrangements:'Samedi à Montréal.',message:null,cashTopUp:topup}));
  const input={initiatorId:'alice',initiatorName:'Alice',receiverId:'bob',receiverName:'Bob',initiatorItems:[{articleId:a}],receiverItems:[{articleId:b}],
    exchangeMode:mode,arrangements:'Samedi à Montréal.',message:null,cashTopUp:topup,clientRequestId:requestId,
    agreementProtocol:SWAP_AGREEMENT_PROTOCOL,expectedSourceHash:source.sourceHash};
  const result=await invoke(swaps.proposeMultiSwap,'alice',input);
  return {id:result.swapId as string,a,b,input};
}
async function accept(id:string) {return invoke(swaps.acceptSwap,'bob',{swapId:id,agreementProtocol:SWAP_AGREEMENT_PROTOCOL,
  expectedSourceHash:(h.fs.getDoc('swaps/'+id) as any).exchangeAgreement.sourceHash});}
function postalPhoto(id:string,uid:string,suffix='proof') {
  const path=`swaps/${id}/photos/${uid}/${suffix}.jpg`;
  h.photoObjects.set(path,{contentType:'image/jpeg',size:1024,generation:'11',metageneration:'1',crc32c:'AAAAAA==',cacheControl:'private, no-store',metadata:{}});
  return 'https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media';
}
async function postalReady(suffix:string) {
  const p=await proposal(suffix,'shipping');await accept(p.id);
  const alice=postalPhoto(p.id,'alice'),bob=postalPhoto(p.id,'bob');
  await invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[alice]});
  await invoke(swaps.uploadSwapPhotos,'bob',{swapId:p.id,photoUrls:[bob]});
  return {...p,alice,bob};
}
async function cash(suffix='cash') {
  const id=await article('alice','item-'+suffix),chatId='chat-'+suffix,messageId='offer-'+suffix;
  h.fs.setDoc('chats/'+chatId,{articleId:id,participants:['alice','bob']});
  await invoke(sendMeetupProposal,'bob',{chatId,requestId:messageId,amount:20,location:{toArrange:true}});
  const result=await invoke(acceptMeetupOffer,'alice',{chatId,messageId});
  return {id:result.transactionId as string,articleId:id,chatId,messageId};
}
function nativeAdapterProbe(store:Record<string,any>={}) {
  const calls:{method:string;args:any[]}[]=[];
  const native={get:vi.fn(async(ref:any)=>({exists:store[ref.path]!==undefined,data:()=>store[ref.path]})),
    set:(...args:any[])=>{calls.push({method:'set',args});},update:(...args:any[])=>{calls.push({method:'update',args});},create:(...args:any[])=>{calls.push({method:'create',args});}};
  const database:any={doc:(path:string)=>({path}),collection:(root:string)=>({doc:(id:string)=>({path:`${root}/${id}`})}),runTransaction:(fn:any)=>fn(native)};
  installFinancialSubjectTransactions(database);return {database,native,calls};
}
function inQualifiedLocalScope<T>(operation:string,fn:()=>Promise<T>):Promise<T> {
  return withLocalAgreementScope(operation,async()=>{bindLocalAgreementControl({installationId:'local-test',epoch:'local-epoch'});return fn();});
}
beforeEach(()=>{
  h.fs.reset();h.evidence=[];h.mode='normal';h.realRateLimit=false;h.provider.mockClear();h.photoObjects.clear();h.authCutoffs.clear();h.promotedImages.clear();h.photoMetadataRead=null;
  h.hooks.beforeRead=null;h.hooks.retryOnce=false;h.hooks.retryMutation=null;h.hooks.attempts=0;
  vi.stubEnv('GCLOUD_PROJECT','seconde-dev');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_PROJECT_ID','seconde-dev');
  vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','unconfigured');vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('SHIPPING_ENABLED','false');
  for(const uid of ['alice','bob']) {
    h.fs.setDoc('users/'+uid,{displayName:uid,dateOfBirth:'1990-01-01',isActive:true});
    h.fs.setDoc('eligibility_profiles/'+uid,{version:1,activityDeclaration:{kind:'personal',actorUid:uid,declarationVersion:1,recordedAt:Timestamp.now(),
      statementVersion:SELLER_ACTIVITY_STATEMENT_VERSION,statement:SELLER_ACTIVITY_STATEMENTS.personal},
      quebecResidenceDeclaration:{version:QUEBEC_RESIDENCE_DECLARATION_VERSION,ownerId:uid,actorUid:uid,source:'owner_declaration',accepted:true,country:'CA',province:'QC',
        statement:QUEBEC_RESIDENCE_STATEMENT,residenceVerified:false,recordedAt:Timestamp.now(),recordedAtMs:Date.now()}});
  }
});
afterEach(()=>vi.unstubAllEnvs());
describe('phase1 local agreements without a financial provider',()=>{
  it.each(['cash_accept','swap_propose','swap_accept'])('records one own %s refusal atomically without changing a pending agreement',async kind=>{
    let actor:string,act:()=>Promise<any>,paths:string[];
    if(kind==='cash_accept'){
      const item=await article('alice','refusal-cash'),chatId='refusal-chat';h.fs.setDoc('chats/'+chatId,{articleId:item,participants:['alice','bob']});
      await invoke(sendMeetupProposal,'bob',{chatId,requestId:'refusal-offer',amount:20,location:{toArrange:true}});
      actor='alice';act=()=>invoke(acceptMeetupOffer,'alice',{chatId,messageId:'refusal-offer'});paths=['articles/'+item,'messages/refusal-offer'];
    }else{
      const p=await proposal('refusal-'+kind);actor=kind==='swap_propose'?'alice':'bob';
      act=kind==='swap_propose'?()=>invoke(swaps.proposeMultiSwap,'alice',{...p.input,clientRequestId:'refusal-new-proposal'}):()=>accept(p.id);
      paths=['articles/'+p.a,'articles/'+p.b,'swaps/'+p.id];
    }
    h.fs.setDoc('users/'+actor,{...h.fs.getDoc('users/'+actor),isActive:false});
    const source=paths.map(path=>h.fs.getDoc(path)),writes=h.fs.writeOps.length,error=await act().catch(e=>e);
    expect(error).toMatchObject({code:'permission-denied',details:{reason:'admission_refused',financialEffect:'none',admissionGranted:false}});
    expect(paths.map(path=>h.fs.getDoc(path))).toEqual(source);
    const committed=h.fs.writeOps.slice(writes);expect(committed).toHaveLength(2);
    expect(committed.map(w=>w.path.split('/')[0]).sort()).toEqual(['automatic_decisions_log','rate_limits']);
    const replayWrites=h.fs.writeOps.length,replayed=await act().catch(e=>e);
    expect(replayed.details.decisionId).toBe(error.details.decisionId);expect(h.fs.writeOps).toHaveLength(replayWrites);
  });
  it.each(['foreign_quota','quota_count','decision_owner','stock','contract','notification','revoked','draining','source_changed','quota_source'])
    ('refuses a %s admission-pair attack before any native effect',async attack=>{
      const item=await article('alice','refusal-attack-'+attack),chatId='refusal-attack-chat';
      h.fs.setDoc('chats/'+chatId,{articleId:item,participants:['alice','bob']});
      await invoke(sendMeetupProposal,'bob',{chatId,requestId:'refusal-attack-offer',amount:20,location:{toArrange:true}});
      h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),isActive:false});
      const request={auth:{uid:'alice',token:{auth_time:Math.floor(Date.now()/1000)-10,email_verified:true}},
        data:{expectedUid:'alice',chatId,messageId:'refusal-attack-offer'}},business=h.fs.getDoc('articles/'+item),writes=h.fs.writeOps.length,original=h.db.runTransaction;
      let quota:any;
      h.db.runTransaction=(fn:any)=>original((tx:any)=>fn(new Proxy(tx,{get(target,key){
        if(key==='set')return(ref:any,value:any,...rest:any[])=>{if(ref.path==='rate_limits/alice_admissionRefusals'){
          quota=value;if(attack==='foreign_quota')return target.set(h.db.doc('rate_limits/mallory_admissionRefusals'),value,...rest);
          if(attack==='quota_count')return target.set(ref,{...value,count:999},...rest);}
          return target.set(ref,value,...rest);};
        if(key==='create')return(ref:any,value:any,...rest:any[])=>{
          const result=target.create(ref,attack==='decision_owner'&&ref.path.startsWith('automatic_decisions_log/')?{...value,ownerId:'mallory'}:value,...rest);
          if(ref.path.startsWith('automatic_decisions_log/')){
            if(attack==='stock')target.update(h.db.doc('articles/'+item),{isSold:true});
            if(attack==='contract')target.set(h.db.doc('transactions/forged'),{status:'meetup_completed',buyerId:'bob',sellerId:'alice'});
            if(attack==='notification')target.create(h.db.doc('notifications/forged'),{userId:'alice',title:'forged'});
            if(attack==='revoked')h.authCutoffs.set('alice',Date.now());
            if(attack==='draining')h.mode='draining';
            if(attack==='source_changed')h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),isActive:true});
            if(attack==='quota_source')h.fs.setDoc('rate_limits/alice_admissionRefusals',{...quota,count:quota.count+1});
          }return result;};return Reflect.get(target,key);}})));
      try{await expect((acceptMeetupOffer as any).run(request)).rejects.toBeDefined();}finally{h.db.runTransaction=original;}
      expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc('articles/'+item)).toEqual(business);
      expect(h.fs.getDoc('transactions/forged')).toBeUndefined();expect(h.fs.getDoc('notifications/forged')).toBeUndefined();
    });
  it('replays a committed refusal after quota exhaustion and records a changed admissibility source separately',async()=>{
    const item=await article('alice','refusal-replay-quota'),chatId='refusal-replay-chat';h.fs.setDoc('chats/'+chatId,{articleId:item,participants:['alice','bob']});
    await invoke(sendMeetupProposal,'bob',{chatId,requestId:'refusal-replay-offer',amount:20,location:{toArrange:true}});
    h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),isActive:false});
    const act=()=>invoke(acceptMeetupOffer,'alice',{chatId,messageId:'refusal-replay-offer'}),first=await act().catch(e=>e),quotaPath='rate_limits/alice_admissionRefusals';
    expect(first).toMatchObject({details:{reason:'admission_refused'}});h.fs.setDoc(quotaPath,{...h.fs.getDoc(quotaPath),count:20,dailyCount:100});
    const writes=h.fs.writeOps.length,replay=await act().catch(e=>e);expect(replay.details.decisionId).toBe(first.details.decisionId);expect(h.fs.writeOps).toHaveLength(writes);
    h.fs.setDoc(quotaPath,{...h.fs.getDoc(quotaPath),count:0,dailyCount:0});h.fs.setDoc('users/alice',{...h.fs.getDoc('users/alice'),dateOfBirth:'2020-01-01'});
    const changed=await act().catch(e=>e);expect(changed).toMatchObject({details:{reason:'admission_refused'}});expect(changed.details.decisionId).not.toBe(first.details.decisionId);
    expect(h.fs.writeOps.slice(writes).map(w=>w.path.split('/')[0]).sort()).toEqual(['automatic_decisions_log','rate_limits']);
  });
  it.each(['cash','swap'])('preserves %s reservation favorites and removes them only on native consumption',async kind=>{
    let articleId:string,parentPath:string,before:any,finish:()=>Promise<any>;
    if(kind==='cash'){
      articleId=await article('alice','favorite-cash');h.fs.setDoc('chats/favorite-cash-chat',{articleId,participants:['alice','bob']});
      await invoke(sendMeetupProposal,'bob',{chatId:'favorite-cash-chat',requestId:'favorite-cash-offer',amount:20,location:{toArrange:true}});
      before=h.fs.getDoc('articles/'+articleId);const accepted=await invoke(acceptMeetupOffer,'alice',{chatId:'favorite-cash-chat',messageId:'favorite-cash-offer'});
      parentPath='transactions/'+accepted.transactionId;finish=async()=>{await invoke(confirmMeetupTransaction,'alice',{transactionId:accepted.transactionId,messageId:'favorite-cash-offer'});
        await invoke(completeMeetupTransaction,'bob',{transactionId:accepted.transactionId,messageId:'favorite-cash-offer'});};
    }else{
      const p=await proposal('favorite-swap');articleId=p.a;before=h.fs.getDoc('articles/'+articleId);await accept(p.id);parentPath='swaps/'+p.id;
      finish=async()=>{await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});};
    }
    h.fs.setDoc('favorites/bob',{articleIds:[articleId,'kept-other']});const reserved=h.fs.getDoc('articles/'+articleId)!;
    expect(reserved.inventoryAvailability).toEqual({protocol:'inventory_article_availability_v1',state:'engaged'});
    await (onArticleSold as any).run({id:'favorite-reservation-'+kind,params:{articleId},data:{before:{data:()=>before},after:{data:()=>reserved}}});
    expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual([articleId,'kept-other']);
    await finish();const consumed=h.fs.getDoc('articles/'+articleId)!,contract=h.fs.getDoc(parentPath)!;
    expect(consumed.isSold).toBe(true);expect(consumed.inventoryAvailability).toEqual({protocol:'inventory_article_availability_v1',state:'consumed'});
    const event={id:'favorite-consumption-'+kind,params:{articleId},data:{before:{data:()=>reserved},after:{data:()=>consumed}}};
    await (onArticleSold as any).run(event);expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual(['kept-other']);
    const writes=h.fs.writeOps.length;await (onArticleSold as any).run(event);expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc('articles/'+articleId)).toEqual(consumed);expect(h.fs.getDoc(parentPath)).toEqual(contract);
  });
  it('cleans a qualified manual consumption once and preserves a re-listed article against the delayed old event',async()=>{
    const id=await article('alice','favorite-manual'),path='articles/'+id,before=h.fs.getDoc(path)!;
    const call=(data:any)=>(toggleArticleSold as any).run({auth:{uid:'alice',token:{auth_time:Math.floor(Date.now()/1000),email_verified:true}},data});
    const set=async(sold:boolean,rid:string)=>{const observed=await call({operation:'observe',articleId:id});
      return call({operation:'set',articleId:id,requestId:rid,desiredIsSold:sold,expectedIsSold:observed.isSold,expectedRevision:observed.revision});};
    await set(true,'favorite-manual-sold');const consumed=h.fs.getDoc(path)!;h.fs.setDoc('favorites/bob',{articleIds:[id]});
    const event={id:'manual-favorite-consumed',params:{articleId:id},data:{before:{data:()=>before},after:{data:()=>consumed}}};
    await (onArticleSold as any).run(event);expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual([]);
    await set(false,'favorite-manual-relist');h.fs.setDoc('favorites/bob',{articleIds:[id]});const live=h.fs.getDoc(path)!,writes=h.fs.writeOps.length;
    await (onArticleSold as any).run(event);expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual([id]);expect(h.fs.getDoc(path)).toEqual(live);
  });
  it.each(['missing','malformed','incoherent_unit','unknown_contract'])('preserves favorite preferences with %s stock evidence',async failure=>{
    const c=await cash('favorite-unknown-'+failure);await invoke(confirmMeetupTransaction,'alice',{transactionId:c.id,messageId:c.messageId});
    const before=h.fs.getDoc('articles/'+c.articleId)!;await invoke(completeMeetupTransaction,'bob',{transactionId:c.id,messageId:c.messageId});
    const path='articles/'+c.articleId,after=h.fs.getDoc(path)!;
    if(failure==='missing')delete after.inventoryAvailability;
    if(failure==='malformed')after.inventoryAvailability={protocol:'inventory_article_availability_v1',state:'consumed',authority:'invented'};
    if(failure==='incoherent_unit')after.inventoryAvailability={protocol:'inventory_article_availability_v1',state:'engaged'};
    if(failure==='unknown_contract')h.fs.setDoc('transactions/'+c.id,{...h.fs.getDoc('transactions/'+c.id),status:'unknown'});
    h.fs.setDoc(path,after);h.fs.setDoc('favorites/bob',{articleIds:[c.articleId]});const writes=h.fs.writeOps.length;
    await (onArticleSold as any).run({id:'favorite-unknown-'+failure,params:{articleId:c.articleId},data:{before:{data:()=>({...before,isSold:false})},after:{data:()=>after}}});
    expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual([c.articleId]);expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each(['article','unit','contract'])('rechecks a changed %s source inside favorite removal before writing',async changed=>{
    const c=await cash('favorite-race-'+changed);await invoke(confirmMeetupTransaction,'alice',{transactionId:c.id,messageId:c.messageId});
    const before=h.fs.getDoc('articles/'+c.articleId)!;await invoke(completeMeetupTransaction,'bob',{transactionId:c.id,messageId:c.messageId});
    const path='articles/'+c.articleId,after=h.fs.getDoc(path)!,unit=(h.fs.getDoc('transactions/'+c.id) as any).inventoryUnitCommitment.unitId;
    h.fs.setDoc('favorites/bob',{articleIds:[c.articleId]});const writes=h.fs.writeOps.length;let reads=0;
    const target=changed==='article'?path:changed==='unit'?'inventory_units/'+unit:'transactions/'+c.id,at=changed==='unit'?3:2;
    h.hooks.beforeRead=ref=>{if(ref!==target||++reads!==at)return;
      if(changed==='article')h.fs.setDoc(path,{...after,inventoryAvailability:{protocol:'inventory_article_availability_v1',state:'engaged'}});
      if(changed==='unit')h.fs.setDoc(target,{...h.fs.getDoc(target),state:'engaged'});
      if(changed==='contract')h.fs.setDoc(target,{...h.fs.getDoc(target),status:'meetup_pending'});
    };
    try{await (onArticleSold as any).run({id:'favorite-race-'+changed,params:{articleId:c.articleId},data:{before:{data:()=>before},after:{data:()=>after}}});}
    finally{h.hooks.beforeRead=null;}
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc('favorites/bob')?.articleIds).toEqual([c.articleId]);
  });
  it('labels only a native engaged unit reserved while expiring competing pending proposals once',async()=>{
    const id=await article('alice','favorite-reserved-notice'),path='articles/'+id,before=h.fs.getDoc(path)!;
    h.fs.setDoc('users/charlie',{dateOfBirth:'1990-01-01',isActive:true});
    for(const buyer of ['bob','charlie']){
      const chatId='favorite-notice-'+buyer;h.fs.setDoc('chats/'+chatId,{articleId:id,participants:['alice',buyer]});
      await invoke(sendMeetupProposal,buyer,{chatId,requestId:'favorite-notice-offer-'+buyer,amount:20,location:{toArrange:true}});
    }
    await invoke(acceptMeetupOffer,'alice',{chatId:'favorite-notice-bob',messageId:'favorite-notice-offer-bob'});
    const after=h.fs.getDoc(path)!,event={id:'native-reserved-favorite-notice',params:{articleId:id},data:{before:{data:()=>before},after:{data:()=>after}}};
    await (onArticleSold as any).run(event);expect(h.fs.getDoc('messages/favorite-notice-offer-charlie')?.offer.status).toBe('expired');
    const notices=h.fs.writeOps.filter(w=>w.path.startsWith('messages/')&&w.data?.type==='system');expect(notices).toHaveLength(1);expect(notices[0].data.content).toMatch(/réservé/);
    const writes=h.fs.writeOps.length;await (onArticleSold as any).run(event);expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(after);
  });
  it('admits a member-organised postal swap without opening any platform financial rail',async()=>{
    const p=await proposal('manual-postal-native','shipping');
    await accept(p.id);
    expect(h.fs.getDoc('swaps/'+p.id)).toMatchObject({exchangeMode:'shipping',status:'photos_pending',cashTopUp:null,
      localAgreementWitness:{protocol:'local_agreement_source_v1',financialSettlement:'not_asserted'}});
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.fs.writeOps.filter(op=>/^(wallets|withdrawal_requests|platform_ledger)\//.test(op.path))).toHaveLength(0);
  });
  it('completes the two postal declarations and receptions once, keeping stock and agreed terms bound',async()=>{
    const p=await postalReady('postal-complete'),path='swaps/'+p.id,agreed=h.fs.getDoc(path)!.exchangeAgreement;
    expect(h.fs.getDoc(path)).toMatchObject({status:'shipping',initiatorPhotos:{userId:'alice',isValidated:false},receiverPhotos:{userId:'bob',isValidated:false}});
    await invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id});
    await expect(invoke(swaps.confirmSwapReception,'alice',{swapId:p.id})).rejects.toMatchObject({code:'failed-precondition'});
    await invoke(swaps.confirmSwapShipping,'bob',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});
    const completed=h.fs.getDoc(path)!;
    expect(completed).toMatchObject({status:'completed',cashTopUp:null,exchangeAgreement:agreed,
      localAgreementWitness:{protocol:'local_agreement_source_v1',financialSettlement:'not_asserted'}});
    expect(completed.initiatorShippedAt).toBeInstanceOf(Timestamp);expect(completed.receiverShippedAt).toBeInstanceOf(Timestamp);
    expect(h.fs.getDoc('articles/'+p.a)).toMatchObject({isSold:true});expect(h.fs.getDoc('articles/'+p.b)).toMatchObject({isSold:true});
    const writes=h.fs.writeOps.length;
    await invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[p.alice]});
    await invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(completed);expect(h.provider).not.toHaveBeenCalled();
  });
  it('keeps documentary event producers compatible with every postal progress state',async()=>{
    const p=await proposal('postal-notice-shapes','shipping');await accept(p.id);const path='swaps/'+p.id;
    const steps:[string,()=>Promise<any>,string[]][]=[
      ['alice-photos',()=>invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[postalPhoto(p.id,'alice')]}),['bob']],
      ['bob-photos',()=>invoke(swaps.uploadSwapPhotos,'bob',{swapId:p.id,photoUrls:[postalPhoto(p.id,'bob')]}),['alice','bob']],
      ['alice-sends',()=>invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id}),['bob']],
      ['bob-sends',()=>invoke(swaps.confirmSwapShipping,'bob',{swapId:p.id}),['alice']],
      ['alice-receives',()=>invoke(swaps.confirmSwapReception,'alice',{swapId:p.id}),['bob']],
      ['bob-receives',()=>invoke(swaps.confirmSwapReception,'bob',{swapId:p.id}),['alice','bob']],
    ];
    for(const [name,act,recipients]of steps){
      const before=h.fs.getDoc(path)!;await act();const after=h.fs.getDoc(path)!,writes=h.fs.writeOps.length;
      const event={id:'postal-native-'+name,params:{swapId:p.id},data:{before:{data:()=>before},after:{data:()=>after,updateTime:Timestamp.now()}}};
      await runSwapNotice(onSwapStatusUpdated,event);const committed=h.fs.writeOps.length;
      await runSwapNotice(onSwapStatusUpdated,event);expect(h.fs.writeOps).toHaveLength(committed);
      const notices=h.fs.writeOps.slice(writes).filter(v=>v.path.startsWith('notifications/'));
      expect(notices.map(v=>v.data.userId).sort()).toEqual(recipients.sort());expect(h.fs.getDoc(path)).toEqual(after);
    }
  });
  it('continues a postal swap after public article withdrawal without changing its frozen proof objects',async()=>{
    const p=await postalReady('postal-private-servicing'),path='swaps/'+p.id;
    await invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id});await invoke(swaps.confirmSwapShipping,'bob',{swapId:p.id});
    const before=h.fs.getDoc(path)!,proof=before.initiatorPhotos;
    await invoke(withdrawArticlePrivacy,'alice',{articleId:p.a,requestId:'postal-private-withdrawal-12345678',mode:'request'});expect(h.fs.getDoc(path)?.initiatorPhotos).toEqual(proof);
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});
    expect(h.fs.getDoc(path)).toMatchObject({status:'completed',initiatorPhotos:proof,exchangeAgreement:before.exchangeAgreement});
  });
  it('observes already accepted postal terms without a second preparation or accepting changed terms',async()=>{
    const p=await proposal('postal-terms','shipping');await accept(p.id);const path='swaps/'+p.id,before=h.fs.getDoc(path)!,writes=h.fs.writeOps.length;
    const data={swapId:p.id,exchangeMode:'shipping',arrangements:'Samedi à Montréal.',agreementProtocol:SWAP_AGREEMENT_PROTOCOL,
      expectedSourceHash:before.exchangeAgreement.sourceHash};
    await expect(invoke(swaps.setSwapExchangeMode,'alice',data)).resolves.toMatchObject({success:true,status:'photos_pending',waitingForCounterpart:false});
    for(const changed of [{...data,arrangements:'Autres conditions.'},{...data,expectedSourceHash:'f'.repeat(64)},{...data,exchangeMode:'hand_delivery'}])
      await expect(invoke(swaps.setSwapExchangeMode,'alice',changed)).rejects.toMatchObject({code:'failed-precondition'});
    await expect(invoke(swaps.setSwapExchangeMode,'charlie',data)).rejects.toMatchObject({code:'permission-denied'});
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(before);
  });
  it.each(['photo_witness','photo_finance','sending_counterpart','sending_wallet'])('rejects an injected %s mutation at the native checkpoint',async attack=>{
    const sending=attack.startsWith('sending'),p=sending?await postalReady('postal-inject-'+attack):await proposal('postal-inject-'+attack,'shipping');
    if(!sending)await accept(p.id);
    const path='swaps/'+p.id,before=h.fs.getDoc(path),writes=h.fs.writeOps.length,original=h.db.runTransaction;
    h.db.runTransaction=(fn:any)=>original((tx:any)=>fn(new Proxy(tx,{get(target,key){
      if(key==='update')return(ref:any,value:any)=>{
        if(ref.path!==path)return target.update(ref,value);
        if(attack==='sending_wallet')target.set(h.db.collection('wallets').doc('charlie'),{balance:500});
        const forged=attack==='photo_witness'?{localAgreementWitness:NativeFieldValue.delete()}:
          attack==='photo_finance'?{cashTopUp:{amount:500,payerId:'alice'}}:attack==='sending_counterpart'?{receiverShippedAt:Timestamp.now()}:{};
        return target.update(ref,{...value,...forged});
      };
      return Reflect.get(target,key);
    }})));
    try {
      const operation=sending?invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id}):
        invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[postalPhoto(p.id,'alice')]});
      await expect(operation).rejects.toBeDefined();
    }finally{h.db.runTransaction=original;}
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(before);expect(h.fs.getDoc('wallets/charlie')).toBeUndefined();
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('does not normalize Storage metadata or replay an unqualified source while the local control is closed',async()=>{
    const p=await proposal('postal-storage-control','shipping');await accept(p.id);
    const url=postalPhoto(p.id,'alice'),objectPath=decodeURIComponent(new URL(url).pathname.split('/o/')[1]),metadata=h.photoObjects.get(objectPath)!;
    metadata.cacheControl='public';metadata.metadata.firebaseStorageDownloadTokens='synthetic';h.mode='draining';const writes=h.fs.writeOps.length;
    await expect(invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[url]})).rejects.toBeDefined();
    expect(h.photoObjects.get(objectPath)).toEqual(metadata);expect(metadata.metadata.firebaseStorageDownloadTokens).toBe('synthetic');expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each(['missing','mime','size','other_owner'])('refuses a %s postal photo before any native write',async kind=>{
    const p=await proposal('postal-photo-'+kind,'shipping');await accept(p.id);
    const url=postalPhoto(p.id,kind==='other_owner'?'bob':'alice'),objectPath=decodeURIComponent(new URL(url).pathname.split('/o/')[1]);
    if(kind==='missing')h.photoObjects.delete(objectPath);
    if(kind==='mime')h.photoObjects.set(objectPath,{contentType:'application/pdf',size:100});
    if(kind==='size')h.photoObjects.set(objectPath,{contentType:'image/jpeg',size:10*1024*1024});
    const writes=h.fs.writeOps.length,before=h.fs.getDoc('swaps/'+p.id);
    await expect(invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[url]})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc('swaps/'+p.id)).toEqual(before);expect(h.provider).not.toHaveBeenCalled();
  });
  it('refuses a third participant and an early sending declaration, and never replaces an existing photo proof',async()=>{
    const p=await proposal('postal-roles','shipping');await accept(p.id);const alice=postalPhoto(p.id,'alice');
    let writes=h.fs.writeOps.length;
    await expect(invoke(swaps.uploadSwapPhotos,'charlie',{swapId:p.id,photoUrls:[alice]})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id})).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.fs.writeOps).toHaveLength(writes);
    await invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[alice]});writes=h.fs.writeOps.length;
    await expect(invoke(swaps.uploadSwapPhotos,'alice',{swapId:p.id,photoUrls:[postalPhoto(p.id,'alice','replacement')]})).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each(['missing_witness','paid_marker','control_draining'])('refuses %s before a postal sending declaration',async kind=>{
    const p=await postalReady('postal-guard-'+kind),path='swaps/'+p.id;
    if(kind==='missing_witness'){const value={...h.fs.getDoc(path)};delete value.localAgreementWitness;h.fs.setDoc(path,value);}
    if(kind==='paid_marker')h.fs.setDoc(path,{...h.fs.getDoc(path),topUpPaymentIntentId:'pi_unqualified'});
    if(kind==='control_draining')h.mode='draining';
    const writes=h.fs.writeOps.length,before=h.fs.getDoc(path);
    await expect(invoke(swaps.confirmSwapShipping,'alice',{swapId:p.id})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(before);expect(h.provider).not.toHaveBeenCalled();
  });
  it('freezes a native local swap once and records only a source-bound documentary admin review',async()=>{
    const p=await proposal('native-dispute');await accept(p.id);const path='swaps/'+p.id,before=h.fs.getDoc(path)!;
    await invoke(swaps.openSwapDispute,'alice',{swapId:p.id,reason:'Les articles remis nécessitent une revue.'});
    const frozen=h.fs.getDoc(path)!,stable=(v:any)=>Object.fromEntries(Object.entries(v).filter(([k])=>!['status','statusBeforeDispute','disputeReason','disputeOpenedBy','disputeOpenedAt','updatedAt','localAgreementWitness'].includes(k)));
    expect(frozen).toMatchObject({status:'disputed',statusBeforeDispute:'accepted',disputeOpenedBy:'alice'});expect(stable(frozen)).toEqual(stable(before));
    const writes=h.fs.writeOps.length;await invoke(swaps.openSwapDispute,'alice',{swapId:p.id,reason:'Les articles remis nécessitent une revue.'});expect(h.fs.writeOps).toHaveLength(writes);
    h.fs.setDoc('users/admin',{isAdmin:true,isActive:true});
    const base={swapDisputeCapability:SWAP_DISPUTE_REVIEW_CAPABILITY,expectedAdminUid:'admin',swapId:p.id},preview=await invoke(swaps.resolveSwapDispute,'admin',{...base,mode:'preview'});
    expect(preview.canRecord).toBe(true);
    const command={action:'record_review',source:preview.source,recommendation:'retain_frozen',motivation:'Les versions doivent être examinées sans déplacer argent ni stock.',
      partyMessages:[{userId:'alice',message:'Votre signalement est conservé.'},{userId:'bob',message:'Le signalement est en cours de revue.'}],acknowledged:true},
      input={...base,requestId:'documentary_request_12345678',command};
    const receipt=await invoke(swaps.resolveSwapDispute,'admin',{...input,mode:'execute'});
    expect(receipt).toMatchObject({state:'committed',documentaryOnly:true,financialEffectAuthorized:false,stockEffectAuthorized:false,disputeClosed:false});
    expect(h.fs.getDoc(path)).toEqual(frozen);const n=h.fs.writeOps.length;
    expect(await invoke(swaps.resolveSwapDispute,'admin',{...input,mode:'observe'})).toEqual(receipt);expect(h.fs.writeOps).toHaveLength(n);
    expect(h.fs.writeOps.filter(v=>v.path.startsWith('wallets/'))).toHaveLength(0);expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(['missing-witness','paid-marker','other-actor','counterparty-fence'])('refuses local dispute %s without native contract or stock effects',async kind=>{
    const p=await proposal('dispute-refusal-'+kind);await accept(p.id);const path='swaps/'+p.id,value={...h.fs.getDoc(path)};
    if(kind==='missing-witness')delete value.localAgreementWitness;if(kind==='paid-marker')value.financialRecoveryWitness=null;h.fs.setDoc(path,value);
    if(kind==='counterparty-fence')h.fs.setDoc('eligibility_profiles/bob',{...h.fs.getDoc('eligibility_profiles/bob'),accountErasureFence:null});
    const writes=h.fs.writeOps.length;
    await expect(invoke(swaps.openSwapDispute,kind==='other-actor'?'mallory':'alice',{swapId:p.id,reason:'Version à examiner.'})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.fs.getDoc(path)).toEqual(value);
  });
  it.each(['parent','wallet','stock','notice','entry','source-race'])('refuses documentary review %s tampering before any partial commit',async kind=>{
    const p=await proposal('review-attack-'+kind);await accept(p.id);await invoke(swaps.openSwapDispute,'alice',{swapId:p.id,reason:'Versions à examiner.'});
    h.fs.setDoc('users/admin',{isAdmin:true,isActive:true});
    const base={swapDisputeCapability:SWAP_DISPUTE_REVIEW_CAPABILITY,expectedAdminUid:'admin',swapId:p.id},preview=await invoke(swaps.resolveSwapDispute,'admin',{...base,mode:'preview'}),
      command={action:'record_review',source:preview.source,recommendation:'retain_frozen',motivation:'Revue documentaire sans autorisation financière ou de stock.',
        partyMessages:[{userId:'alice',message:'Revue en cours.'},{userId:'bob',message:'Revue en cours.'}],acknowledged:true},
      writes=h.fs.writeOps.length,original=h.db.runTransaction,parent=h.fs.getDoc('swaps/'+p.id);
    if(kind==='source-race'){let reads=0;h.hooks.beforeRead=path=>{if(path==='swaps/'+p.id&&++reads===2)h.fs.setDoc(path,{...parent,disputeReason:'Une nouvelle version concurrente.'});};}
    else h.db.runTransaction=(fn:any)=>original(async(tx:any)=>{let captured=false;const guarded=new Proxy(tx,{get(target,key){if(key==='create')return(ref:any,v:any)=>{
      if(ref.path.includes('/dispute_review_entries/'))captured=true;
      return target.create(ref,kind==='entry'&&ref.path.includes('/dispute_review_entries/')?{...v,stockEffectAuthorized:true}:
        kind==='notice'&&ref.path.startsWith('notifications/')?{...v,userId:'mallory'}:v);};return Reflect.get(target,key);}});
      const result=await fn(guarded);if(captured){if(kind==='parent')tx.update(h.db.doc('swaps/'+p.id),{status:'completed'});
        if(kind==='wallet')tx.set(h.db.doc('wallets/alice'),{balance:999});if(kind==='stock')tx.update(h.db.doc('articles/'+p.a),{isSold:false});}return result;});
    try{await expect(invoke(swaps.resolveSwapDispute,'admin',{...base,mode:'execute',requestId:'tampered_review_12345678',command})).rejects.toBeDefined();}
    finally{h.db.runTransaction=original;h.hooks.beforeRead=null;}expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc('wallets/alice')).toBeUndefined();if(kind!=='source-race')expect(h.fs.getDoc('swaps/'+p.id)).toEqual(parent);
  });
  it('keeps every local-witness presence outside the ordinary post-acceptance monitor',()=>{
    const observed=Timestamp.now(),old=Timestamp.fromMillis(observed.toMillis()-15*86400000),cutoff=Timestamp.fromMillis(observed.toMillis()-14*86400000);
    const snap=(extra:object={})=>({id:'partition-source',exists:true,updateTime:old,data:()=>({status:'accepted',updatedAt:old,...extra})} as unknown as FirebaseFirestore.DocumentSnapshot);
    expect(postAcceptanceStaleSource(snap(),snap(),cutoff,observed)).toBe('qualified');
    for(const value of [null,{},undefined,{protocol:'local_agreement_source_v1'}]){
      expect(postAcceptanceStaleSource(snap({localAgreementWitness:value}),snap(),cutoff,observed)).toBe('changed');
      expect(postAcceptanceStaleSource(snap(),snap({localAgreementWitness:value}),cutoff,observed)).toBe('changed');
    }
  });

  it('pins local acceptance of a historical offer to its own installation and epoch',async()=>{
    const aid=await article('alice','historical-offer-acceptance');
    h.fs.setDoc('chats/historical-offer-chat',{articleId:aid,participants:['alice','bob']});
    await invoke(sendMeetupProposal,'bob',{chatId:'historical-offer-chat',requestId:'historical-offer',amount:20,location:{toArrange:true}});
    const {phase1Contract:_contract,phase1Source:_origin,...historical}=h.fs.getDoc('messages/historical-offer') as any;
    h.fs.setDoc('messages/historical-offer',historical);
    await invoke(acceptMeetupOffer,'alice',{chatId:'historical-offer-chat',messageId:'historical-offer'});
    expect(h.fs.getDoc('messages/historical-offer')).toMatchObject({phase1Contract:'phase1_v2',
      phase1Source:{protocol:'phase1_message_origin_v1',installationId:'local-test',epoch:'local-epoch'},offer:{status:'accepted'}});
    expect(h.provider).not.toHaveBeenCalled();
  });

  it('expires only never-accepted native offers with an exact producer receipt and epoch',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    try {
      const aid=await article('alice','offer-expiry-item');h.fs.setDoc('chats/offer-expiry-chat',{articleId:aid,participants:['alice','bob']});
      for(const suffix of ['eligible','foreign','receipt','accepted'])await invoke(sendMeetupProposal,'bob',{
        chatId:'offer-expiry-chat',requestId:'expiry-'+suffix,amount:20+['eligible','foreign','receipt','accepted'].indexOf(suffix),location:{toArrange:true}});
      for(const suffix of ['eligible','foreign','receipt']) {
        const path='messages/expiry-'+suffix,value=h.fs.getDoc(path) as any;
        h.fs.setDoc(path,{...value,offer:{...value.offer,status:'pending',expiresAt:Timestamp.fromDate(value.offer.expiresAt)}});
      }
      const foreign=h.fs.getDoc('messages/expiry-foreign') as any;
      h.fs.setDoc('messages/expiry-foreign',{...foreign,phase1Source:{...foreign.phase1Source,epoch:'other-epoch'}});
      const accepted=h.fs.getDoc('messages/expiry-accepted') as any;
      h.fs.setDoc('messages/expiry-accepted',{...accepted,offer:{...accepted.offer,status:'accepted',acceptedAt:Timestamp.now()}});
      h.fs.setDoc('meetup_offer_requests/expiry-receipt',{...h.fs.getDoc('meetup_offer_requests/expiry-receipt'),inputHash:'bad'});
      const eligible=h.fs.getDoc('messages/expiry-eligible') as any,receipt=h.fs.getDoc('meetup_offer_requests/expiry-eligible') as any;
      vi.setSystemTime(Date.now()+49*3600000);
      expect(phase1OfferCanExpire('expiry-eligible',eligible,receipt,{installationId:'local-test',epoch:'local-epoch'},Timestamp.now())).toBe(true);
      for(const patch of [{offer:{...eligible.offer,acceptedAt:null}},{offer:{...eligible.offer,transactionId:null}},
        {timestamp:new Date()},{phase1Source:null},{participants:['bob','bob']}])
        expect(phase1OfferCanExpire('expiry-eligible',{...eligible,...patch},receipt,{installationId:'local-test',epoch:'local-epoch'},Timestamp.now())).toBe(false);
      h.mode='draining';const writes=h.fs.writeOps.length;await (expirePhase1LocalOffers as any).run({});expect(h.fs.writeOps).toHaveLength(writes);
      h.mode='normal';await (expirePhase1LocalOffers as any).run({});
      expect((h.fs.getDoc('messages/expiry-eligible') as any).offer.status).toBe('expired');
      for(const suffix of ['foreign','receipt'])expect((h.fs.getDoc('messages/expiry-'+suffix) as any).offer.status).toBe('pending');
      expect((h.fs.getDoc('messages/expiry-accepted') as any).offer.status).toBe('accepted');expect(h.provider).not.toHaveBeenCalled();
    }finally {vi.useRealTimers();}
  });

  it('proposes, accepts, confirms and completes a cash meetup without a wallet or financial witness',async()=>{
    const id=await article('alice','cash-item');
    h.fs.setDoc('chats/chat',{articleId:id,participants:['alice','bob']});
    const input={chatId:'chat',requestId:'offer-1',amount:20,location:{toArrange:true}};
    await invoke(sendMeetupProposal,'bob',input);
    const result=await invoke(acceptMeetupOffer,'alice',{chatId:'chat',messageId:'offer-1'});
    const orderId=result.transactionId;
    expect(h.fs.getDoc('transactions/'+orderId)).toMatchObject({paidVia:'cash',shippingCost:0,serviceFee:0,localAgreementWitness:{protocol:'local_agreement_source_v1'}});
    await invoke(confirmMeetupTransaction,'alice',{transactionId:orderId,messageId:'offer-1'});
    await invoke(completeMeetupTransaction,'bob',{transactionId:orderId,messageId:'offer-1'});
    const writes=h.fs.writeOps.length;
    await invoke(completeMeetupTransaction,'bob',{transactionId:orderId,messageId:'offer-1'});
    expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc('transactions/'+orderId)).toMatchObject({status:'meetup_completed'});
    expect(h.fs.getDoc('transactions/'+orderId)).not.toHaveProperty('financialRecoveryWitness');
    expect(h.fs.writeOps.filter(v=>/^(wallets|platform_ledger|stripe_checkout_intents)\//.test(v.path))).toHaveLength(0);
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('bootstraps and reads the generalist zone under actual local control without resetting counters',async()=>{
    h.fs.setDoc('swapParties/generalist',null);
    expect(await invoke(swaps.ensureGeneralistZone,'alice',{})).toEqual({id:'generalist'});
    h.fs.setDoc('swapParties/generalist',{...h.fs.getDoc('swapParties/generalist'),itemsCount:7,swapsCount:3});
    await invoke(swaps.ensureGeneralistZone,'alice',{});
    expect(await invoke(swaps.getActiveSwapPartyInfo,'alice',{})).toMatchObject({hasActiveParty:true,party:{id:'generalist',itemsCount:7,swapsCount:3}});
    h.fs.setDoc('swapParties/generalist',null);expect(await invoke(swaps.getActiveSwapPartyInfo,'alice',{})).toMatchObject({hasActiveParty:true});
    h.mode='draining';const writes=h.fs.writeOps.length;await expect(invoke(swaps.ensureGeneralistZone,'alice',{})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.provider).not.toHaveBeenCalled();
  });
  it('runs the REAL independent quota before local admission through meetup and swap lifecycles',async()=>{
    h.realRateLimit=true;
    const c=await cash('real-quota');await invoke(confirmMeetupTransaction,'alice',{transactionId:c.id,messageId:c.messageId});
    await invoke(completeMeetupTransaction,'bob',{transactionId:c.id,messageId:c.messageId});
    expect(h.fs.getDoc('transactions/'+c.id)?.status).toBe('meetup_completed');
    const p=await proposal('real-quota-swap');await accept(p.id);await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});await invoke(swaps.rateSwap,'alice',{swapId:p.id,score:5,comment:'Très bien'});
    expect(h.fs.getDoc('swaps/'+p.id)?.status).toBe('completed');
    expect(h.fs.writeOps.filter(v=>v.path.startsWith('rate_limits/')).length).toBeGreaterThan(3);expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(['wallet','article','quota-value'])('refuses an injected %s write inside the independent quota transaction',async kind=>{
    h.realRateLimit=true;const aid=await article('alice','quota-attack-'+kind);h.fs.setDoc('chats/quota-attack',{articleId:aid,participants:['alice','bob']});
    const original=h.db.runTransaction,writes=h.fs.writeOps.length;
    h.db.runTransaction=(fn:any)=>original(async(tx:any)=>{const result=await fn(new Proxy(tx,{get(target,key){if(key==='set')return(ref:any,value:any)=>
      target.set(ref,kind==='quota-value'&&ref.path.startsWith('rate_limits/')?{...value,count:999}:value);return Reflect.get(target,key);}}));
      if(kind==='wallet')tx.set(h.db.doc('wallets/bob'),{balance:999});if(kind==='article')tx.update(h.db.doc('articles/'+aid),{isSold:true});return result;});
    try{await expect(invoke(sendMeetupProposal,'bob',{chatId:'quota-attack',requestId:'quota-request',amount:20,location:{toArrange:true}})).rejects.toBeDefined();}
    finally{h.db.runTransaction=original;}expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('completes and rates a zero-top-up meetup swap through two distinct receptions',async()=>{
    const p=await proposal();await accept(p.id);
    await invoke(swaps.confirmSwapReception,'alice',{swapId:p.id});
    await invoke(swaps.confirmSwapReception,'bob',{swapId:p.id});
    await invoke(swaps.rateSwap,'alice',{swapId:p.id,score:5,comment:'Très bien'});
    expect(h.fs.getDoc('swaps/'+p.id)).toMatchObject({status:'completed',cashTopUp:null,localAgreementWitness:{protocol:'local_agreement_source_v1'}});
    expect(h.fs.getDoc('swaps/'+p.id)).not.toHaveProperty('financialRecoveryWitness');
    expect(h.fs.getDoc('articles/'+p.a)).toMatchObject({isActive:false});
    expect(h.fs.getDoc('articles/'+p.b)).toMatchObject({isActive:false});
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('keeps pending rejection and swap cancellation idempotent',async()=>{
    const p=await proposal('cancel');await invoke(swaps.cancelSwap,'alice',{swapId:p.id});
    await invoke(swaps.cancelSwap,'alice',{swapId:p.id});
    const id=await article('alice','reject-item');h.fs.setDoc('chats/chat',{articleId:id,participants:['alice','bob']});
    await invoke(sendMeetupProposal,'bob',{chatId:'chat',requestId:'reject-offer',amount:20,location:{toArrange:true}});
    await invoke(rejectMeetupProposal,'alice',{chatId:'chat',messageId:'reject-offer'});
    expect(h.fs.getDoc('messages/reject-offer')).toMatchObject({offer:{status:'rejected'}});
  });
  it.each(['alice','bob'])('cancels the exact cash reservation as %s without a refund or provider call',async uid=>{
    const c=await cash(uid);await invoke(cancelPendingTransaction,uid,{transactionId:c.id});
    const writes=h.fs.writeOps.length;await invoke(cancelPendingTransaction,uid,{transactionId:c.id});expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc('transactions/'+c.id)).toMatchObject({status:'cancelled',localCancellation:{moneyMoved:false,platformMoneyObligationCents:0}});
    expect(h.fs.getDoc('articles/'+c.articleId)).toMatchObject({isSold:false});expect(h.provider).not.toHaveBeenCalled();
  });
  it('supports the seller cancellation entry and a review after a completed local purchase',async()=>{
    const c=await cash('seller');await invoke(sellerCancelTransaction,'alice',{transactionId:c.id});
    const d=await cash('review');await invoke(confirmMeetupTransaction,'alice',{transactionId:d.id,messageId:d.messageId});
    await invoke(completeMeetupTransaction,'bob',{transactionId:d.id,messageId:d.messageId});
    await invoke(createReview,'bob',{transactionId:d.id,targetUserId:'alice',transactionType:'achat',note:5,text:'Une belle rencontre',articleId:d.articleId});
    expect(h.fs.getDoc('avis/bob_'+d.id)).toMatchObject({note:5});
  });
  it('records absence, counter-narrative and the operator decision without restoring the released reservation',async()=>{
    const c=await cash('absence');
    const report=await invoke(reportMeetupNoShow,'bob',{transactionId:c.id,reason:'other_party_no_show',details:'Personne au rendez-vous.'});
    expect(report.reservationReleased).toBe(true);const disputeId=report.disputeId;
    await invoke(reportMeetupNoShow,'alice',{transactionId:c.id,expectedDisputeId:disputeId,reason:'other',details:'Nous ne nous sommes pas trouvés.'});
    expect(h.fs.getDoc('articles/'+c.articleId)).toMatchObject({isSold:false});
    h.fs.setDoc('users/admin',{isActive:true,isAdmin:true});
    const input={transactionId:c.id,expectedDisputeId:disputeId,expectedAdminUid:'admin',decisionType:'buyer_upheld'};
    const preview=await invoke(closeMeetupNoShow,'admin',{...input,mode:'preview'});
    const confirm={...input,mode:'confirm',requestId:'decision-1234567890123456',previewId:preview.previewId,expectedSourceHash:preview.sourceHash,note:'Dossier humain classé.',accepted:true};
    await invoke(closeMeetupNoShow,'admin',confirm);
    const writes=h.fs.writeOps.length;await invoke(closeMeetupNoShow,'admin',confirm);expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.getDoc('transactions/'+c.id)).toMatchObject({status:'cancelled',disputed:false});
    expect(h.fs.getDoc('disputes/'+disputeId)).toMatchObject({status:'resolved'});expect(h.provider).not.toHaveBeenCalled();
  });
  it('deposits, removes, declines and expires local proposals without affecting an accepted competing agreement',async()=>{
    h.fs.setDoc('swapParties/generalist',{itemsCount:0});
    const id=await article('alice','deposit');
    await invoke(swaps.addItemToPartySecure,'alice',{partyId:'generalist',articleId:id,title:'Pull',price:25});
    await invoke(swaps.removeItemFromPartySecure,'alice',{partyId:'generalist',articleId:id});
    expect(h.fs.getDoc('swapParties/generalist')).toMatchObject({itemsCount:0});
    const p=await proposal('decline');await invoke(swaps.declineSwap,'bob',{swapId:p.id});
    const old=await proposal('expire');
    vi.useFakeTimers();vi.setSystemTime(Date.now()+8*86400000);
    try {await (expireStaleProposedSwaps as any).run({});}finally {vi.useRealTimers();}
    expect(h.fs.getDoc('swaps/'+old.id)).toMatchObject({status:'cancelled',cancelReason:'proposed_expired_7d'});
  });
  it('expires only native local proposals pinned to this installation and epoch in the disjoint phase1 job',async()=>{
    const eligible=await proposal('partition-local'),foreign=await proposal('partition-foreign'),tampered=await proposal('partition-tampered');
    const accepted=await proposal('partition-accepted');await accept(accepted.id);
    const foreignPath='swaps/'+foreign.id,tamperedPath='swaps/'+tampered.id;
    const foreignSource=h.fs.getDoc(foreignPath) as any,tamperedSource=h.fs.getDoc(tamperedPath) as any;
    h.fs.setDoc(foreignPath,{...foreignSource,localAgreementWitness:{...foreignSource.localAgreementWitness,epoch:'foreign-epoch'}});
    h.fs.setDoc(tamperedPath,{...tamperedSource,localAgreementWitness:{...tamperedSource.localAgreementWitness,nativeSourceHash:'0'.repeat(64)}});
    h.fs.setDoc('swaps/legacy-proposal',{status:'proposed',createdAt:Timestamp.now(),initiatorId:'alice',receiverId:'bob'});
    vi.stubEnv('SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT','phase1-runtime@seconde-dev.iam.gserviceaccount.com');
    vi.useFakeTimers();vi.setSystemTime(Date.now()+8*86400000);
    try {await (expirePhase1LocalProposals as any).run({});}finally {vi.useRealTimers();}
    expect(h.fs.getDoc('swaps/'+eligible.id)).toMatchObject({status:'cancelled',cancelReason:'proposed_expired_7d'});
    for(const id of [foreign.id,tampered.id,'legacy-proposal'])expect(h.fs.getDoc('swaps/'+id)).toMatchObject({status:'proposed'});
    expect(h.fs.getDoc('swaps/'+accepted.id)).toMatchObject({status:'accepted'});
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('keeps the phase1 job closed while draining and the existing test job off local-witness documents',async()=>{
    const local=await proposal('partition-closed'),writes=h.fs.writeOps.length;
    vi.useFakeTimers();vi.setSystemTime(Date.now()+8*86400000);
    try {
      h.mode='draining';await (expirePhase1LocalProposals as any).run({});
      expect(h.fs.writeOps).toHaveLength(writes);
      h.mode='normal';vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
      await (expireStaleProposedSwaps as any).run({});
    }finally {vi.useRealTimers();}
    expect(h.fs.getDoc('swaps/'+local.id)).toMatchObject({status:'proposed'});
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each([{stripePaymentIntentId:'pi_paid'},{walletAmountUsed:1},{shippingSnapshot:{}},{unknownMoneyEvidence:true},{financialRecoveryWitness:{protocol:'financial_recovery_source_witness_v1'}}])('refuses a native purchase with ambiguous/financial history %j',async extra=>{
    const c=await cash('negative');const path='transactions/'+c.id;h.fs.setDoc(path,{...h.fs.getDoc(path),...extra});const writes=h.fs.writeOps.length;
    await expect(invoke(cancelPendingTransaction,'bob',{transactionId:c.id})).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.provider).not.toHaveBeenCalled();
  });
  it('refuses a monetary top-up while the platform rails remain closed',async()=>{
    const writes=h.fs.writeOps.length;
    await expect(proposal('refuse-topup','hand_delivery',{amount:500,payerId:'alice'})).rejects.toBeDefined();
    expect(h.fs.writeOps.slice(writes).filter(v=>v.path.startsWith('swaps/'))).toHaveLength(0);expect(h.provider).not.toHaveBeenCalled();
  });
  it('keeps contractual timestamps bound, permits a harmless updatedAt change, and refuses a financial conversion',async()=>{
    const c=await cash('dates'),path='transactions/'+c.id;
    h.fs.setDoc(path,{...h.fs.getDoc(path),updatedAt:Timestamp.fromMillis(1)});
    await invoke(confirmMeetupTransaction,'alice',{transactionId:c.id,messageId:c.messageId});
    const value=h.fs.getDoc(path)!;h.fs.setDoc(path,{...value,cashAgreement:{...value.cashAgreement as any,acceptedAt:Timestamp.fromMillis(1)}});
    await expect(invoke(completeMeetupTransaction,'bob',{transactionId:c.id,messageId:c.messageId})).rejects.toMatchObject({code:'failed-precondition'});
    h.fs.setDoc(path,value);vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
    await expect(withFinancialRecoveryScope({operation:'callable/payments/meetup.completeMeetupTransaction'},()=>financialRecoverySourceFields('purchase',h.db.doc(path),value,{status:'paid'}))).rejects.toThrow();
    await expect(withFinancialRecoveryScope({operation:'callable/payments/meetup.completeMeetupTransaction'},()=>prepareFinancialRecoverySource('purchase',path,value))).rejects.toThrow();
    await expect(h.db.runTransaction((tx:any)=>tx.update(h.db.doc(path),{status:'paid'}))).rejects.toThrow('dedicated nonfinancial lifecycle');
  });
  it('rejects raw native writes, provider operations, and financial roots even inside a local scope',async()=>{
    await expect(withFinancialRecoveryScope({operation:'callable/swaps.proposeMultiSwap'},async()=>{
      await assertFinancialRecoveryEffect('firestore_commit',{refs:['swaps/forged']});await h.db.runTransaction((tx:any)=>tx.set(h.db.doc('swaps/forged'),{cashTopUp:null}));
    })).rejects.toBeDefined();
    await expect(withFinancialRecoveryScope({operation:'callable/swaps.proposeMultiSwap'},()=>assertFinancialRecoveryEffect('stripe_mutation',{providerOperation:'paymentIntents.create'}))).rejects.toBeDefined();
    await expect(withFinancialRecoveryScope({operation:'callable/swaps.proposeMultiSwap'},()=>assertFinancialRecoveryEffect('firestore_commit',{refs:['wallets/alice']}))).rejects.toBeDefined();
  });
  it.each([{cashTopUp:{amount:1,payerId:'alice'}},{exchangeMode:'shipping'},{topUpPaymentIntentId:null},{paidAt:Timestamp.fromMillis(1)},{unexpectedFinancialSource:{}}])('rejects an altered native swap before it can reserve stock %j',async extra=>{
    const p=await proposal('altered');const path='swaps/'+p.id;h.fs.setDoc(path,{...h.fs.getDoc(path),...extra});const writes=h.fs.writeOps.length;
    await expect(accept(p.id)).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(writes);expect(h.provider).not.toHaveBeenCalled();
    expect(h.fs.getDoc('articles/'+p.a)).toMatchObject({isSold:false});
  });
  it('does not adopt an old unfinanced-looking record without its native local witness',async()=>{
    const c=await cash('historical');const path='transactions/'+c.id,value=h.fs.getDoc(path)!;delete value.localAgreementWitness;h.fs.setDoc(path,value);
    const writes=h.fs.writeOps.length;await expect(invoke(cancelPendingTransaction,'alice',{transactionId:c.id})).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('serializes competing acceptances without allocating the same native inventory twice',async()=>{
    const p=await proposal('compete-1');const second=await invoke(swaps.proposeMultiSwap,'alice',{...p.input,clientRequestId:'compete-2'});
    const outcomes=await Promise.allSettled([accept(p.id),accept(second.swapId)]);
    expect(outcomes.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(v=>v.status==='rejected')).toHaveLength(1);
    expect([h.fs.getDoc('swaps/'+p.id),h.fs.getDoc('swaps/'+second.swapId)].filter(v=>v?.status==='accepted')).toHaveLength(1);
  });
  it('refuses new local effects when the independent control stops admission',async()=>{
    h.mode='draining';await expect(article('alice','stopped')).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each([new Date(),new GeoPoint(45,-73),new Map([['paid',true]])])('refuses unsupported native values instead of converting their prototype to an empty map',value=>{
    expect(()=>localServerTimestamps({nested:value})).toThrow();
  });
  it.each([
    (tx:any,ref:any)=>tx.update(ref,new FieldPath('stripeAccountId'),'acct_injected'),
    (tx:any,ref:any)=>tx.update(ref,'stripeAccountId','acct_injected'),
    (tx:any,ref:any)=>tx.update(ref,{rating:5},new FieldPath('stripeAccountId'),'acct_injected'),
    (tx:any,ref:any)=>tx.update(ref,Object.assign(new Date(),{stripeAccountId:'acct_injected'})),
  ])('rejects unsupported local update overloads before interpreting SDK internals',async mutate=>{
    const probe=nativeAdapterProbe({'users/alice':{displayName:'Alice'}});
    await expect(inQualifiedLocalScope('callable/swaps.proposeMultiSwap',()=>probe.database.runTransaction((tx:any)=>mutate(tx,probe.database.doc('users/alice')))))
      .rejects.toThrow('Unsupported local agreement write signature or field selection');
    expect(probe.calls).toHaveLength(0);expect(probe.native.get).not.toHaveBeenCalled();
  });
  it.each([
    {mergeFields:[new FieldPath('cashTopUp')]},
    {mergeFields:['cashTopUp',new FieldPath('cashTopUp')]},
    {mergeFields:['missing']},
    {mergeFields:['cashTopUp.missing']},
    {mergeFields:['cashTopUp..amount']},
    {mergeFields:['cashTopUp','cashTopUp.amount']},
    {mergeFields:['cashTopUp'],merge:true},
    {mergeFields:'cashTopUp'},
    {merge:'true'},
    {merge:true},
    {unexpected:true},
  ])('rejects unknown local set selections/options instead of filtering part of the write %j',async options=>{
    const p=await proposal('signature-set'),path='swaps/'+p.id;
    const probe=nativeAdapterProbe({[path]:h.fs.getDoc(path)});
    await expect(inQualifiedLocalScope('callable/swaps.proposeMultiSwap',()=>probe.database.runTransaction((tx:any)=>
      tx.set(probe.database.doc(path),{cashTopUp:{amount:50,payerId:'alice'}},options))))
      .rejects.toThrow('Unsupported local agreement write signature or field selection');
    expect(probe.calls).toHaveLength(0);expect(probe.native.get).not.toHaveBeenCalled();
  });
  it('preserves an explicitly supported local merge selection and the native SDK overload outside local scopes',async()=>{
    const p=await proposal('supported-set'),path='swaps/'+p.id,probe=nativeAdapterProbe({[path]:h.fs.getDoc(path)});
    await inQualifiedLocalScope('callable/swaps.proposeMultiSwap',()=>probe.database.runTransaction((tx:any)=>
      tx.set(probe.database.doc(path),{cashTopUp:null},{mergeFields:['cashTopUp']})));
    expect(probe.calls.some(v=>v.method==='set'&&v.args[0].path===path&&v.args[2].mergeFields[0]==='cashTopUp')).toBe(true);
    vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');const ordinary=nativeAdapterProbe({'users/alice':{displayName:'Alice'}}),field=new FieldPath('stripeAccountId');
    await ordinary.database.runTransaction((tx:any)=>tx.update(ordinary.database.doc('users/alice'),field,'acct_normal'));
    const forwarded=ordinary.calls.find(v=>v.method==='update');expect(forwarded?.args.slice(1)).toEqual([field,'acct_normal']);
  });
  it.each([
    ['transactions/id','callable/payments/meetup.acceptMeetupOffer'],
    ['swaps/id','callable/swaps.proposeMultiSwap'],
    ['disputes/id','callable/payments/meetup.reportMeetupNoShow'],
  ])('blocks generic financial witness factories and old valid-looking witnesses for %s',async(ref,operation)=>{
    const hash='a'.repeat(64),witness={protocol:'financial_recovery_source_witness_v1',installationId:'local-test',epoch:'local-epoch',ref,nativeSourceHash:hash};
    await expect(withFinancialRecoveryScope({operation},()=>financialRecoveryNewSourceWitness(ref,hash))).rejects.toMatchObject({reason:'financial_provider_unconfigured'});
    await expect(withFinancialRecoveryScope({operation},()=>assertFinancialRecoverySource({ref,nativeSourceHash:hash,witness}))).rejects.toMatchObject({reason:'financial_provider_unconfigured'});
    const domain=ref.startsWith('swaps/')?'swap':'purchase',data={};
    await expect(withFinancialRecoveryScope({operation},()=>prepareFinancialRecoveryNewSource(domain,{exists:false,ref:{path:ref}} as any,data))).rejects.toMatchObject({reason:'financial_provider_unconfigured'});
    const nativeHash=financialRecoverySourceHash(domain,data);
    await expect(withFinancialRecoveryScope({operation},()=>prepareFinancialRecoverySource(domain,ref,{financialRecoveryWitness:{...witness,nativeSourceHash:nativeHash}}))).rejects.toMatchObject({reason:'financial_provider_unconfigured'});
  });
  it('hashes the same materialized native timestamp that is forwarded to the absence-case commit',async()=>{
    const c=await cash('clock-case');const report=await invoke(reportMeetupNoShow,'bob',{transactionId:c.id,reason:'other_party_no_show',details:'Personne au rendez-vous.'});
    const path='disputes/'+report.disputeId,parent=h.fs.getDoc('transactions/'+c.id)!,before=h.fs.getDoc(path)!;
    const probe=nativeAdapterProbe({[path]:before,['transactions/'+c.id]:parent});
    let tick=0;const base=Date.now(),clock=vi.spyOn(Timestamp,'now').mockImplementation(()=>Timestamp.fromMillis(base+ ++tick));
    try {
      await inQualifiedLocalScope('callable/payments/disputes.closeMeetupNoShow',async()=>{
        await probe.database.runTransaction((tx:any)=>tx.update(probe.database.doc(path),{status:'resolved',resolution:'buyer_upheld',resolvedBy:'admin',
          resolvedAt:NativeFieldValue.serverTimestamp(),resolutionDecisionId:'a'.repeat(64)}));
        const patch=probe.calls.find(v=>v.method==='update'&&v.args[0].path===path)!.args[1];
        expect(patch.resolvedAt).toBeInstanceOf(Timestamp);
        const recalculated=localCashCaseFields(path,before,{...before,...patch},parent);
        expect(patch.localAgreementWitness.nativeSourceHash).toBe(recalculated.nativeSourceHash);
      });
    } finally {clock.mockRestore();}
  });
  it('never lets a purported financial manifest qualify an unconfigured local source',async()=>{
    const manifest=vi.spyOn(privateControl,'recoveryManifestQualifiesSource').mockResolvedValue(true);
    try {
      await expect(withFinancialRecoveryScope({operation:'callable/swaps.proposeMultiSwap'},()=>
        assertFinancialRecoverySource({ref:'swaps/manifest-claim',nativeSourceHash:'a'.repeat(64)})))
        .rejects.toMatchObject({reason:'financial_provider_unconfigured'});
      expect(manifest).not.toHaveBeenCalled();
    } finally {manifest.mockRestore();}
  });
});


describe('cash contractual image authority after a new proposal',()=>{
  async function priorMaterialization(suffix='cancelled-image-source') {
    const c=await cash(suffix),order=h.fs.getDoc('transactions/'+c.id)!;
    // Historical local materialization resolved purchase and message sentinels
    // separately. Keep the actual immutable purchase and its witness intact.
    const accepted=Timestamp.fromMillis((order.createdAt as Timestamp).toMillis()+1),messagePath='messages/'+c.messageId;
    const message=h.fs.getDoc(messagePath)!;h.fs.setDoc(messagePath,{...message,offer:{...message.offer,acceptedAt:accepted}});
    const threadPath='meetup_offer_threads/'+meetupThreadId(c.articleId,'bob');
    h.fs.setDoc(threadPath,{...h.fs.getDoc(threadPath),updatedAt:accepted});
    await invoke(cancelPendingTransaction,'bob',{transactionId:c.id});
    await invoke(sendMeetupProposal,'bob',{chatId:c.chatId,requestId:'next-cancelled-image-offer',amount:19,location:{toArrange:true}});
    return c;
  }
  async function advancingClock(fn:()=>Promise<void>) {
    const now=Date.now();let tick=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now+(tick++));
    try{await fn();}finally{clock.mockRestore();}
  }
  it('records one exact acceptance instant in all four native sources despite an advancing clock',()=>advancingClock(async()=>{
    const c=await cash('single-acceptance-clock'),order=h.fs.getDoc('transactions/'+c.id)!,message=h.fs.getDoc('messages/'+c.messageId)!,
      thread=h.fs.getDoc('meetup_offer_threads/'+meetupThreadId(c.articleId,'bob'))!;
    const accepted=order.cashAgreement.acceptedAt as Timestamp;
    expect((order.createdAt as Timestamp).isEqual(accepted)).toBe(true);
    expect((message.offer.acceptedAt as Timestamp).isEqual(accepted)).toBe(true);
    expect((thread.updatedAt as Timestamp).isEqual(accepted)).toBe(true);
  }));
  it('never lets a malformed protected witness fall through the new exact timestamp qualification',()=>advancingClock(async()=>{
    const c=await cash('new-image-corrupt-witness'),path='transactions/'+c.id,parent=h.fs.getDoc(path)!;
    const message=h.fs.getDoc('messages/'+c.messageId)!;expect(parent.createdAt.isEqual(message.offer.acceptedAt)).toBe(true);
    h.fs.setDoc(path,{...parent,localAgreementWitness:null});const writes=h.fs.writeOps.length;
    expect(await readNativeOrderAgreement(c.id,Timestamp.now(),{viewerId:'bob',sellerId:'alice',articleId:c.articleId})).toBeNull();
    expect(h.fs.writeOps).toHaveLength(writes);
  }));
  it('keeps the original native cancelled agreement readable after its thread advances',()=>advancingClock(async()=>{
    const c=await priorMaterialization(),writes=h.fs.writeOps.length;
    const proof=await invoke(readPrivateArticleEvidence,'bob',{articleId:c.articleId,transactionId:c.id});
    expect(proof).toMatchObject({state:'unrecorded',viewerId:'bob',articleId:c.articleId});
    expect(await readNativeOrderAgreement(c.id,Timestamp.now(),{viewerId:'bob',sellerId:'alice',articleId:c.articleId})).toEqual(h.fs.getDoc('transactions/'+c.id));
    expect(h.fs.getDoc('transactions/'+c.id)).toMatchObject({status:'cancelled'});expect(h.fs.writeOps).toHaveLength(writes);
  }));
  it.each(['cash-facts','witness','foreign-epoch','message-origin','message-transaction','message-amount','chronology','foreign-viewer','financial-marker'])('refuses an old-source %s mismatch without changing any native source',attack=>advancingClock(async()=>{
    const c=await priorMaterialization(),path='transactions/'+c.id,messagePath='messages/'+c.messageId;
    const parent=h.fs.getDoc(path)!,message=h.fs.getDoc(messagePath)!;
    if(attack==='cash-facts')h.fs.setDoc(path,{...parent,cashAgreement:{...parent.cashAgreement,agreementId:'f'.repeat(64)}});
    if(attack==='witness')h.fs.setDoc(path,{...parent,localAgreementWitness:null});
    if(attack==='foreign-epoch')h.fs.setDoc(path,{...parent,localAgreementWitness:{...parent.localAgreementWitness,epoch:'other'}});
    if(attack==='financial-marker')h.fs.setDoc(path,{...parent,stripePaymentIntentId:null});
    if(attack==='message-origin')h.fs.setDoc(messagePath,{...message,senderId:'mallory'});
    if(attack==='message-transaction')h.fs.setDoc(messagePath,{...message,offer:{...message.offer,transactionId:'other'}});
    if(attack==='message-amount')h.fs.setDoc(messagePath,{...message,offer:{...message.offer,amount:999}});
    if(attack==='chronology')h.fs.setDoc(messagePath,{...message,offer:{...message.offer,acceptedAt:Timestamp.fromMillis(parent.createdAt.toMillis()-1)}});
    const writes=h.fs.writeOps.length,scope={viewerId:attack==='foreign-viewer'?'mallory':'bob',sellerId:'alice',articleId:c.articleId};
    expect(await readNativeOrderAgreement(c.id,Timestamp.now(),scope)).toBeNull();expect(h.fs.writeOps).toHaveLength(writes);
  }));
  it('allows only the exact existing tokenless public generation before any withdrawal',()=>advancingClock(async()=>{
    const suffix='tokenless-image',requestId='item-'+suffix,id=createHash('sha256').update('alice:'+requestId).digest('hex').slice(0,20),
      path='articles/'+id+'/fixture.jpg',url='https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media';
    h.photoObjects.set(path,{generation:'123',crc32c:'AAAAAA==',size:1024,contentType:'image/jpeg',metadata:{},cacheControl:'private, no-store'});
    h.promotedImages.set(id,url);
    const c=await priorMaterialization(suffix),reference=createHash('sha256').update(url).digest('hex'),writes=h.fs.writeOps.length;
    const proof=await invoke(readPrivateArticleEvidence,'bob',{articleId:c.articleId,transactionId:c.id,sourceReferenceHashes:[reference]});
    expect(proof).toMatchObject({state:'unrecorded',publicReferenceUseAllowed:true,publicReferenceHashes:[reference]});
    expect(h.fs.writeOps).toHaveLength(writes);expect(h.photoObjects.get(path)!.metadata).toEqual({});
  }));
  it.each(['token','tokenless'])('deduplicates the real accepted swap snapshot %s image without widening requested references',async kind=>{
    const suffix='swap-image-'+kind,id=createHash('sha256').update('alice:own-'+suffix).digest('hex').slice(0,20),path='articles/'+id+'/fixture.jpg',
      url='https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media'+(kind==='token'?'&token=existing-token':'');
    h.promotedImages.set(id,url);h.photoObjects.set(path,{generation:'123',crc32c:'AAAAAA==',size:1024,contentType:'image/jpeg',
      metadata:kind==='token'?{firebaseStorageDownloadTokens:'existing-token'}:{},cacheControl:'private, no-store'});
    const p=await proposal(suffix);await accept(p.id);
    const snapshot=h.fs.getDoc('swaps/'+p.id)!.initiatorItems[0];expect(snapshot.imageUrl).toBe(url);expect(snapshot.images[0].url).toBe(url);
    const reference=createHash('sha256').update(url).digest('hex'),writes=h.fs.writeOps.length;
    const proof=await invoke(readPrivateArticleEvidence,'bob',{articleId:p.a,swapId:p.id,sourceReferenceHashes:[reference]});
    expect(proof).toMatchObject({state:'unrecorded',publicReferenceUseAllowed:true,publicReferenceHashes:[reference]});
    const other=await invoke(readPrivateArticleEvidence,'bob',{articleId:p.a,swapId:p.id,sourceReferenceHashes:['f'.repeat(64)]});
    expect(other).toMatchObject({state:'unrecorded',publicReferenceUseAllowed:false,publicReferenceHashes:[]});expect(h.fs.writeOps).toHaveLength(writes);
  });
  it.each(['generation','withdrawal'])('does not return a tokenless reference after a concurrent %s change',kind=>advancingClock(async()=>{
    const suffix='tokenless-race-'+kind,id=createHash('sha256').update('alice:item-'+suffix).digest('hex').slice(0,20),path='articles/'+id+'/fixture.jpg',
      url='https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/'+encodeURIComponent(path)+'?alt=media';
    h.promotedImages.set(id,url);h.photoObjects.set(path,{generation:'123',crc32c:'AAAAAA==',size:1024,contentType:'image/jpeg',metadata:{}});
    const c=await priorMaterialization(suffix),reference=createHash('sha256').update(url).digest('hex'),writes=h.fs.writeOps.length;let reads=0;
    h.photoMetadataRead=p=>{if(p===path&&++reads===2){if(kind==='generation')h.photoObjects.set(path,{...h.photoObjects.get(path),generation:'124'});
      else h.fs.setDoc('articles/'+id,{...h.fs.getDoc('articles/'+id),privacyWithdrawal:null});}};
    const read=invoke(readPrivateArticleEvidence,'bob',{articleId:id,transactionId:c.id,sourceReferenceHashes:[reference]});
    if(kind==='withdrawal')await expect(read).rejects.toBeDefined();else expect(await read).toMatchObject({state:'unrecorded',publicReferenceUseAllowed:false,publicReferenceHashes:[]});
    expect(h.fs.writeOps).toHaveLength(writes);
  }));

});
