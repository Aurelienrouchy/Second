/** Native transaction adapter. Business writes are staged until the subject
 * counters have been read; counters and effects then use ONE native commit.
 * A counter is an invalidation signal, never a baseline or a restore permit. */
import {createHash} from 'node:crypto';
import {Timestamp, FieldValue} from 'firebase-admin/firestore';
import {activeLocalAgreementScope,assertLocalAgreementMutation,assertLocalCashDecision,localCashCaseFields,localOperationAllows,localServerTimestamps} from './localAgreement';
import {activeLocalCatalogueScope,assertCatalogueFinancialIsolation,assertLocalCatalogueMutation,localCatalogueDomainAt,withLocalCatalogueTransaction} from './localCatalogue';
import {activeArticlePrivacyScope,articlePrivacyEffectRef,articlePrivacyNativePlan,assertArticlePrivacyMarkers,assertArticlePrivacyPublicMarker} from './localArticlePrivacy';
import {assertFinancialRecoveryEffect} from './financialRecoveryInterlock';
import {activeDocumentaryProjection,captureDocumentaryRead,documentaryProjectionNativePlan,withDocumentaryProjectionAttempt} from './documentaryProjection';
import {activeAccountErasureScope,accountErasureNativePlan} from './accountErasureScope';
import {hasAccountErasureFence} from './accountErasureContract';
import {privacyRetentionDecision} from './privacyRetention';
import {qualifyRateLimitTransaction} from './rateLimitScope';

type Data = FirebaseFirestore.DocumentData;
type Write = {method: 'create'|'set'|'update'|'delete'; args: any[]};
const installed = new WeakSet<object>();
const own=(value:unknown,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
const plain=(value:unknown):value is Record<string,any>=>value!==null&&typeof value==='object'&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const fieldParts=(value:unknown):string[]|null=>typeof value==='string'&&value.split('.').every(part=>
  /^[A-Za-z0-9_-]+$/.test(part)&&!['__proto__','constructor','prototype'].includes(part))?value.split('.'):null;
/** The local proof supports only explicit object patches. Reject unknown SDK
 * overloads BEFORE inspecting their internals or projecting a partial write. */
function assertLocalWriteSignature(write:Write):void {
  const fail=():never=>{throw new Error('Unsupported local agreement write signature or field selection.');};
  const args=write.args;
  if(write.method==='delete'){if(args.length!==1)fail();return;}
  if((write.method==='create'||write.method==='update')?args.length!==2:args.length<2||args.length>3)fail();
  const data=args[1];
  if(!plain(data))fail();
  if(Reflect.ownKeys(data).some(key=>typeof key!=='string'||!fieldParts(key)||
      write.method!=='update'&&key.includes('.')||!own(Object.getOwnPropertyDescriptor(data,key)??{},'value')))fail();
  if(write.method!=='set'||args[2]===undefined)return;
  const options=args[2];
  if(!plain(options)||Reflect.ownKeys(options).some(key=>key!=='merge'&&key!=='mergeFields')||
      own(options,'merge')&&own(options,'mergeFields'))fail();
  if(own(options,'merge')&&typeof options.merge!=='boolean')fail();
  // Recursive merge semantics are not approximated as a shallow replacement.
  // Supported local merges are flat, or use an explicit string field mask.
  if(options.merge===true&&Object.values(data).some(plain))fail();
  if(own(options,'mergeFields')) {
    const selected=options.mergeFields;
    if(!Array.isArray(selected)||!selected.length)fail();
    const paths:string[][]=[];
    for(const key of selected) {
      const parts=fieldParts(key);if(!parts)fail();
      // A selected missing value, FieldPath or native instance is unknown;
      // it must never disappear from the projected after-state.
      let value:any=data;
      for(const part of parts!) {
        if(!plain(value)||!own(value,part)||!own(Object.getOwnPropertyDescriptor(value,part)??{},'value'))fail();
        value=value[part];
      }
      if(value===undefined)fail();
      if(paths.some(prior=>prior.every((p,i)=>parts![i]===p)||parts!.every((p,i)=>prior[i]===p)))fail();
      paths.push(parts!);
    }
  }
}
export const financialSubjectHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Timestamp)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const uid = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 128 && !value.includes('/');
export const financialSubjectGuardRef = (db: FirebaseFirestore.Firestore, ownerId: string) => db.collection('financial_subject_guards').doc(financialSubjectHash(ownerId));
export async function readFinancialSubjectCounter(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, ownerId: string) {
  const snapshot = await tx.get(financialSubjectGuardRef(db, ownerId)), value = snapshot.data();
  const known = !snapshot.exists || value?.protocol === 'financial_subject_counter_v1' && value.ownerId === ownerId &&
    Number.isSafeInteger(value.version) && value.version > 0 && value.version < Number.MAX_SAFE_INTEGER &&
    value.recordedAt instanceof Timestamp && value.recordedAt.toMillis() > 0 && value.recordedAt.toMillis() <= Date.now() &&
    typeof value.originHash === 'string' && /^[a-f0-9]{64}$/.test(value.originHash) &&
    value.priorUnqualifiedSourceHash === null &&
    value.baselineAutomaticallyQualified === false;
  return {protocol: 'financial_subject_counter_view_v1', ownerId, exists: snapshot.exists, known,
    version: !snapshot.exists ? 0 : Number.isSafeInteger(value?.version) && value!.version > 0 && value!.version < Number.MAX_SAFE_INTEGER ? value!.version : null,
    originHash: typeof value?.originHash === 'string' && /^[a-f0-9]{64}$/.test(value.originHash) ? value.originHash : financialSubjectHash({ownerId, state: snapshot.exists ? 'unknown_counter' : 'native_counter_absent', priorSourceHash: financialSubjectHash(value ?? null)}),
    sourceHash: financialSubjectHash(value ?? null), baselineAutomaticallyQualified: false};
}
function patch(before: Data|undefined, write: Write): Data|undefined {
  if (write.method === 'delete') return undefined;
  const values = write.args[1];
  if (!plain(values) || write.method==='update'&&write.args.length!==2) return undefined;
  // Nonlocal callers retain native SDK overloads; their unmodelled after-state
  // is UNKNOWN, never a partially filtered projection. Local callers reject
  // these signatures before reaching this function.
  if(write.method==='set'&&Array.isArray(write.args[2]?.mergeFields)&&write.args[2].mergeFields.some((key:unknown)=>typeof key!=='string'))return undefined;
  const next: Data = write.method === 'create' || write.method === 'set' && !write.args[2]?.merge && !write.args[2]?.mergeFields ? {} : {...before};
  const fields = write.method === 'set' && Array.isArray(write.args[2]?.mergeFields)
    ? write.args[2].mergeFields.map((key: string) => {
      let selected: any = values; for (const part of key.split('.')) selected = selected?.[part]; return [key, selected];
    }) : Object.entries(values);
  for (const [key, value] of fields) {
    const parts = key.split('.'); let target = next;
    for (const part of parts.slice(0, -1)) target = target[part] = {...target[part]};
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = value;
  }
  return next;
}
/** The singleton installs this once. No callback, SDK read, assertion, provider
 * request or result is replayed by the flush; only its staged native writes. */
