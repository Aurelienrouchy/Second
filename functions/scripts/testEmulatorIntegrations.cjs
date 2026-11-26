'use strict';
/** Explicit local SDK integration runner. It never starts an emulator, loads
 * dotenv, changes a cloud target or invokes a deployed function. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),core=args[0]==='--v1-core';
if(args.length>(core?1:0))throw Error('Usage: testEmulatorIntegrations.cjs [--v1-core]');
if(process.env.GCLOUD_PROJECT!=='demo-second')throw Error('Explicit demo-second emulator project required.');
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])
  if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name]??''))throw Error('Explicit loopback emulator required: '+name);
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  const target=path.join(folder,entry.name);return entry.isDirectory()?walk(target):target.endsWith('.emulator.test.ts')?[target]:[];
});
const all=walk(path.join(root,'src'));if(all.length!==17)throw Error('Review the explicit 17-suite integration inventory before running.');
const flags=new Set(all.flatMap(file=>[...fs.readFileSync(file,'utf8').matchAll(/process\.env\.(SECOND[A-Z0-9_]+)\s*===\s*['"]1/g)].map(m=>m[1])));
if(flags.size!==11)throw Error('Review the native SDK opt-in inventory before running.');
const coreNames=new Set(['callable/offers.emulator.test.ts','utils/articleSwapEngagement.emulator.test.ts',
  'callable/eligibility.emulator.test.ts','callable/eligibility.nativeCopy.emulator.test.ts',
  'callable/eligibilityTradeGuards.emulator.test.ts','callable/eligibilityTradeGuardsV2.emulator.test.ts']);
const files=(core?all.filter(file=>coreNames.has(path.relative(path.join(root,'src'),file))):all).map(file=>path.relative(root,file));
if(core&&files.length!==6)throw Error('Missing V1 core native integration suite.');
const environment={...process.env,GCP_PROJECT:'demo-second',GOOGLE_CLOUD_PROJECT:'demo-second',SECONDE_PROJECT_ID:'demo-second',
  SECONDE_ENV:'development',METADATA_SERVER_DETECTION:'none',FIREBASE_CONFIG:JSON.stringify({projectId:'demo-second',storageBucket:'demo-second.appspot.com'}),
  ...Object.fromEntries([...flags].map(flag=>[flag,'1']))};
console.log(JSON.stringify({project:'demo-second',selectedSuites:files.length,sdkOptIns:flags.size,core,cloud:false}));
const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run',...files,'--fileParallelism=false'],
  {cwd:root,env:environment,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
