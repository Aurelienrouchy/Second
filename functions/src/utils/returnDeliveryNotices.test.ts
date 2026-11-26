import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('./testHelpers/firestoreMock');
  const fs=createFirestoreMock({enforceReadBeforeWrite:true});
  const db={...fs.db,runTransaction:(fn:any)=>fs.db.runTransaction(tx=>fn({...tx,getAll:(...refs:any[])=>Promise.all(refs.map(ref=>tx.get(ref)))}))};
  return{fs,db,committed:vi.fn()};
});
vi.mock('../config/firebase',()=>({db:h.db,get FieldValue(){return{...h.fs.FieldValue,serverTimestamp:()=>Timestamp.now()};}}));
vi.mock('./returnRequest',()=>({committedReturnReceipt:h.committed}));
vi.mock('../config/shipEngine',()=>({trackingIdentity:(_id:string,order:any)=>({labelId:order.returnLabelId,sourceHash:'native-source',
  trackingNumber:'RETURN123',carrierCode:order.returnCarrierCode,shipmentId:'shipment1'})}));
vi.mock('firebase-functions/v2/firestore',()=>({onDocumentCreated:(_o:any,fn:any)=>fn,onDocumentUpdated:(_o:any,fn:any)=>fn}));
vi.mock('firebase-functions/logger',()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}));
import {notifyReturnDelivered} from './notifications';
const fs=h.fs,stamp=Timestamp.fromMillis(1_000_000);
const order=()=>({buyerId:'buyer',sellerId:'seller',returnLabelId:'label1',returnCarrierCode:'canada_post',carrierCode:'canada_post',
  returnRequest:{requestId:'return_request1'},returnTrackingStatus:'DELIVERED',returnDeliveredAt:stamp,
  returnTrackingObservation:{statusCode:'DE',readId:'delivery-read'},
  returnDeliveryProof:{schemaVersion:1,transactionId:'order1',leg:'return',statusCode:'DE',sourceHash:'native-source',labelId:'label1',
    trackingNumber:'RETURN123',carrierCode:'canada_post',shipmentId:'shipment1',recordedAt:stamp,readId:'delivery-read',readVersion:2,
    requestedAtMs:999000,observedAtMs:999500,providerEventAtMs:999100,provider:'shipengine',identitySource:'saved_label_get_and_label_track'}});
const fire=async()=>{
  const after=fs.getDoc('transactions/order1');
  await(notifyReturnDelivered as any)({params:{transactionId:'order1'},data:{before:{data:()=>({})},after:{data:()=>after}}});
};
beforeEach(()=>{
  fs.reset();h.committed.mockReset();h.committed.mockReturnValue(true);fs.setDoc('transactions/order1',order());
  fs.setDoc('transactions/order1/tracking_history/capture1',{protocol:'tracking_history_v1',buyerId:'buyer',sellerId:'seller',recordedAt:Timestamp.fromMillis(999600),
    info:{transactionId:'order1',leg:'return',sourceHash:'native-source',readId:'delivery-read',readVersion:2,providerStatusCode:'DE',
      providerObservedAtMs:999500,providerEventAtMs:999100,observationSource:'shipengine',financialEffectAuthorized:false}});
});
afterEach(()=>vi.unstubAllEnvs());
it('commits two short native return notices once and writes no order, ledger or refund',async()=>{
  await fire();await fire();
  const notifications=fs.writeOps.filter(w=>w.method==='create'&&w.path.startsWith('notifications/'));
  expect(notifications).toHaveLength(2);
  for(const w of notifications){const n=fs.getDoc(w.path)!;expect(n).toMatchObject({type:'order_delivered',title:'Retour livré',
    data:{transactionId:'order1',trackingLeg:'return',deepLink:expect.stringContaining('/orders/order1'),refundDecisionGranted:'false'}});}
  expect(fs.writeOps.every(w=>w.path.startsWith('notifications/')||w.path.startsWith('operational_notice_receipts/'))).toBe(true);
});
it('does not resurrect a member-dismissed notice on event redelivery',async()=>{
  await fire();const notice=fs.writeOps.find(w=>w.path.startsWith('notifications/'))!;
  fs.setDoc(notice.path,null);const count=fs.writeOps.length;await fire();expect(fs.getDoc(notice.path)).toBeUndefined();expect(fs.writeOps).toHaveLength(count);
});
it('requires the native return, same label and immutable delivered capture',async()=>{
  h.committed.mockReturnValue(false);await fire();expect(fs.writeOps).toHaveLength(0);h.committed.mockReturnValue(true);
  fs.setDoc('transactions/order1',{...order(),returnLabelId:'other-label'});await fire();expect(fs.writeOps).toHaveLength(0);
  fs.setDoc('transactions/order1',order());fs.setDoc('transactions/order1/tracking_history/capture1',null);await fire();expect(fs.writeOps).toHaveLength(0);
});
it('rejects an ambiguous label owner or a current contradictory tracking observation',async()=>{
  fs.setDoc('transactions/order2',{...order(),buyerId:'other'});await fire();expect(fs.writeOps).toHaveLength(0);
  fs.setDoc('transactions/order2',null);fs.setDoc('transactions/order1',{...order(),returnTrackingObservation:{statusCode:'EX'}});
  await fire();expect(fs.writeOps).toHaveLength(0);
});
it('does not promote a simulated return proof in a production runtime',async()=>{
  const o=order();o.carrierCode='seconde_dev';o.returnCarrierCode='seconde_dev';
  o.returnDeliveryProof.provider='seconde_dev_simulation';o.returnDeliveryProof.identitySource='member_test_action';
  fs.setDoc('transactions/order1',{...o,devShippingSimulation:{protocol:'seconde_dev_shipping_simulation_v1',realShipment:false}});
  const c=fs.getDoc('transactions/order1/tracking_history/capture1')!;
  fs.setDoc('transactions/order1/tracking_history/capture1',{...c,info:{...c.info,observationSource:'seconde_dev_simulation'}});
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  await fire();expect(fs.writeOps).toHaveLength(0);
});