export function installFinancialSubjectTransactions(database: FirebaseFirestore.Firestore): void {
  if (installed.has(database)) return;
  installed.add(database);
  const original = database.runTransaction.bind(database);
  (database as any).runTransaction = (callback: (tx: FirebaseFirestore.Transaction) => Promise<any>, options?: any) => original(native => withLocalCatalogueTransaction(()=>withDocumentaryProjectionAttempt(async () => {
    const writes: Write[] = []; let accepting = true;
    const admissionAttempt={};
    const documentaryAt=Timestamp.now();
    const wrapped = new Proxy(native, {get(target, key) {
      if(key===Symbol.for('seconde.admission_refusal_native_attempt'))return admissionAttempt;
      if (['create', 'set', 'update', 'delete'].includes(String(key))) return (...args: any[]) => {
        if (!accepting) throw new Error('Native transaction callback already completed.');
        if (options?.readOnly === true) throw new Error('Firestore read-only transactions cannot execute writes.');
        const write={method:key as Write['method'],args};
        if(activeAccountErasureScope()||activeLocalAgreementScope()||activeLocalCatalogueScope()||activeArticlePrivacyScope()||activeDocumentaryProjection()||
          process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'&&localCatalogueDomainAt(args[0]?.path??''))assertLocalWriteSignature(write);
        if(activeDocumentaryProjection()&&write.method!=='delete')write.args[1]=localServerTimestamps(write.args[1],documentaryAt);
        writes.push(write); return wrapped;
      };
      const value = (target as any)[key];
      if (['get', 'getAll'].includes(String(key))) return async (...args: any[]) => {
        if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
        const result=await value.apply(target,args);captureDocumentaryRead(result);return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    const result = await callback(wrapped); accepting = false;
    if(qualifyRateLimitTransaction(writes)){
      const write=writes[0];(native[write.method] as any)(...write.args);return result;
    }
    if(activeLocalAgreementScope()){
      const {qualifyAdmissionRefusalTransaction}=await import('./admissionDecision');
      if(await qualifyAdmissionRefusalTransaction(admissionAttempt,writes,native)){
        for(const write of writes)(native[write.method] as any)(...write.args);
        return result;
      }
    }
    const owners = new Set<string>(), unknownPaths = new Set<string>(), snapshots = new Map<string, Data|undefined>();
    const nativeSnapshots=new Map<string,FirebaseFirestore.DocumentSnapshot>();
    const currentSnapshot=async(path:string)=>{
      if(!nativeSnapshots.has(path))nativeSnapshots.set(path,await native.get(database.doc(path)));
      return nativeSnapshots.get(path)!;
    };
    const current = async (path: string) => {
      if (!snapshots.has(path)) snapshots.set(path, (await currentSnapshot(path)).data());
      return snapshots.get(path);
    };
    if(activeArticlePrivacyScope()&&writes.length)await assertFinancialRecoveryEffect('firestore_commit',{refs:[articlePrivacyEffectRef()]});
    const privacyPlan=await articlePrivacyNativePlan(database,writes,currentSnapshot,patch);
    const documentaryPlan=await documentaryProjectionNativePlan(database,writes,currentSnapshot,async articleId=>
      (await native.get(database.collection('favorites').where('articleIds','array-contains',articleId).count())).data().count,native);
    const erasurePlan=await accountErasureNativePlan(writes,currentSnapshot,async()=>
      privacyRetentionDecision(native,activeAccountErasureScope()!.ownerId),patch,async articleId=>{
        const [orders,swaps]=await Promise.all([native.get(database.collection('transactions').where('articleId','==',articleId).limit(1)),
          native.get(database.collection('swaps').where('articleIds','array-contains',articleId).limit(101))]);
        return !orders.empty||swaps.size>100||swaps.docs.some(d=>d.data().acceptedAt!=null);
      });
    const add = (value: unknown, path: string) => {if (uid(value)) owners.add(value); else unknownPaths.add(path);};
    const parties = async (value: Data|undefined, path: string, fields: string[], parent?: string) => {
      if (!value) return;
      for (const field of fields) add(value[field], path);
      if (parent) {
        const selected = await current(parent);
        if (!selected) unknownPaths.add(path);
        else for (const field of fields) {add(selected[field], path); if (value[field] !== selected[field]) unknownPaths.add(path);}
      }
    };
    for (const write of writes) {
      const path = write.args[0]?.path;
      if (typeof path !== 'string') throw new Error('Native document reference required.');
      const a = path.split('/'), root = a[0];
      const privacyWrite=privacyPlan.has(write);
      const documentaryWrite=documentaryPlan.has(write);
      if(erasurePlan.has(write))continue;
      if(!privacyWrite&&!documentaryWrite&&['messages','chats'].includes(root)&&a.length===2){
        const before=await current(path),after=patch(before,write),subjects=new Set<string>();
        for(const row of [before,after])if(row){
          if(root==='messages'){for(const key of ['senderId','receiverId'])if(uid(row[key]))subjects.add(row[key]);}
          else if(Array.isArray(row.participants)){for(const member of row.participants)if(uid(member))subjects.add(member);}
        }
        for(const subject of subjects)if(hasAccountErasureFence((await currentSnapshot('eligibility_profiles/'+subject)).data()))
          throw new Error('Account erasure fence prevents a new conversation effect.');
      }
      if(!privacyWrite&&['article_privacy_evidence','article_privacy_commands'].includes(root))
        throw new Error('Native article privacy evidence requires its dedicated owner scope.');
      if(!privacyWrite&&['articles','swapPartyItems'].includes(root)&&a.length===2)
        await assertArticlePrivacyPublicMarker(path,await current(path),patch(await current(path),write),current);
      const local=activeLocalAgreementScope();
      if(local||activeLocalCatalogueScope()||activeArticlePrivacyScope())assertLocalWriteSignature(write);
      if(local&&(!local.control||!localOperationAllows(local.operation,path)))throw new Error('Local agreement write is outside its qualified scope.');
      if(['transactions','swaps'].includes(root)&&a.length===2&&!privacyWrite)
        await assertArticlePrivacyMarkers(root,await current(path),patch(await current(path),write),current);
      if(!privacyWrite&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT!=='unconfigured'&&['transactions','swaps'].includes(root)&&a.length===2&&!local) {
        const before=await current(path),after=patch(before,write);
        if(before?.localAgreementWitness||after?.localAgreementWitness)throw new Error('A local source requires its dedicated nonfinancial lifecycle.');
      }
      if (!privacyWrite&&!documentaryWrite&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured' &&
          ['wallets','transactions','disputes','withdrawal_requests','swaps','stripe_checkout_intents','platform_ledger'].includes(root)) {
        if(!local||!['transactions','swaps','disputes'].includes(root))throw new Error('Financial native writes require a configured provider.');
        const before=await current(path);
        if(root==='disputes') {
          // One materialized patch, one instant, one after-state: the witness
          // must hash exactly the same native values forwarded to commit.
          write.args[1]=localServerTimestamps(write.args[1],Timestamp.now());
          const after=patch(before,write);
          if(!after||a.length!==2)throw new Error('Local absence case required.');
          const parent=await current('transactions/'+after.transactionId);
          const witness=localCashCaseFields(path,before,after,parent??{});
          write.args[1]={...write.args[1],localAgreementWitness:witness};
        } else {
          const after=patch(before,write);
          if(root==='transactions'&&a.length===4)assertLocalCashDecision(path,before,after??{},await current(a.slice(0,2).join('/'))??{});
          else assertLocalAgreementMutation(root==='transactions'?'purchase':'swap',path,before,after);
        }
      }
      if(local&&root==='users') {
        const keys=Object.keys(write.args[1]??{});
        if(write.method!=='update'||keys.some(key=>/stripe|wallet|balance|bank|payout|payment|finance/i.test(key)))throw new Error('Local agreements cannot change financial account fields.');
      }
      if(localCatalogueDomainAt(path)){
        const before=await current(path),after=patch(before,write);
        if(!privacyWrite&&!documentaryWrite)assertCatalogueFinancialIsolation(path,before,after);
        if(!privacyWrite&&!documentaryWrite&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT!=='unconfigured'&&(own(before,'localCatalogueWitness')||own(after,'localCatalogueWitness')))
          throw new Error('A local catalogue source cannot become a financial source.');
        if(!privacyWrite&&!documentaryWrite&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'&&!activeLocalCatalogueScope()&&
          (own(before,'localCatalogueWitness')||own(after,'localCatalogueWitness')))
          throw new Error('A local catalogue source requires its qualified scope.');
        if(!privacyWrite&&!documentaryWrite&&activeLocalCatalogueScope())assertLocalCatalogueMutation(path,before,after);
        snapshots.set(path,after);
      }
      if (!['wallets', 'transactions', 'disputes', 'withdrawal_requests', 'swaps', 'eligibility_audit', 'eligibility_profiles',
        'users', 'stripe_checkout_intents', 'admin_alerts', 'platform_ledger'].includes(root)) continue;
      const before = await current(path), after = patch(before, write), rows = [before, after]; snapshots.set(path, after);
      const uncertain = write.method !== 'delete' && (!after || !write.args[1] || typeof write.args[1] !== 'object' ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(write.args[1])) ||
          write.method === 'update' && write.args.length > 3 || Array.isArray(write.args[2]?.mergeFields) &&
          write.args[2].mergeFields.some((field: unknown) => typeof field !== 'string'));
      if (uncertain && ['wallets', 'users', 'eligibility_profiles'].includes(root)) {add(a[1], path); continue;}
      if (uncertain) unknownPaths.add(path);
      if (root === 'wallets') add(a[1], path);
      else if (root === 'transactions' && a.length === 2) for (const row of rows) await parties(row, path, ['buyerId', 'sellerId']);
      else if (root === 'swaps' && a.length === 2) for (const row of rows) await parties(row, path, ['initiatorId', 'receiverId']);
      else if (root === 'disputes' && a.length === 2) for (const row of rows) await parties(row, path, ['buyerId', 'sellerId'], uid(row?.transactionId) ? 'transactions/' + row!.transactionId : undefined);
      else if (root === 'withdrawal_requests') {
        const parent = a.length === 2 ? null : await current(a.slice(0, 2).join('/'));
        for (const row of parent ? [parent] : rows) if (row) add(row.userId, path);
      } else if (root === 'eligibility_audit' && a.length === 2) {
        for (const row of rows) if (row?.action === 'account_forfait_operation') add(row.ownerId, path);
      } else if (root === 'eligibility_profiles' && a.length === 2) {
        const select = (row: Data|undefined) => ({bankOperation: row?.bankOperation ?? null, connectOperation: row?.connectOperation ?? null,
          exceptionalRestitution: row?.accountClosure?.exceptionalRestitution ?? null});
        if (financialSubjectHash(select(before)) !== financialSubjectHash(select(after))) add(a[1], path);
      } else if (root === 'users' && a.length === 2) {
        const select = (row: Data|undefined) => ({exists: row !== undefined, stripeAccountId: row?.stripeAccountId ?? null,
          stripeAccountCreationStartedAt: row?.stripeAccountCreationStartedAt ?? null});
        if (financialSubjectHash(select(before)) !== financialSubjectHash(select(after))) add(a[1], path);
      } else if (root === 'stripe_checkout_intents' && a.length === 2) {
        const parent = await current('transactions/' + a[1]);
        if (!parent) unknownPaths.add(path); else await parties(parent, path, ['buyerId', 'sellerId']);
      }
      else if (root === 'admin_alerts' && (a.length === 2 || ['exceptional_commands', 'exceptional_evidence'].includes(a[2]))) {
        const parent = a.length === 2 ? null : await current(a.slice(0, 2).join('/'));
        for (const row of parent ? [parent] : rows) if (row?.protocol === 'exceptional_financial_restitution_v1') {
          add(row.ownerId, path); if (row.context?.kind === 'wallet_restitution') add(row.context.ownerId, path);
        }
      } else if (root === 'platform_ledger' && a.length === 2) {
        for (const row of rows) if (['exceptional_restitution_liability_v1', 'exceptional_bank_reference_v1'].includes(row?.protocol)) {
          const parent = uid(row!.caseId) ? await current('admin_alerts/' + row!.caseId) : undefined;
          if (parent?.protocol === 'exceptional_financial_restitution_v1') add(parent.ownerId, path); else unknownPaths.add(path);
        }
      }
    }
    const updates: {ref: FirebaseFirestore.DocumentReference; value: Data}[] = [];
    for (const ownerId of owners) {
      // A counterparty or Admin SDK writer cannot revive servicing after the
      // dedicated erasure admission. No fresh JWT removes this native fence.
      if(!writes.every(w=>privacyPlan.has(w)||documentaryPlan.has(w))&&
        hasAccountErasureFence((await currentSnapshot('eligibility_profiles/'+ownerId)).data()))
        throw new Error('Account erasure fence prevents a new contractual or financial effect.');
      const source = await readFinancialSubjectCounter(native, database, ownerId);
      updates.push({ref: financialSubjectGuardRef(database, ownerId), value: {protocol: 'financial_subject_counter_v1', ownerId,
        version: source.version !== null ? source.version + 1 : null,
        originHash: source.originHash, priorUnqualifiedSourceHash: source.known ? null : source.sourceHash,
        recordedAt: Timestamp.now(), mutationHash: financialSubjectHash(writes.map(w => w.args[0].path)), baselineAutomaticallyQualified: false}});
      // Reading the same per-subject native fence serializes this economic
      // mutation with K12's final authorization. It never blocks servicing.
      await native.get(database.collection('privacy_disposition_fences').doc(financialSubjectHash(ownerId)));
    }
    if (unknownPaths.size) {
      const ref = database.collection('financial_subject_catalogue_unknown').doc('native_v1'), snapshot = await native.get(ref), old = snapshot.data();
      updates.push({ref, value: {protocol: 'financial_subject_unknown_v1', version: Number.isSafeInteger(old?.version) ? old!.version + 1 : 1,
        priorSourceHash: financialSubjectHash(old ?? null), pathsHash: financialSubjectHash([...unknownPaths].sort()), recordedAt: Timestamp.now(), qualified: false}});
    }
    for (const update of updates) native.set(update.ref, update.value);
    for (const write of writes) (native[write.method] as any)(...write.args);
    return result;
  })), options);
}
