/** Incremental native disposition inspection. Each call reads at most one
 * source page; a closed cursor is useful only while causal guards still match. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportObject, supportHash, supportSourceHash, supportRevision, supportText, SUPPORT_KINDS} from './supportRequest';
import {privacyCaseRef, privacyReference, readPrivacyOperationCase, type PrivacyContext, type PrivacyEnvelope} from './privacyOperationsCore';
import {readPrivacyPreservationCatalogue} from './privacyPreservationCatalogue';
import {readFinancialSubjectCounter, financialSubjectHash} from './financialSubjectTransaction';
import {readFinancialSubjectQualification} from './financialSubjectQualification';
import {privacyRetentionDecision, privacyRetentionView} from './privacyRetention';

type Data = FirebaseFirestore.DocumentData;
const PAGE = 20;
const PHASES = [
  {id: 'owner_holds', collection: 'support_requests', field: 'ownerId'},
  {id: 'authority_holds', collection: 'support_requests', field: 'kind'},
  {id: 'purchases_buyer', collection: 'transactions', field: 'buyerId'},
  {id: 'purchases_seller', collection: 'transactions', field: 'sellerId'},
  {id: 'disputes_buyer', collection: 'disputes', field: 'buyerId'},
  {id: 'disputes_seller', collection: 'disputes', field: 'sellerId'},
  {id: 'withdrawals', collection: 'withdrawal_requests', field: 'userId'},
  {id: 'swaps_initiated', collection: 'swaps', field: 'initiatorId'},
  {id: 'swaps_received', collection: 'swaps', field: 'receiverId'},
  {id: 'forfaits', collection: 'eligibility_audit', field: 'ownerId'},
] as const;
const inspectionRef = (caseId: string, id: string) => privacyCaseRef(caseId).collection('privacy_inspections').doc(id);
export async function readDispositionCausalSources(tx: FirebaseFirestore.Transaction, ownerId: string) {
  const catalogue = await readPrivacyPreservationCatalogue(tx), counter = await readFinancialSubjectCounter(tx, db, ownerId),
    deployment = await readFinancialSubjectQualification(), unknown = await tx.get(db.collection('financial_subject_catalogue_unknown').doc('native_v1'));
  return {catalogue, counter, deployment, unknownFinancialSources: {exists: unknown.exists, sourceHash: financialSubjectHash(unknown.data() ?? null)},
    blockers: [...(!catalogue.qualified ? ['native_preservation_catalogue_unknown'] : []),
      ...(!counter.known ? ['native_financial_counter_unknown'] : []), ...(!deployment.qualified ? ['independent_writer_deployment_or_restore_unqualified'] : []),
      ...(unknown.exists ? ['native_unattributed_financial_mutation_requires_reconciliation'] : [])]};
}
function checked(raw: Data|undefined, context: PrivacyContext, reference: ReturnType<typeof privacyReference>) {
  if (!raw || raw.protocol !== 'privacy_disposition_scope_v1' || raw.ownerId !== context.ownerId || raw.caseId !== context.caseId ||
      supportHash(raw.reference) !== supportHash(reference) || supportSourceHash(raw.scope) !== reference.contentHash ||
      raw.scope.caseSourceHash !== context.sourceHash || !Number.isSafeInteger(raw.version) || raw.version < 0 ||
      !['capturing', 'review_required', 'complete', 'unavailable', 'stale'].includes(raw.status)) {
    throw new HttpsError('failed-precondition', 'Inspection native exacte et dossier courant requis.');
  }
  return raw;
}
export function privacyDispositionScopeView(value: Data) {
  return {protocol: value.protocol, reference: value.reference, caseId: value.caseId, ownerId: value.ownerId, target: value.scope.target,
    status: value.status, version: value.version, nativeReadTime: value.scope.readTime, phase: PHASES[value.cursor.phase]?.id ?? 'done',
    currentPage: value.currentPage, reviewsRequired: value.status === 'review_required', progress: value.progress,
    blockers: value.blockers, reason: value.reason, knownNativeSourceSetClosed: value.status === 'complete',
    sourceSetExhaustive: false, globalErasureVerified: false};
}
export async function readPrivacyDispositionScope(tx: FirebaseFirestore.Transaction, context: PrivacyContext, raw: unknown) {
  const reference = privacyReference(raw), value = checked((await tx.get(inspectionRef(context.caseId, reference.id))).data(), context, reference);
  return privacyDispositionScopeView(value);
}
export async function preparePrivacyDispositionScope(tx: FirebaseFirestore.Transaction, context: PrivacyContext, env: PrivacyEnvelope, target: any) {
  supportObject(env.command, ['action', 'target']);
  const point = context.snapshot.readTime;
  if (!(point instanceof Timestamp) || point.nanoseconds % 1000 !== 0 || point.toMillis() > Date.now()) throw new HttpsError('unavailable', 'Point natif Firestore indisponible.');
  const sources = await readDispositionCausalSources(tx, context.ownerId);
  if (sources.deployment.qualified && sources.deployment.qualifiedAt && point.toMillis() < Date.parse(sources.deployment.qualifiedAt)) {
    throw new HttpsError('aborted', 'Ce point précède la qualification du drainage des anciens writers ; préparez une nouvelle inspection.');
  }
  const scope = {ownerId: context.ownerId, caseId: context.caseId, caseSourceHash: context.sourceHash, target,
    readTime: {seconds: point.seconds, nanoseconds: point.nanoseconds}, causal: sources};
  const reference = {id: 'privacy_inspection_' + supportHash([env.uid, env.requestId]), contentHash: supportSourceHash(scope)};
  const value = {protocol: 'privacy_disposition_scope_v1', reference, caseId: context.caseId, ownerId: context.ownerId, scope,
    status: 'capturing', version: 0, cursor: {phase: 0, lastId: null}, currentPage: null,
    progress: {pages: 0, inspected: 0, reviewedHolds: 0, financialSources: 0},
    rollingRoot: supportSourceHash({protocol: 'privacy_inspection_root_v1', scope}), legalReviewRoot: supportSourceHash([]),
    financialRoot: supportSourceHash([]), blockers: sources.blockers, reason: null, recordedAt: Timestamp.now()};
  return {reference, commit() {tx.create(inspectionRef(context.caseId, reference.id), value);}};
}
function reviewCurrentPage(value: Data, reviews: unknown) {
  const holds = (value.currentPage?.entries ?? []).filter((entry: any) => entry.kind === 'hold');
  if (!Array.isArray(reviews) || reviews.length !== holds.length) throw new HttpsError('failed-precondition', 'Examinez chaque maintien de la page native affichée.');
  const seen = new Set<string>();
  return holds.map((entry: Data) => {
    const raw = reviews.find((v: any) => v?.entry?.id === entry.id), item = supportObject(raw, ['entry', 'resolution', 'reason']), reference = privacyReference(item.entry);
    if (seen.has(reference.id) || supportHash(reference) !== supportHash({id: entry.id, contentHash: entry.contentHash}) ||
        !['ended_for_exact_target', 'not_applicable_to_exact_target'].includes(item.resolution)) throw new HttpsError('aborted', 'La page ou une source examinée a changé.');
    seen.add(reference.id);
    return {entry: reference, resolution: item.resolution, reason: supportText(item.reason, 'Motivation de ce maintien pour la cible exacte')};
  });
}
export async function observePrivacyDispositionScopeAdvance(request: any, caseId: string, rawReference: unknown, version: unknown, reviews: unknown) {
  const reference = privacyReference(rawReference);
  const initial = await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId), value = checked((await tx.get(inspectionRef(caseId, reference.id))).data(), context, reference),
      sources = await readDispositionCausalSources(tx, context.ownerId);
    if (value.version !== version || !['capturing', 'review_required'].includes(value.status)) throw new HttpsError('aborted', 'Relisez l’inspection avant de continuer.');
    return {context, value, sources, reviews: reviewCurrentPage(value, reviews)};
  });
  const value = initial.value, p = value.scope.readTime, point = new Timestamp(p.seconds, p.nanoseconds);
  if (supportHash(initial.sources) !== supportHash(value.scope.causal)) return {...initial, stale: true, unavailable: false, page: null};
  try {
    if (Date.now() < point.toMillis() || Date.now() - point.toMillis() > 3600_000) throw new Error('Native point expired.');
    const page = await db.runTransaction(async native => {
      const tx = new Proxy(native, {get(target, key) {
        if (key === 'get') return async (ref: any) => {const snapshot = await target.get(ref);
          if (!(snapshot.readTime instanceof Timestamp) || !snapshot.readTime.isEqual(point)) throw new Error('Native fixed point changed.'); return snapshot;};
        if (key === 'getAll') return (...refs: any[]) => Promise.all(refs.map(ref => (tx as any).get(ref)));
        const result = (target as any)[key]; return typeof result === 'function' ? result.bind(target) : result;
      }});
      const phase = PHASES[value.cursor.phase];
      if (!phase) return {entries: [], reference: null, next: value.cursor, phase: 'done', blockers: [] as string[], inspected: 0, financialPageHash: null as string|null};
      let query = db.collection(phase.collection).where(phase.field, '==', phase.id === 'authority_holds' ? 'authority_request_private' : value.ownerId).orderBy('__name__').limit(PAGE + 1);
      if (phase.id === 'forfaits') query = query.where('action', '==', 'account_forfait_operation');
      if (value.cursor.lastId) query = query.startAfter(value.cursor.lastId);
      const nativePage = await tx.get(query), rows = nativePage.docs.slice(0, PAGE), more = nativePage.size > PAGE;
      const legal = ['owner_holds', 'authority_holds'].includes(phase.id), blockers: string[] = []; let financialPageHash: string|null = null;
      if (phase.id === 'owner_holds' && rows.some(row => row.data().schemaVersion !== 1 || !(SUPPORT_KINDS as readonly unknown[]).includes(row.data().kind))) {
        blockers.push('unqualified_native_preservation_case');
      }
      if (!legal) {
        const profile = (await tx.get(db.collection('eligibility_profiles').doc(value.ownerId))).data() ?? {};
        const partial = await (await import('../callable/users')).deletionObligations(tx, value.ownerId, profile,
          {inspectionPage: {source: phase.id as any, page: {docs: rows, size: rows.length, empty: !rows.length} as FirebaseFirestore.QuerySnapshot}});
        if (partial.financialScopeQualified !== false) throw new Error('A partial page cannot qualify a financial absence.');
        financialPageHash = partial.financialAbsenceHash;
        blockers.push(...partial.blockers.filter(b => b !== 'privacy_retention_review_required'));
      }
      const authority = phase.id === 'authority_holds' ? await import('./authorityRequest') : null;
      const entries = rows.filter(row => phase.id !== 'owner_holds' || ['personal_data_access', 'personal_data_correction'].includes(row.data().kind)).map(row => {
        const data = row.data(), hold = legal || value.scope.target.service === 'storage' && ['transactions', 'swaps'].includes(phase.collection),
          qualification = legal && (data.schemaVersion !== 1 || phase.id === 'authority_holds' && !authority!.authorityPreservationSourceQualified(row) ||
            phase.id === 'owner_holds' && privacyRetentionView(data).qualification !== 'native_preservation') ? 'unknown' : 'native';
        const selected = {kind: hold ? 'hold' : 'financial_source', sourcePath: row.ref.path, sourceRevision: supportRevision(row),
          sourceHash: supportSourceHash(data), caseKind: legal ? data.kind ?? null : hold ? 'retained_contract_media_purpose' : null,
          version: Number.isSafeInteger(data.version) ? data.version : null, qualification,
          blockers: qualification === 'unknown' ? ['unqualified_native_preservation_case'] : []};
        return {...selected, id: 'privacy_inspection_source_' + supportHash([phase.id, row.ref.path]), contentHash: supportSourceHash(selected)};
      });
      const document = {phase: phase.id, entries, next: {phase: more ? value.cursor.phase : value.cursor.phase + 1, lastId: more ? rows.at(-1)!.id : null},
        blockers: [...new Set([...blockers, ...entries.flatMap(entry => entry.blockers)])].sort(), inspected: rows.length, financialPageHash};
      return {...document, reference: {id: 'privacy_inspection_page_' + supportHash([reference.id, value.version, phase.id, value.cursor.lastId]), contentHash: supportSourceHash(document)}};
    }, {readOnly: true, readTime: point});
    await db.runTransaction(tx => readPrivacyOperationCase(tx, request, caseId));
    return {...initial, page, stale: false, unavailable: false};
  } catch (error) {
    await db.runTransaction(tx => readPrivacyOperationCase(tx, request, caseId));
    return {...initial, page: null, stale: false, unavailable: true};
  }
}
export async function preparePrivacyDispositionScopeAdvance(tx: FirebaseFirestore.Transaction, context: PrivacyContext,
  observed: Awaited<ReturnType<typeof observePrivacyDispositionScopeAdvance>>) {
  const current = checked((await tx.get(inspectionRef(context.caseId, observed.value.reference.id))).data(), context, observed.value.reference),
    sources = await readDispositionCausalSources(tx, context.ownerId);
  if (current.version !== observed.value.version || supportHash(current.cursor) !== supportHash(observed.value.cursor)) throw new HttpsError('aborted', 'Une autre page a déjà avancé.');
  const stale = observed.stale || supportHash(sources) !== supportHash(current.scope.causal), page = observed.page,
    reviews = observed.reviews, legalReviewRoot = supportSourceHash([current.legalReviewRoot, current.currentPage?.reference ?? null, reviews]),
    cursor = page?.next ?? current.cursor, done = !stale && !observed.unavailable && cursor.phase === PHASES.length && (!page || page.entries.length === 0);
  const blockers = [...new Set([...current.blockers, ...(page?.blockers ?? [])])].sort();
  const next = {...current, version: current.version + 1, cursor, currentPage: !done && page?.reference ? {reference: page.reference, phase: page.phase, entries: page.entries} : null,
    rollingRoot: supportSourceHash([current.rollingRoot, page?.reference ?? null, legalReviewRoot]), legalReviewRoot,
    financialRoot: page && !['owner_holds', 'authority_holds', 'done'].includes(page.phase)
      ? supportSourceHash([current.financialRoot, {phase: page.phase, nativePartialHash: page.financialPageHash}]) : current.financialRoot, blockers,
    status: stale ? 'stale' : observed.unavailable ? 'unavailable' : done ? 'complete' : page?.entries.some(entry => entry.kind === 'hold') ? 'review_required' : 'capturing',
    progress: {pages: current.progress.pages + (page?.reference ? 1 : 0), inspected: current.progress.inspected + (page?.inspected ?? 0),
      reviewedHolds: current.progress.reviewedHolds + reviews.length,
      financialSources: current.progress.financialSources + (page?.entries.filter(entry => entry.kind === 'financial_source').length ?? 0)},
    reason: stale ? 'causal_source_changed_restart_required' : observed.unavailable ? 'fixed_native_read_point_unavailable' : null};
  return {reference: current.reference, commit() {
    if (current.currentPage) tx.create(inspectionRef(context.caseId, current.reference.id).collection('page_reviews').doc('review_' + current.version),
      {pageReference: current.currentPage.reference, reviews, root: legalReviewRoot, recordedAt: Timestamp.now()});
    if (page?.reference) tx.create(inspectionRef(context.caseId, current.reference.id).collection('pages').doc(page.reference.id), page);
    tx.set(inspectionRef(context.caseId, current.reference.id), next);
  }};
}
export async function readQualifiedDispositionScope(tx: FirebaseFirestore.Transaction, context: PrivacyContext, raw: unknown, target: any) {
  const reference = privacyReference(raw), value = checked((await tx.get(inspectionRef(context.caseId, reference.id))).data(), context, reference),
    current = await readDispositionCausalSources(tx, context.ownerId), guard = await tx.get(db.collection('privacy_retention_guards').doc(context.ownerId)),
    preservation = guard.exists ? await privacyRetentionDecision(tx, context.ownerId) : {qualification: 'paged_native_preservation_examined'};
  if (value.status !== 'complete' || value.currentPage !== null || supportHash(value.scope.target) !== supportHash(target) ||
      supportHash(current) !== supportHash(value.scope.causal)) throw new HttpsError('aborted', 'Inspection complète actuelle requise ; reprenez depuis un nouveau point si les sources ont changé.');
  const blockers = [...new Set([...value.blockers, ...current.blockers, ...(preservation.qualification === 'unknown' ? ['native_privacy_preservation_scope_unknown'] : [])])];
  return {reference, causal: current, blockers, holdReviewRoot: value.legalReviewRoot,
    financialAbsenceHash: supportSourceHash({protocol: 'account_deletion_financial_absences_paged_v1', ownerId: context.ownerId,
      root: value.financialRoot, counter: current.counter, deployment: current.deployment}),
    holdsCoverage: {ownerComplete: true, authorityComplete: true, pages: value.progress.pages, inspected: value.progress.inspected,
      reviewedHolds: value.progress.reviewedHolds, globalLegalUniverseVerified: false}, sourceSetExhaustive: false};
}
