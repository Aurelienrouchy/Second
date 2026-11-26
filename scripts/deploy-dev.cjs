'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const manifest = require('../functions/dev-deploy.json');
const name = process.argv[2] || 'catalogue_account_and_photo_ai';
if (process.argv.length > 3 || manifest.projectId !== 'seconde-dev') {
  throw new Error('Ce script déploie uniquement les paquets nommés de Seconde Dev.');
}
const selected = manifest.packages.find(entry => entry.name === name);
if (!selected || selected.names.some(fn => !/^[A-Za-z][A-Za-z0-9_]*$/.test(fn))) {
  throw new Error('Paquet dev inconnu. Consultez functions/dev-deploy.json.');
}
console.log(`[Seconde Dev] Déploiement ${selected.name} : ${selected.names.length} fonctions, projet seconde-dev.`);
const child = spawn('npx', ['-y', 'firebase-tools@latest', 'deploy',
  '--config', 'firebase.dev.json', '--project', 'seconde-dev',
  '--only', selected.names.map(fn => `functions:${fn}`).join(','), '--non-interactive'], {
  cwd: path.join(__dirname, '..'), stdio: 'inherit', env: process.env,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1); });
