/** Explicit targets for local Admin scripts. Never discover a production key. */
const fs = require('node:fs');

const DEV_PROJECT = 'seconde-dev';
const PROD_PROJECT = 'seconde-b47a6';
const DEMO_PROJECT = 'demo-second';

function resolveAdminTarget({ env = process.env, allowProduction = false } = {}) {
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (emulator && !/^(?:localhost|127\.0\.0\.1|\[::1\]):(?:[1-9]\d{0,4})$/.test(env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('Firestore emulator must use an explicit loopback host and port.');
  }
  const projectId = env.GCLOUD_PROJECT?.trim() || (emulator ? DEMO_PROJECT : DEV_PROJECT);
  if (emulator ? projectId !== DEMO_PROJECT : projectId !== DEV_PROJECT && !(allowProduction && projectId === PROD_PROJECT)) {
    throw new Error('This script target is forbidden: synthetic seeds use dev/demo; production imports require explicit GCLOUD_PROJECT.');
  }
  for (const name of ['GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'SECONDE_PROJECT_ID']) {
    if (env[name]?.trim() && env[name].trim() !== projectId) throw new Error(`${name} does not match the script target.`);
  }
  if (env.SECONDE_ENV && (env.SECONDE_ENV !== 'development' && env.SECONDE_ENV !== 'production' ||
      (env.SECONDE_ENV === 'production') !== (projectId === PROD_PROJECT))) {
    throw new Error('SECONDE_ENV does not match the script target.');
  }
  const bucket = `${projectId}.${emulator ? 'appspot.com' : 'firebasestorage.app'}`;
  if (env.FIREBASE_CONFIG?.trim()) {
    if (!env.FIREBASE_CONFIG.trim().startsWith('{')) throw new Error('FIREBASE_CONFIG must be an inline JSON object.');
    const config = JSON.parse(env.FIREBASE_CONFIG);
    if (config.projectId !== undefined && config.projectId !== projectId || config.storageBucket !== undefined &&
        ![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(config.storageBucket)) {
      throw new Error('FIREBASE_CONFIG does not match the script target.');
    }
  }
  return { projectId, storageBucket: bucket, emulator };
}

function initializeScriptAdmin(admin, { env = process.env, allowProduction = false } = {}) {
  const target = resolveAdminTarget({ env, allowProduction });
  let serviceAccount;
  // Only an explicitly selected file is read. Legacy production keys lying in
  // the checkout are never auto-selected. ADC receives an explicit dev target.
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credential = JSON.parse(fs.readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    if (credential.type === 'service_account' || credential.project_id !== undefined) {
      if (credential.project_id !== target.projectId) throw new Error('Service account project does not match the script target.');
      serviceAccount = credential;
    }
  }
  if (admin.apps.some(app => app && (app.options.projectId !== target.projectId || app.options.storageBucket !== target.storageBucket))) {
    throw new Error('An existing Admin app belongs to another or unqualified target.');
  }
  if (!admin.apps.length) {
    const options = { projectId: target.projectId, storageBucket: target.storageBucket };
    if (!target.emulator) options.credential = serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault();
    admin.initializeApp(options);
  }
  return target;
}

module.exports = { resolveAdminTarget, initializeScriptAdmin };
