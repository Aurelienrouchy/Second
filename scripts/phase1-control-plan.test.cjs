'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseArgs,buildControlPlan}=require('./phase1-control-plan.cjs');
const input={project:'prod',bucket:'seconde-independent-test','runtime-service-account':'runtime@seconde-b47a6.iam.gserviceaccount.com','installation-id':'test-install','epoch':'initial-test'};
test('requires explicit identities and refuses app buckets or mutation flags',()=>{
  assert.throws(()=>buildControlPlan({}));assert.throws(()=>buildControlPlan({...input,bucket:'seconde-b47a6.firebasestorage.app'}));
  assert.throws(()=>parseArgs(['--project','prod','--deploy','true']));
  assert.throws(()=>buildControlPlan({...input,'installation-id':'..'}));
  assert.throws(()=>buildControlPlan({...input,epoch:'unsafe:epoch'}));
});
test('initial control never qualifies restored data or opens itself',()=>{
  const plan=buildControlPlan(input);assert.equal(plan.proposedControl.mode,'draining');assert.equal(plan.proposedControl.reconciliationManifest,null);
  assert.equal(plan.proposedControl.stripePlatformAccountId,null);assert.equal(plan.existingSourcesQualified,false);assert.equal(plan.activationPerformed,false);
  assert.equal(plan.controlUpload.precondition.ifGenerationMatch,0);
});
test('runtime roles contain only exact control get and permit create, never mutate control or list evidence',()=>{
  const plan=buildControlPlan(input),commands=plan.commandsForIndependentOperator;
  const permissions=commands.filter(c=>c.includes('--permissions')).map(c=>c[c.indexOf('--permissions')+1]);
  assert.deepEqual(permissions,['storage.objects.get','storage.objects.create']);
  const bindings=commands.filter(c=>c.includes('--condition')).map(c=>c[c.indexOf('--condition')+1]);
  assert.ok(bindings[0].includes("resource.name == 'projects/_/buckets/seconde-independent-test/objects/control/current.json'"));
  assert.ok(bindings[1].includes('/installations/test-install/permits/'));assert.ok(!bindings[1].includes('control/current'));
  assert.ok(commands.every(c=>c.includes('--project')&&c[c.indexOf('--project')+1]==='seconde-b47a6'));
});
