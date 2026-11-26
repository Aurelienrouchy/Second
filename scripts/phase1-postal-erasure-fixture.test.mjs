import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {postalErasurePaths, terminalPostalProof} from './phase1-postal-erasure-fixture.mjs';
const runId='0f76d8514c964d9eb14adcec2a43b2de',photo='894ddaa7-e07e-4b2c-9c53-8083fbc22ef8',late='1ab9f2bb-f963-4721-b788-852f4a940a24';
const context={swapId:'native-swap',ownerId:'owner',peerId:'peer',installationId:'phase1_dev_test',bucket:'seconde-dev.firebasestorage.app',bytes:12345};
const time=n=>({toMillis:()=>n});
function source(){
  const proof=(uid)=>{const path=`swaps/native-swap/photos/${uid}/0_${photo}.jpg`;return{userId:uid,isValidated:false,uploadedAt:time(2000),
    photos:[`https://firebasestorage.googleapis.com/v0/b/${context.bucket}/o/${encodeURIComponent(path)}?alt=media`],
    objects:[{path,generation:'12',crc32c:'AAAAAA==',contentType:'image/jpeg',size:12345}]};};
  return{status:'completed',exchangeMode:'shipping',initiatorId:'owner',receiverId:'peer',cashTopUp:null,
    acceptedAt:time(1000),completedAt:time(5000),initiatorShippedAt:time(3000),receiverShippedAt:time(3000),initiatorReceivedAt:time(4000),receiverReceivedAt:time(5000),
    initiatorPhotos:proof('owner'),receiverPhotos:proof('peer'),localAgreementWitness:{protocol:'local_agreement_source_v1',installationId:context.installationId,
      financialSettlement:'not_asserted',ref:'swaps/native-swap',nativeSourceHash:'a'.repeat(64)}};
}
test('three distinct exact namespaces separate contractual proof, admitted SDK task and operator Eventarc',()=>{
  const p=postalErasurePaths(context.swapId,context.ownerId,runId,photo,late);
  assert.equal(new Set(Object.values(p)).size,3);assert(Object.values(p).every(v=>v.startsWith('swaps/native-swap/photos/owner/')));
  assert.throws(()=>postalErasurePaths('../other','owner',runId,photo,late));
  assert.throws(()=>postalErasurePaths('native-swap','owner',runId,photo,photo));
});
test('terminal postal proof captures both immutable owner-scoped generations',()=>{
  const result=terminalPostalProof(source(),context);assert.equal(result.ownerObjects[0].generation,'12');
  assert.equal(result.peerObjects[0].path,`swaps/native-swap/photos/peer/0_${photo}.jpg`);assert.equal(result.completedAt,5000);
});
test('preserves valid native fractional-millisecond timestamp chronology',()=>{
  const s=source();s.acceptedAt=time(1000.125);s.completedAt=time(5000.875);
  assert.equal(terminalPostalProof(s,context).completedAt,5000.875);
});
for(const [name,change]of[
 ['unfinished',s=>s.status='shipping'],['money',s=>s.cashTopUp={amount:1}],['financial-witness',s=>s.financialRecoveryWitness=null],
 ['wrong-participant',s=>s.receiverId='foreign'],['wrong-installation',s=>s.localAgreementWitness.installationId='other'],
 ['missing-shipment',s=>delete s.receiverShippedAt],['missing-reception',s=>delete s.initiatorReceivedAt],
 ['changed-owner-path',s=>s.initiatorPhotos.objects[0].path=s.receiverPhotos.objects[0].path],
 ['changed-generation',s=>s.initiatorPhotos.objects[0].generation='0'],['bad-mime',s=>s.initiatorPhotos.objects[0].contentType='application/octet-stream'],
 ['bearer-token',s=>s.initiatorPhotos.photos[0]+='&token=not-accepted'],['missing-peer-proof',s=>s.receiverPhotos.objects=[]],
 ['future-terminal',s=>s.completedAt=time(Date.now()+60000)]
])test(`refuses ${name} without attesting retention`,()=>{const s=source();change(s);assert.throws(()=>terminalPostalProof(s,context));});
test('postal mode prepares without cloud flags and cannot combine two completed fixtures',()=>{
 const args=['scripts/smoke-phase1-dev.mjs','--fresh-erasure-only','--completed-postal-erasure'];
 const prepared=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
 const result=JSON.parse(prepared.stdout);assert.equal(result.cloudActions,0);assert.equal(result.aliases,36);assert.equal(result.completedPostalErasure,true);
 assert(result.stages.includes('completed-postal-agreement-before-erasure'));
 assert.notEqual(spawnSync(process.execPath,[...args,'--completed-local-erasure'],{stdio:'ignore'}).status,0);
 assert.notEqual(spawnSync(process.execPath,['scripts/smoke-phase1-dev.mjs','--completed-postal-erasure'],{stdio:'ignore'}).status,0);
});
