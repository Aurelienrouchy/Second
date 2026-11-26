/** Canonical admin transport of the new client, with native receipts and the
 * actual transaction adapter. No external authority is inferred from a notice. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('../utils/testHelpers/firestoreMock'),fs=createFirestoreMock({enforceReadBeforeWrite:true}),db=fs.db as any;
  db.doc=(path:string)=>{const p=path.split('/');let r=db.collection(p[0]).doc(p[1]);for(let i=2;i<p.length;i+=2)r=r.collection(p[i]).doc(p[i+1]);return r;};
  const original=db.runTransaction.bind(db);db.runTransaction=(fn:any)=>original((tx:any)=>{tx.getAll=(...refs:any[])=>Promise.all(refs.map(r=>tx.get(r)));return fn(tx);});
  return {fs,db,admin:true};
});
vi.mock('../config/firebase',()=>({get db(){return h.db;},get FieldValue(){return {...h.fs.FieldValue,serverTimestamp:()=>Timestamp.now()};},
  auth:{getUser:async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(0).toISOString(),customClaims:{admin:uid==='admin'&&h.admin}})},messaging:{}}));
vi.mock('firebase-functions/logger',()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()}));
import {reportPrivacyIncident,getPrivacyIncidentsLog,escalatePrivacyIncidentToCAI,notifyAffectedUsers} from './privacyIncidents';
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';
installFinancialSubjectTransactions(h.db);
const call=(fn:any,data:any,uid='admin')=>fn.run({auth:{uid,token:{auth_time:Math.floor(Date.now()/1000)}},data});
const create=(requestId='incident_request_12345678')=>call(reportPrivacyIncident,{mode:'execute',expectedAdminUid:'admin',requestId,
  type:'synthetic_privacy_case',severity:'low',description:'Cas synthétique de qualification.',affectedUserIds:['recipient'],affectedDataFields:['synthetic'],measures:'Aucune donnée réelle.',status:'contained'});
beforeEach(()=>{h.fs.reset();h.admin=true;vi.stubEnv('GCLOUD_PROJECT','seconde-dev');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_PROJECT_ID','seconde-dev');
  h.fs.setDoc('users/admin',{isActive:true,isAdmin:true});h.fs.setDoc('users/recipient',{isActive:true});});
afterEach(()=>vi.unstubAllEnvs());
describe('phase1 canonical privacy administration',()=>{
  it('creates and replays the exact native incident, and reads it with the current role',async()=>{
    const r=await create(),writes=h.fs.writeOps.length;expect(r).toMatchObject({protocol:'privacy_incident_creation_v1',actorUid:'admin'});
    expect((await create()).replay).toBe(true);expect(h.fs.writeOps).toHaveLength(writes);
    const list=await call(getPrivacyIncidentsLog,{incidentId:r.incidentId});expect(JSON.stringify(list)).toContain(r.incidentId);
    expect(h.fs.getDoc('privacy_incidents/'+r.incidentId)?.notifiedCAI).toBe(false);
  });
  it('records an operator-declared external CAI action without pretending the application sent it',async()=>{
    const incident=await create(),payload={mode:'execute',expectedAdminUid:'admin',requestId:'cai_request_1234567890',incidentId:incident.incidentId,
      notifiedAt:new Date(Date.now()-1000).toISOString(),channel:'cai_secure_form',caiReference:'synthetic-reference',evidenceReference:'synthetic-evidence'};
    const r=await call(escalatePrivacyIncidentToCAI,payload);expect(r).toMatchObject({protocol:'privacy_cai_external_v1',externalActionDeclared:true,sentByApplication:false});
    const writes=h.fs.writeOps.length;expect((await call(escalatePrivacyIncidentToCAI,payload)).replay).toBe(true);expect(h.fs.writeOps).toHaveLength(writes);
  });
  it('commits one in-app notice with a native receipt and never claims device delivery',async()=>{
    const incident=await create(),payload={mode:'execute',expectedAdminUid:'admin',requestId:'notice_request_12345678',incidentId:incident.incidentId,
      messageVersion:'synthetic-v1',message:'Avis synthétique sans donnée réelle.'};
    const r=await call(notifyAffectedUsers,payload);expect(r).toMatchObject({protocol:'privacy_user_notices_v1',inAppCommitted:true,complete:true,
      inAppCommittedCount:1,pendingCount:0,deviceDeliveryVerified:false,readingVerified:false});
    const writes=h.fs.writeOps.length;await call(notifyAffectedUsers,payload);expect(h.fs.writeOps).toHaveLength(writes);
    expect(h.fs.writeOps.filter(v=>v.method==='create'&&v.path.startsWith('notifications/'))).toHaveLength(1);
  });
  it('keeps a fenced recipient pending without recreating a notice after erasure admission',async()=>{
    const incident=await create();h.fs.setDoc('eligibility_profiles/recipient',{accountErasureFence:null});
    const r=await call(notifyAffectedUsers,{mode:'execute',expectedAdminUid:'admin',requestId:'notice_fenced_12345678',incidentId:incident.incidentId,
      messageVersion:'synthetic-v1',message:'Avis synthétique sans donnée réelle.'});
    expect(r).toMatchObject({complete:false,inAppCommittedCount:0,pendingCount:1});expect(h.fs.writeOps.filter(v=>v.path.startsWith('notifications/'))).toHaveLength(0);
  });
  it.each(['role','actor-fence'])('refuses %s before creating an incident or returning its private body',async kind=>{
    if(kind==='role'){h.admin=false;h.fs.setDoc('users/admin',{isActive:true,isAdmin:false});}
    else h.fs.setDoc('eligibility_profiles/admin',{accountErasureFence:null});
    await expect(create()).rejects.toBeDefined();await expect(call(getPrivacyIncidentsLog,{})).rejects.toBeDefined();expect(h.fs.writeOps).toHaveLength(0);
  });
});
