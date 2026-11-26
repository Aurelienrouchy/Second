'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projects = require('../config/firebaseProjects.json');

if (projects.development.projectId === projects.production.projectId) {
  throw new Error('Le projet de développement doit être séparé de la production.');
}
const emulator = process.argv.includes('--emulators');
const phase1Qa = process.argv.includes('--phase1');
if (emulator && phase1Qa) {
  throw new Error('Le profil phase 1 utilise exclusivement Seconde Dev distant, sans émulateurs.');
}
const args = [];
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--emulators' || argument === '--phase1' || argument === '--dev-client') continue;
  if (argument === '--go' || argument === '--no-dev-client') {
    throw new Error('Seconde Dev utilise son application de développement installée.');
  }
  if (argument === '--scheme' || argument.startsWith('--scheme=')) {
    const scheme = argument === '--scheme' ? process.argv[++index] : argument.slice('--scheme='.length);
    if (scheme !== 'seconde-dev') {
      throw new Error('Le lancement local ouvre exclusivement le lien seconde-dev.');
    }
    continue;
  }
  args.push(argument);
}
const tunnelEnvironment = {};
if (args.includes('--tunnel') && process.platform === 'darwin') {
  const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
  if (fs.existsSync(androidSdk) && !fs.existsSync(path.join(androidSdk, 'platform-tools/adb'))) {
    // Expo checks for the SDK folder, then crashes if adb itself is missing.
    // Restrict this override to the tunnel subprocess; leave the host SDK intact.
    const unavailableSdk = path.join(os.tmpdir(), `seconde-dev-no-adb-${process.pid}`);
    tunnelEnvironment.ANDROID_HOME = unavailableSdk;
    tunnelEnvironment.ANDROID_SDK_ROOT = unavailableSdk;
  }
}
console.log(`[Seconde Dev] Firebase : ${emulator ? 'demo-second (émulateurs)' : projects.development.projectId}`);
if (phase1Qa) console.log('[Seconde Dev] Recette phase 1 : paiements, livraison et outils commerciaux fermés.');
const child = spawn(process.execPath, [path.join(__dirname, '../node_modules/expo/bin/cli'), 'start', '--dev-client', '--scheme', 'seconde-dev', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...tunnelEnvironment,
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_FIREBASE_EMULATORS: emulator ? '1' : '0',
    EXPO_PUBLIC_PHASE1_QA: phase1Qa ? 'true' : 'false',
    EXPO_PUBLIC_PAYMENTS_ENABLED: emulator || phase1Qa ? 'false' : 'true',
    EXPO_PUBLIC_SHIPPING_ENABLED: emulator || phase1Qa ? 'false' : 'true',
    EXPO_PUBLIC_COMMERCE_TEST_MODE: emulator || phase1Qa ? 'false' : 'true',
    EXPO_RUN_PREFER_APP_CONFIG_ID: '1',
  },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1); });
