import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc,getDoc,setDoc,updateDoc,deleteField } from 'firebase/firestore';
import { beforeAll,beforeEach,afterAll,it } from 'vitest';
import { getTestEnv,teardownTestEnv } from './helpers';
const proof={schemaVersion:1,state:'committed',actorUid:'buyer',amountCents:6475,ledgerId:'native',currency:'CAD',quoteId:'quote',rateId:'se-rate'};
beforeAll(async()=>{await getTestEnv();});afterAll(teardownTestEnv);
beforeEach(async()=>{const env=await getTestEnv();await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'transactions','wallet_purchase'),{buyerId:'buyer',sellerId:'seller',articleId:'article',status:'paid',walletPayment:proof,walletAmountUsed:6475,labelCreationPending:true});
  await setDoc(doc(c.firestore(),'wallets','buyer','ledger','native'),{type:'purchase_debit',transactionId:'wallet_purchase',amount:6475});
  await setDoc(doc(c.firestore(),'shipping_quotes','quote'),{ownerId:'buyer',state:'claimed',source:{privateProof:'not client readable'}});
});});
it.each(['buyer','seller'])('participant %s can read own receipt but cannot forge/clear server proof',async uid=>{
  const env=await getTestEnv(),db=env.authenticatedContext(uid).firestore(),ref=doc(db,'transactions','wallet_purchase');
  await assertSucceeds(getDoc(ref));await assertFails(updateDoc(ref,{walletPayment:{...proof,amountCents:1}}));await assertFails(updateDoc(ref,{walletPayment:deleteField()}));
});
it('third party cannot read receipt, ledger or private quote',async()=>{const env=await getTestEnv(),db=env.authenticatedContext('other').firestore();
  for(const p of['transactions/wallet_purchase','wallets/buyer/ledger/native','shipping_quotes/quote'])await assertFails(getDoc(doc(db,p)));
});
it('buyer cannot manufacture proof/ledger or expose private quote through direct writes',async()=>{const env=await getTestEnv(),db=env.authenticatedContext('buyer').firestore();
  await assertFails(setDoc(doc(db,'transactions','forged'),{buyerId:'buyer',sellerId:'seller',articleId:'article',status:'paid',walletPayment:proof}));
  await assertFails(setDoc(doc(db,'wallets','buyer','ledger','forged'),{type:'purchase_debit',amount:6475,transactionId:'wallet_purchase'}));
  await assertFails(getDoc(doc(db,'shipping_quotes','quote')));
});
