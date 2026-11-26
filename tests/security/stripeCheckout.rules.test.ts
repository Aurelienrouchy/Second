/** New authorization evidence is private, server-write only. Real Web SDK rules. */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';
beforeAll(getTestEnv); afterAll(teardownTestEnv);
beforeEach(async()=>{const env=await getTestEnv();await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'stripe_checkout_intents/order'),{ownerId:'buyer',state:'unknown',sourceHash:'PRIVATE',reason:'PRIVATE_INTERNAL',paymentIntentId:'pi_private'});
  await setDoc(doc(c.firestore(),'transactions/order'),{buyerId:'buyer',sellerId:'seller',status:'pending_payment',stripeCheckoutProtocol:'server_manual_v1'});
});});
it.each(['buyer','seller','other','anonymous'])('intent %s cannot read by id or enumerate an owner-filtered authorization queue',async actor=>{
 const env=await getTestEnv(),db=(actor==='anonymous'?env.unauthenticatedContext():env.authenticatedContext(actor)).firestore();
 await assertFails(getDoc(doc(db,'stripe_checkout_intents/order')));await assertFails(getDocs(query(collection(db,'stripe_checkout_intents'),where('ownerId','==','buyer'))));
});
it('admin may inspect intent by id and action state queue; it is not publicly readable evidence',async()=>{
 const env=await getTestEnv(),db=env.authenticatedContext('admin',{admin:true}).firestore();await assertSucceeds(getDoc(doc(db,'stripe_checkout_intents/order')));await assertSucceeds(getDocs(query(collection(db,'stripe_checkout_intents'),where('state','==','unknown'))));
});
it.each(['buyer','other','admin'])('intent %s cannot forge owner/authorization, replace or delete server evidence',async actor=>{
 const env=await getTestEnv(),db=env.authenticatedContext(actor,actor==='admin'?{admin:true}:{}).firestore();
 await assertFails(setDoc(doc(db,'stripe_checkout_intents/fresh'),{ownerId:actor,state:'prepared',allowed:true}));
 await assertFails(updateDoc(doc(db,'stripe_checkout_intents/order'),{ownerId:actor,state:'succeeded',paymentIntentId:'pi_forged'}));
 await assertFails(deleteDoc(doc(db,'stripe_checkout_intents/order')));
});
it('buyer cannot inject/erase checkout protocol or its preparation marker while retaining authorized order access',async()=>{
 const env=await getTestEnv(),db=env.authenticatedContext('buyer').firestore();
 await assertFails(updateDoc(doc(db,'transactions/order'),{stripeCheckoutProtocol:'automatic',serviceFeePercent:null}));
 await assertSucceeds(getDoc(doc(db,'transactions/order')));
});
