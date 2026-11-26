import {beforeEach,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
vi.mock('firebase-admin/firestore',async original=>({...await original<any>(),FieldPath:{documentId:()=> '__name__'}}));
const h=await vi.hoisted(async()=>{
  const{createFirestoreMock}=await import('./testHelpers/firestoreMock');
  const fs=createFirestoreMock({enforceReadBeforeWrite:true}),batches:string[][]=[];
  const db={...fs.db,runTransaction:(fn:any)=>fs.db.runTransaction(tx=>fn({...tx,getAll:(...refs:any[])=>{
    batches.push(refs.map(ref=>ref.path));return Promise.all(refs.map(ref=>tx.get(ref)));}}))};
  return{fs,db,batches};
});
vi.mock('../config/firebase',()=>({db:h.db}));
import {readWalletHistoryPage} from './walletHistory';
const fs=h.fs,date=Timestamp.fromMillis(1_000_000),path='wallets/seller/ledger/credit1';
const ledger=()=>({type:'sale_credit',amount:3200,balanceAfter:3200,transactionId:'sale1',createdAt:date,status:'pending'});
const order=()=>({sellerId:'seller',currency:'CAD',sellerCreditedCents:3200,sellerPendingCreditCents:3200,
  sellerDebtRepaidCents:0,sellerCreditRecordedAt:date});
const read=(cursor:string|null=null,pageSize=40)=>readWalletHistoryPage('seller',{expectedUid:'seller',source:'ledger',
  period:{fromMs:null,toMs:null},cursor,pageSize},async()=>null);
beforeEach(()=>{fs.reset();h.batches.length=0;fs.setDoc('wallets/seller',{currency:'CAD'});fs.setDoc('transactions/sale1',order());fs.setDoc(path,ledger());});
it('qualifies omitted sale-credit currency only through its exact native same-commit tuple without rewriting it',async()=>{
  const page=await read();expect(page.entries[0]).toMatchObject({amountCents:3200,currency:'CAD',financialQualification:'qualified',anomalies:[]});
  expect(fs.getDoc(path)).not.toHaveProperty('currency');expect(fs.writeOps).toHaveLength(0);
});
it('normalizes explicit lowercase ISO currency used by native wallets without inferring an omitted value',async()=>{
  fs.setDoc('wallets/seller',{currency:'cad'});fs.setDoc('transactions/sale1',{...order(),currency:'cad'});
  expect((await read()).entries[0]).toMatchObject({currency:'CAD',financialQualification:'qualified'});
  fs.setDoc('wallets/seller',{});expect((await read()).entries[0].currency).toBeNull();
});
it('keeps currency unknown when wallet, seller, amount, debt split or native date does not prove it',async()=>{
  for(const patch of[{sellerId:'other'},{currency:'USD'},{sellerPendingCreditCents:3199},
    {sellerDebtRepaidCents:null},{sellerCreditRecordedAt:Timestamp.fromMillis(date.toMillis()+1)}]){
    fs.setDoc('transactions/sale1',{...order(),...patch});const page=await read();expect(page.entries[0].currency).toBeNull();
    expect(page.entries[0].anomalies).toContain('currency_unqualified');
  }
  fs.setDoc('transactions/sale1',order());fs.setDoc('wallets/seller',{currency:'USD'});expect((await read()).entries[0].currency).toBeNull();
});
it('does not infer other ledger kinds or override an explicitly unknown/foreign currency',async()=>{
  for(const row of[{...ledger(),type:'funds_held'},{...ledger(),currency:null},{...ledger(),currency:'USD'}]){
    fs.setDoc(path,row);expect((await read()).entries[0].currency).toBeNull();
  }
});
it('preserves bounded paging and batches each referenced order once within its page',async()=>{
  fs.setDoc('wallets/seller/ledger/credit2',{...ledger()});
  const first=await read(null,1);expect(first.hasMore).toBe(true);expect(first.entries).toHaveLength(1);expect(first.cursor).not.toBeNull();
  const second=await read(first.cursor,1);expect(second.entries[0].id).not.toBe(first.entries[0].id);expect(second.hasMore).toBe(false);
  h.batches.length=0;const both=await read();expect(both.entries).toHaveLength(2);expect(h.batches).toEqual([['transactions/sale1']]);
  expect(fs.writeOps).toHaveLength(0);
});
