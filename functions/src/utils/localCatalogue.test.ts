/** Real inventory planner and native transaction adapter; only external I/O is
 * replaced. These fixtures contain no production data or financial baseline. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FieldPath,FieldValue as NativeFieldValue,Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('./testHelpers/firestoreMock');
  const fs=createFirestoreMock({enforceReadBeforeWrite:true}),db=fs.db as any;
  db.doc=(path:string)=>{const p=path.split('/');let ref:any=db.collection(p[0]).doc(p[1]);for(let i=2;i<p.length;i+=2)ref=ref.collection(p[i]).doc(p[i+1]);return ref;};
  const original=db.runTransaction.bind(db);
  // The adapter sees actual SDK delete transforms. The in-memory persistence
  // layer translates them only at its final native write boundary.
  const persisted=(v:any):any=>v instanceof NativeFieldValue&&v.isEqual(NativeFieldValue.delete())?fs.FieldValue.delete():
    Array.isArray(v)?v.map(persisted):v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype?
      Object.fromEntries(Object.entries(v).map(([k,x])=>[k,persisted(x)])):v;
  db.runTransaction=(fn:any)=>original(async(tx:any)=>{
    for(const method of ['create','set','update']){const write=tx[method].bind(tx);tx[method]=(...a:any[])=>write(a[0],persisted(a[1]),...a.slice(2));}
    return fn(tx);
  });
  return {fs,db,original,mode:'normal',previousEpoch:null as string|null,environment:'unconfigured',evidence:[] as any[]};
});
vi.mock('../config/firebase',()=>({get db(){return h.db;},FieldValue:{...h.fs.FieldValue,
  serverTimestamp:()=>Timestamp.now(),delete:()=>NativeFieldValue.delete()},
  auth:{getUser:async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(0).toISOString()})},storage:{bucket:()=>({name:'demo-second.appspot.com'})}}));
vi.mock('../config/recoveryControl',async original=>({...await original<typeof import('../config/recoveryControl')>(),
  readFinancialRecoveryControl:async()=>({control:{mode:h.mode,financialEnvironment:h.environment,installationId:'catalogue-initial',epoch:'catalogue-epoch',
    previousEpoch:h.previousEpoch,businessAdmission:{protocol:'business_admission_control_v1',state:'open',planId:null}},
    installation:{prefix:'catalogue-initial'},generation:'1',sha256:'a'.repeat(64)}),
  createRecoveryEvidence:async(_path:string,value:any)=>{h.evidence.push(value);}}));
vi.mock('../config/stripe',()=>({getStripe:()=>{throw Error('provider must not be contacted');}}));
vi.mock('../config/shipEngine',()=>({getShipEngine:()=>{throw Error('provider must not be contacted');}}));
vi.mock('firebase-functions/logger',()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()}));
import {installFinancialSubjectTransactions} from './financialSubjectTransaction';
import {assertFinancialRecoveryEffect,withFinancialRecoveryScope} from './financialRecoveryInterlock';
import {financialRecoverySourceFields,prepareFinancialRecoverySource} from './financialRecoverySources';
import {planArticleInventoryForEdit,planInventoryDeclaration,planInventoryManualSale} from './inventoryUnit';
installFinancialSubjectTransactions(h.db);
const scope=<T>(fn:()=>Promise<T>)=>withFinancialRecoveryScope({operation:'callable/products.updateArticle'},fn);
const article=()=>({sellerId:'alice',isSold:false,isActive:true,title:'Pull historique',price:25});
async function adopt(){return scope(()=>h.db.runTransaction(async(tx:any)=>{
  const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
  const plan=await planArticleInventoryForEdit(tx,'alice','legacy',before,'b'.repeat(64));
  plan?.commit();tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,before,plan!.articleFields));
}));}
beforeEach(()=>{h.fs.reset();h.mode='normal';h.previousEpoch=null;h.environment='unconfigured';h.evidence=[];
  vi.stubEnv('GCLOUD_PROJECT','demo-second');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_PROJECT_ID','demo-second');
  vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','unconfigured');h.fs.setDoc('articles/legacy',article());});
afterEach(()=>vi.unstubAllEnvs());
describe('initial unconfigured historical catalogue adoption',()=>{
  it('adopts available native stock atomically with a distinct nonfinancial witness',async()=>{
    await adopt();
    const row=h.fs.getDoc('articles/legacy') as any;
    expect(row).toMatchObject({sellerId:'alice',inventoryUnit:{protocol:'seller_inventory_article_v1'},
      localCatalogueWitness:{protocol:'local_catalogue_source_v1',installationId:'catalogue-initial',epoch:'catalogue-epoch',
        ref:'articles/legacy',financialSettlement:'not_asserted'}});
    expect(row).not.toHaveProperty('financialRecoveryWitness');
    const unit=h.fs.writeOps.find(v=>v.path.startsWith('inventory_units/unit_'))!;
    expect(h.fs.getDoc(unit.path)).toMatchObject({state:'available',localCatalogueWitness:{protocol:'local_catalogue_source_v1'}});
    expect(h.fs.getDoc(unit.path)).not.toHaveProperty('financialRecoveryWitness');
    expect(h.fs.writeOps.filter(v=>/^(transactions|swaps|wallets|platform_ledger)\//.test(v.path))).toHaveLength(0);
  });
  it('reuses native inventory then records a manual sale without readopting old history',async()=>{
    await adopt();
    await withFinancialRecoveryScope({operation:'callable/products.toggleArticleSold'},()=>h.db.runTransaction(async(tx:any)=>{
      const before=(await tx.get(h.db.doc('articles/legacy'))).data();
      const p=await planInventoryManualSale(tx,'legacy',before,'sale',true);p.commit();
    }));
    expect(h.fs.getDoc('articles/legacy')).toMatchObject({isSold:true,localCatalogueWitness:{financialSettlement:'not_asserted'}});
  });
  it('refuses raw generic financial adoption of a historical article',async()=>{
    await expect(scope(()=>prepareFinancialRecoverySource('inventory_article','articles/legacy',article())))
      .rejects.toMatchObject({reason:'source_not_reconciled'});
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('hides a historical listing without adopting or releasing its paid history',async()=>{
    const before={...article(),activeTransactionId:'paid-order'};h.fs.setDoc('articles/legacy',before);
    h.fs.setDoc('transactions/paid-order',{articleId:'legacy',sellerId:'alice',buyerId:'bob',status:'paid'});
    await scope(()=>h.db.runTransaction(async(tx:any)=>{const ref=h.db.doc('articles/legacy'),row=(await tx.get(ref)).data();
      tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,row,{isActive:false}));}));
    expect(h.fs.getDoc('articles/legacy')).toEqual({...before,isActive:false});
    expect(h.fs.getDoc('transactions/paid-order')).toMatchObject({status:'paid'});
    expect(h.fs.writeOps.map(v=>v.path)).toEqual(['articles/legacy']);
  });
  it('can hide ambiguous old quantities without declaring them to be available stock',async()=>{
    h.fs.setDoc('articles/legacy',{...article(),quantity:3,stock:3});
    await scope(()=>h.db.runTransaction(async(tx:any)=>{const ref=h.db.doc('articles/legacy'),row=(await tx.get(ref)).data();
      tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,row,{isActive:false}));}));
    expect(h.fs.getDoc('articles/legacy')).toEqual({...article(),quantity:3,stock:3,isActive:false});
    expect(h.fs.writeOps.map(v=>v.path)).toEqual(['articles/legacy']);
    await expect(adopt()).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
  });
  it('does not reactivate or alter a legacy reservation through the hiding exception',async()=>{
    h.fs.setDoc('articles/legacy',{...article(),isActive:false,activeTransactionId:'paid-order'});
    for(const fields of [{isActive:true},{isActive:false,activeTransactionId:null},{isActive:false,quantity:2}]){
      await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{const ref=h.db.doc('articles/legacy'),row=(await tx.get(ref)).data();
        tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,row,fields));}))).rejects.toBeDefined();
    }
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each(['recovery','draining'])('refuses a %s control without writing stock',async mode=>{
    h.mode=mode;await expect(adopt()).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(0);
  });
  it('never bootstraps a restored installation',async()=>{
    h.previousEpoch='prior';await expect(adopt()).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(0);
  });
  it('keeps owner and observed revision guards before adoption',async()=>{
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const before=(await tx.get(h.db.doc('articles/legacy'))).data();
      return planArticleInventoryForEdit(tx,'mallory','legacy',before,'b'.repeat(64));
    }))).rejects.toMatchObject({details:{reason:'inventory_unit_engaged'}});
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const before=(await tx.get(h.db.doc('articles/legacy'))).data();
      return planInventoryDeclaration(tx,'alice','legacy',before,{kind:'new_unit'},'b'.repeat(64),'c'.repeat(64));
    }))).rejects.toMatchObject({details:{reason:'inventory_unit_observation_stale'}});
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('refuses an active or ambiguous historical agreement',async()=>{
    h.fs.setDoc('transactions/old',{sellerId:'alice',buyerId:'bob',articleId:'legacy',status:'paid'});
    await expect(adopt()).rejects.toMatchObject({details:{reason:'inventory_unit_legacy_history_required'}});expect(h.fs.writeOps).toHaveLength(0);
  });
  it('refuses a present malformed catalogue witness rather than replacing it',async()=>{
    h.fs.setDoc('articles/legacy',{...article(),localCatalogueWitness:null});
    await expect(adopt()).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(0);
  });
  it('rejects a changed native owner even if a caller supplied the old snapshot',async()=>{
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
      const plan=await planArticleInventoryForEdit(tx,'alice','legacy',before,'b'.repeat(64));
      h.fs.setDoc('articles/legacy',{...before,sellerId:'mallory'});
      plan?.commit();tx.update(ref,plan!.articleFields);
    }))).rejects.toBeDefined();
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('does not convert a catalogue proof into financial authority in test mode',async()=>{
    await adopt();const row=h.fs.getDoc('articles/legacy') as any;
    h.environment='test';vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');
    await expect(scope(()=>prepareFinancialRecoverySource('inventory_article','articles/legacy',row)))
      .rejects.toBeDefined();
  });
  it('does not permit a forged post-adoption witness',async()=>{
    await adopt();const row=h.fs.getDoc('articles/legacy') as any;
    h.fs.setDoc('articles/legacy',{...row,localCatalogueWitness:{...row.localCatalogueWitness,nativeSourceHash:'f'.repeat(64)}});
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
      tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,before,{isActive:false}));
    }))).rejects.toBeDefined();
  });
  it.each([
    {quantity:2},{ownerId:'mallory'},{activeTransactionId:'other'},
    {reservation:{transactionId:'other'}},{inventoryUnitId:'other'},
    {supersededByArticleId:'other'},{swapId:'other'},
  ])('binds every native stock or reservation authority %#',async changed=>{
    await adopt();const row=h.fs.getDoc('articles/legacy') as any,writes=h.fs.writeOps.length;
    h.fs.setDoc('articles/legacy',{...row,...changed});
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
      tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,before,{isActive:false}));
    }))).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('does not confuse harmless counters with stock identity',async()=>{
    await adopt();const row=h.fs.getDoc('articles/legacy') as any;
    h.fs.setDoc('articles/legacy',{...row,views:20,likes:2,updatedAt:Timestamp.now()});
    await scope(()=>h.db.runTransaction(async(tx:any)=>{const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
      tx.update(ref,await financialRecoverySourceFields('inventory_article',ref,before,{isActive:false}));}));
    expect(h.fs.getDoc('articles/legacy')).toMatchObject({views:20,likes:2,isActive:false});
  });
  it('refuses a catalogue write outside its invocation scope',async()=>{
    await adopt();const writes=h.fs.writeOps.length;
    await expect(h.db.runTransaction(async(tx:any)=>{tx.update(h.db.doc('articles/legacy'),{isSold:true});}))
      .rejects.toThrow('qualified scope');
    expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('refuses importing a financial witness even into an apparently available old article',async()=>{
    h.fs.setDoc('articles/legacy',{...article(),financialRecoveryWitness:null});
    await expect(adopt()).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('binds the exact source while a reservation appears during the transaction',async()=>{
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
      const p=await planArticleInventoryForEdit(tx,'alice','legacy',before,'b'.repeat(64));
      h.fs.setDoc('articles/legacy',{...before,activeTransactionId:'concurrent'});
      p!.commit();tx.update(ref,p!.articleFields);
    }))).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('cannot reuse adoption authorization for an unplanned consumption or reservation',async()=>{
    for(const changed of [{isSold:true},{activeTransactionId:'forged'},{reservation:{id:'forged'}}]){
      await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
        const ref=h.db.doc('articles/legacy'),before=(await tx.get(ref)).data();
        const p=await planArticleInventoryForEdit(tx,'alice','legacy',before,'b'.repeat(64));
        const fields=await financialRecoverySourceFields('inventory_article',ref,before,{...p!.articleFields,...changed});
        p!.commit();tx.update(ref,fields);
      }))).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    }
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each(['update','mergeFields','merge','replace'])('cannot erase a financial proof through native %s',async method=>{
    h.fs.setDoc('articles/legacy',{...article(),financialRecoveryWitness:null});
    await expect(scope(async()=>{
      await assertFinancialRecoveryEffect('firestore_commit',{refs:['articles/legacy']});
      return h.db.runTransaction(async(tx:any)=>{const ref=h.db.doc('articles/legacy');
        if(method==='update')tx.update(ref,{financialRecoveryWitness:NativeFieldValue.delete()});
        else if(method==='mergeFields')tx.set(ref,{financialRecoveryWitness:NativeFieldValue.delete()},{mergeFields:['financialRecoveryWitness']});
        else if(method==='merge')tx.set(ref,{financialRecoveryWitness:NativeFieldValue.delete()},{merge:true});
        else tx.set(ref,article());
      });
    })).rejects.toBeDefined();
    expect(h.fs.getDoc('articles/legacy')).toHaveProperty('financialRecoveryWitness',null);
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('rejects FieldPath overloads before they can remove a financial proof',async()=>{
    h.fs.setDoc('articles/legacy',{...article(),financialRecoveryWitness:null});
    await expect(scope(()=>h.db.runTransaction(async(tx:any)=>{
      tx.update(h.db.doc('articles/legacy'),new FieldPath('financialRecoveryWitness'),NativeFieldValue.delete());
    }))).rejects.toThrow('Unsupported local');
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each([null,{protocol:'financial_recovery_source_witness_v1'}])('preserves a present financial marker even outside a catalogue scope %#',async marker=>{
    h.fs.setDoc('articles/legacy',{...article(),financialRecoveryWitness:marker});
    await expect(h.db.runTransaction(async(tx:any)=>{tx.update(h.db.doc('articles/legacy'),{financialRecoveryWitness:NativeFieldValue.delete()});}))
      .rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    expect(h.fs.getDoc('articles/legacy')).toHaveProperty('financialRecoveryWitness',marker);
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('cannot add or replace financial authority with a stock-neutral native update',async()=>{
    await expect(scope(async()=>{
      await assertFinancialRecoveryEffect('firestore_commit',{refs:['articles/legacy']});
      await h.db.runTransaction(async(tx:any)=>{tx.update(h.db.doc('articles/legacy'),{financialRecoveryWitness:{protocol:'forged'}});});
    })).rejects.toMatchObject({reason:'local_catalogue_unqualified'});
    expect(h.fs.getDoc('articles/legacy')).not.toHaveProperty('financialRecoveryWitness');
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it('rejects unmodelled stock signatures outside a catalogue scope too',async()=>{
    await expect(h.db.runTransaction(async(tx:any)=>{
      tx.update(h.db.doc('articles/legacy'),new FieldPath('financialRecoveryWitness'),{protocol:'forged'});
    })).rejects.toThrow('Unsupported local');
    await expect(h.db.runTransaction(async(tx:any)=>{
      tx.set(h.db.doc('articles/legacy'),{financialRecoveryWitness:{protocol:'forged'}},{mergeFields:[new FieldPath('financialRecoveryWitness')]});
    })).rejects.toThrow('Unsupported local');
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each([false,true])('a native transaction retry requires its own history plan (replan=%s)',async replan=>{
    const retry=Symbol('native aborted attempt');let attempt=0,saved:any;
    const database:any={...h.db,runTransaction:async(fn:any)=>{
      try{await h.original(async(tx:any)=>{await fn(tx);throw retry;});}catch(e){if(e!==retry)throw e;}
      return h.original(fn);
    }};
    installFinancialSubjectTransactions(database);
    const operation=scope(()=>database.runTransaction(async(tx:any)=>{
      attempt++;
      const ref=database.doc('articles/legacy');
      if(attempt===1||replan){
        const row=(await tx.get(ref)).data();
        const p=await planArticleInventoryForEdit(tx,'alice','legacy',row,'b'.repeat(64));
        saved=p!.articleFields;p!.commit();tx.update(ref,saved);
      }else tx.update(ref,saved);
    }));
    if(replan){await operation;expect(h.fs.getDoc('articles/legacy')).toHaveProperty('localCatalogueWitness');}
    else{await expect(operation).rejects.toMatchObject({reason:'local_catalogue_unqualified'});expect(h.fs.writeOps).toHaveLength(0);}
    expect(attempt).toBe(2);
  });
});
