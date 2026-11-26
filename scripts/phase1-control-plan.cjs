'use strict';
/** Offline review material only. No cloud command, IAM change, object creation,
 * financial reconciliation or activation is executed by this program. */
const targets={dev:'seconde-dev',prod:'seconde-b47a6'};
function parseArgs(args) {
  const values={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]?.replace(/^--/,'');
    if(!['project','bucket','runtime-service-account','installation-id','epoch'].includes(key)||!args[i+1]||Object.hasOwn(values,key))throw Error('Options exactes : --project dev|prod --bucket NOM --runtime-service-account COMPTE --installation-id ID --epoch ID');
    values[key]=args[i+1];
  }
  return values;
}
function buildControlPlan(options) {
  const projectId=targets[options.project],bucket=options.bucket,account=options['runtime-service-account'],installationId=options['installation-id'],epoch=options.epoch;
  // These values also become path segments of append-only permit objects.
  const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
  if(!projectId||!token(installationId)||!token(epoch)||typeof bucket!=='string'||!/^[a-z0-9][a-z0-9._-]{2,220}$/.test(bucket)||
    /(?:\.appspot\.com|\.firebasestorage\.app)$/.test(bucket)||typeof account!=='string'||
    !/^[A-Za-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(account))throw Error('Projet, bucket indépendant, identités exactes et epoch requis.');
  const controlObject='control/current.json',prefix=`installations/${installationId}`;
  const resource=`projects/_/buckets/${bucket}/objects/`,member=`serviceAccount:${account}`;
  const reader=`projects/${projectId}/roles/phase1ControlReader`,creator=`projects/${projectId}/roles/phase1PermitCreator`;
  const command=(...argv)=>argv;
  return {
    protocol:'phase1_initial_control_review_v1',readOnly:true,activationPerformed:false,initializationPerformed:false,
    financialReconciliationAsserted:false,existingSourcesQualified:false,
    prerequisites:['Verify this is an initial installation, not a restore or a replacement of an existing control.',
      'Verify the independently administered bucket and actual runtime service account; review inherited IAM too.',
      'The proposed control is draining. A separately reviewed generation-matched operator update is required to open normal mode after verification.'],
    environment:{FINANCIAL_RECOVERY_BUCKET:bucket,FINANCIAL_RECOVERY_CONTROL_OBJECT:controlObject,FINANCIAL_RECOVERY_PREFIX:prefix,
      FINANCIAL_RECOVERY_INSTALLATION_ID:installationId,FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID:projectId,FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID:'(default)',
      FINANCIAL_RECOVERY_ENVIRONMENT:'unconfigured'},
    proposedControl:{protocol:'financial_recovery_control_v1',installationId,firestoreProjectId:projectId,firestoreDatabaseId:'(default)',
      financialEnvironment:'unconfigured',stripePlatformAccountId:null,epoch,mode:'draining',previousEpoch:null,reconciliationManifest:null,
      businessAdmission:{protocol:'business_admission_control_v1',state:'open',planId:null}},
    // Commands are argv arrays for review; never fed to a shell or executed.
    commandsForIndependentOperator:[
      command('gcloud','storage','buckets','create',`gs://${bucket}`,'--project',projectId,'--location','northamerica-northeast1','--uniform-bucket-level-access','--public-access-prevention'),
      command('gcloud','iam','roles','create','phase1ControlReader','--project',projectId,'--title','Phase 1 control reader','--permissions','storage.objects.get','--stage','GA'),
      command('gcloud','iam','roles','create','phase1PermitCreator','--project',projectId,'--title','Phase 1 permit creator','--permissions','storage.objects.create','--stage','GA'),
      command('gcloud','storage','buckets','add-iam-policy-binding',`gs://${bucket}`,'--project',projectId,'--member',member,'--role',reader,
        '--condition',`title=phase1-control-read,expression=resource.type == 'storage.googleapis.com/Object' && resource.name == '${resource}${controlObject}'`),
      command('gcloud','storage','buckets','add-iam-policy-binding',`gs://${bucket}`,'--project',projectId,'--member',member,'--role',creator,
        '--condition',`title=phase1-permit-create,expression=resource.type == 'storage.googleapis.com/Object' && resource.name.startsWith('${resource}${prefix}/permits/')`),
    ],
    controlUpload:{operatorOnly:true,precondition:{ifGenerationMatch:0},destination:`gs://${bucket}/${controlObject}`,
      requiredInput:'A reviewed JSON file containing proposedControl; never overwrite an existing installation.'},
    requiredNegativeChecks:['Runtime cannot create/replace the control, list/read permits, update/delete any object or create outside its permit prefix.',
      'Runtime can read the exact control generation and create one new permit; overwrite of the same permit is refused.',
      'Draining refuses mutations. Normal mode and business admission must be checked with a real phase1 call and its native receipt.'],
    references:['https://docs.cloud.google.com/storage/docs/access-control/iam','https://docs.cloud.google.com/storage/docs/access-control/iam-permissions'],
  };
}
if(require.main===module){try{console.log(JSON.stringify(buildControlPlan(parseArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={parseArgs,buildControlPlan};
