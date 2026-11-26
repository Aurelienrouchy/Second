'use strict';
/** Release guard, also reached by Firebase predeploy via `npm run build`.
 * Read only: never rewrites/adopts a changed writer or loads the Firebase app. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const ts = require('typescript');
const sdk = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'functions/src/utils/globalControlBalance.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]);
const declaration = name => {const d = declarations.find(d => d.name.getText(source) === name);if (!d?.initializer) throw Error('Missing canonical ' + name);return d.initializer;};
const literal = name => {let n = declaration(name);if (ts.isAsExpression(n)) n = n.expression;return JSON.parse(n.getText(source));};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verifyModules(modules, label) {
  if (!Array.isArray(modules) || !modules.length || new Set(modules.map(m => m.path)).size !== modules.length) throw Error('Invalid modules: ' + label);
  for (const m of modules) {
    const canonicalPolicy = ['functions/src/shared/sellerActivityPolicy.json', 'functions/src/shared/signupConsentPolicy.json'].includes(m.path);
    if (typeof m.path !== 'string' || !canonicalPolicy && !/^functions\/src\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.ts$/.test(m.path) || !/^[a-f0-9]{64}$/.test(m.sha256)) throw Error('Invalid module: ' + label);
    if (canonicalPolicy) JSON.parse(fs.readFileSync(path.join(root, m.path), 'utf8'));
    if (sha(fs.readFileSync(path.join(root, m.path))) !== m.sha256) throw Error('Writer/control changed: ' + m.path);
  }
}
try {
  const writers = literal('GLOBAL_CONTROL_WRITER_REGISTRY'), controls = literal('GLOBAL_CONTROL_WRITER_CONTROL_MODULES');
  if (!Array.isArray(writers) || !writers.length || new Set(writers.map(w => w.writerId)).size !== writers.length) throw Error('Invalid writer registry');
  for (const w of writers) {
    verifyModules(w.modules, w.writerId);
    if (sha(JSON.stringify(w.modules)) !== w.revisionHash) throw Error('Writer revision mismatch: ' + w.writerId);
    if (!Array.isArray(w.sourceClassIds) || !w.sourceClassIds.length || new Set(w.sourceClassIds).size !== w.sourceClassIds.length) throw Error('Invalid writer classes: ' + w.writerId);
  }
  verifyModules(controls, 'shared controls');
  const hashExpression = declaration('GLOBAL_CONTROL_WRITER_REGISTRY_HASH').getText(source).replace(/\s+/g, '');
  if (hashExpression !== 'supportSourceHash({writers:GLOBAL_CONTROL_WRITER_REGISTRY,controls:GLOBAL_CONTROL_WRITER_CONTROL_MODULES})') throw Error('Registry hash must bind exact writers and controls');
  // Run ONLY the actual pure hash declaration; no app, credentials or provider
  // is initialized. This avoids a second hand-written canonical hash format.
  const hashSource = ts.createSourceFile('supportRequest.ts', fs.readFileSync(path.join(root, 'functions/src/utils/supportRequest.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const hashNode = hashSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'supportSourceHash');
  if (!hashNode) throw Error('Native source hash unavailable');
  const emitted = ts.transpileModule(hashNode.getText(hashSource), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  const exports = {};
  new Function('exports', 'createHash', 'HttpsError', 'DocumentReference', 'GeoPoint', 'Timestamp', 'VectorType', emitted)(exports, createHash, HttpsError, sdk.DocumentReference, sdk.GeoPoint, sdk.Timestamp, sdk.FieldValue.vector([]).constructor);
  const registryHash = exports.supportSourceHash({writers, controls});
  if (!/^[a-f0-9]{64}$/.test(registryHash)) throw Error('Invalid canonical registry hash');
  console.log('Financial writer registry verified: ' + registryHash);
} catch (error) {
  console.error('Financial writer registry BLOCKED. Review and refresh the canonical code manifest before building: ' + error.message);
  process.exitCode = 1;
}
