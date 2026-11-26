import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../config/firebase';
import { storageObjectPath } from './articleMedia';
import { sourceImageWitness, preservePrivateImage, readPrivateImage, type PrivateImageWitness } from './privateMedia';
import { articlePrivacyWithdrawn } from './publicProfile';

type ArticleReportAuthorization = (tx?: FirebaseFirestore.Transaction) => Promise<void>;
/** Session-bound client work opts in; native server conservation keeps its
 * original servicing authority and never fabricates a member session. */
async function authorizedArticleReport<T>(authorize: ArticleReportAuthorization | undefined, operation: () => Promise<T>): Promise<T> {
  await authorize?.();
  try { return await operation(); } finally { await authorize?.(); }
}

const HASH = /^[a-f0-9]{64}$/;
const FIELDS = ['title', 'description', 'price', 'images', 'condition', 'brand', 'brandStatus', 'categoryIds', 'size',
  'color', 'colors', 'material', 'materials', 'pattern', 'hasKnownDefects', 'defectsDescription', 'hasAlterations',
  'alterationsDescription', 'quantity'] as const;
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function articleReportIntentId(uid: string, articleId: string, requestId: string): string {
  return `article_${digest([uid, articleId, requestId])}`;
}
function permanentMediaFailure(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error &&
    (Number(error.code) === 404 || error.code === 'failed-precondition');
}
function canonical(value: unknown): string {
  let nodes = 0;
  const visit = (v: any, depth: number): any => {
    if (++nodes > 5000 || depth > 8) throw new HttpsError('invalid-argument', 'Projection de signalement trop volumineuse.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(item => visit(item, depth + 1));
    if (v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      return Object.fromEntries(Object.keys(v).sort().map(key => [key, visit(v[key], depth + 1)]));
    }
    throw new HttpsError('invalid-argument', 'Projection de signalement invalide.');
  };
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > 120000) throw new HttpsError('invalid-argument', 'Projection de signalement trop volumineuse.');
  return text;
}
/** Match the pure article read boundary (normalizeArticleImages/fixStorageUrl).
 * This only canonicalizes the examined display. Existing native snapshots and
 * receipt hashes are never recalculated through a newer display canonicalizer. */
function examinedImages(images: unknown): Array<{ url: string; blurhash: string | null }> {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image: unknown) => {
    const entry = typeof image === 'string' ? { url: image } : image;
    if (!entry || typeof entry !== 'object' || !('url' in entry) || typeof entry.url !== 'string' || !entry.url.trim()) return [];
    let url = entry.url.trim();
    try {
      const origin = new URL(url).origin, emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if (origin === 'https://firebasestorage.googleapis.com' || !!emulatorHost && origin === `http://${emulatorHost}`) {
        const path = url.match(/\/o\/([^?]+)/)?.[1];
        if (path && !path.includes('%2F')) {
          const encoded = path.split('/').map(segment => encodeURIComponent(segment)).join('%2F');
          url = url.replace(`/o/${path}`, `/o/${encoded}`);
        }
      }
    } catch { /* The app likewise retains malformed/external strings; media qualification remains separate. */ }
    return [{ url, blurhash: 'blurhash' in entry && typeof entry.blurhash === 'string' && entry.blurhash ? entry.blurhash : null }];
  });
}
export function articleReportProjection(article: FirebaseFirestore.DocumentData): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map(field => [field, field === 'images'
    ? examinedImages(article.images)
    : field === 'size' && article.size ? { value: article.size.value ?? null, system: article.size.system ?? null }
      : article[field] ?? null]));
}
function revision(snap: FirebaseFirestore.DocumentSnapshot): string {
  if (!snap.updateTime) throw new HttpsError('failed-precondition', 'Version de l’annonce indisponible.');
  return digest([snap.id, snap.updateTime.seconds, snap.updateTime.nanoseconds]);
}
export function reportEvidenceId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', `${name} invalide.`);
  return value;
}
export function assertReportActor(uid: string, payload: Record<string, unknown>) {
  if (payload.expectedUid !== uid) throw new HttpsError('permission-denied', 'Le compte de signalement a changé.');
}
type MediaProposal = { index: number; sourceGeneration: string | null; sourceCrc32c: string | null;
  contentType: string | null; size: number | null; qualification: 'qualified' | 'needs_review' };
type CapturedMedia = MediaProposal & { mediaId: string; sourcePath: string | null; privatePath: string;
  state: 'pending' | 'preserved' | 'needs_review'; privateGeneration: string | null; reason: string | null };
function publicArticle(snap: FirebaseFirestore.DocumentSnapshot) {
  const article = snap.data();
  if (!article || typeof article.sellerId !== 'string' || article.isActive !== true || articlePrivacyWithdrawn(article)) {
    throw new HttpsError('failed-precondition', 'Cette version publique de l’annonce n’est plus disponible.');
  }
  const snapshot = articleReportProjection(article);
  canonical(snapshot);
  const images = snapshot.images as Array<{ url: unknown }>;
  if (!images.length || images.length > 10 || images.some(image => typeof image.url !== 'string')) {
    throw new HttpsError('failed-precondition', 'Les médias de cette annonce demandent un rapprochement.');
  }
  return { article, snapshot, articleRevision: revision(snap), contentHash: digest(snapshot) };
}
function qualifiedPath(url: string, articleId: string, sellerId: string): string | null {
  const path = storageObjectPath(url, storage.bucket().name);
  if (!path) return null;
  const parts = path.split('/');
  // A legacy draft remains owner-editable and cleanup does not honor this
  // article barrier. Its URL or metadata alone must never promise preserved pixels.
  void sellerId;
  return parts[0] === 'articles' && parts[1] === articleId && parts.length >= 3 ? path : null;
}
async function mediaProposals(snapshot: Record<string, unknown>, articleId: string, sellerId: string) {
  return Promise.all((snapshot.images as Array<{ url: string }>).map(async (image, index): Promise<MediaProposal> => {
    const path = qualifiedPath(image.url, articleId, sellerId);
    if (path) {
      try { const [metadata] = await storage.bucket().file(path).getMetadata();
        const witness = sourceImageWitness(metadata); return { index, ...witness, qualification: 'qualified' };
      } catch (error) {
        if (!permanentMediaFailure(error)) throw new HttpsError('unavailable', 'La lecture du témoin photo doit être reprise.');
      }
    }
    return { index, sourceGeneration: null, sourceCrc32c: null, contentType: null, size: null, qualification: 'needs_review' };
  }));
}
export async function previewArticleReport(uid: string, payload: Record<string, unknown>, authorize?: ArticleReportAuthorization) {
  assertReportActor(uid, payload);
  return authorizedArticleReport(authorize, async () => {
  const articleId = reportEvidenceId(payload.targetId, 'Annonce');
  const snap = await db.collection('articles').doc(articleId).get();
  const source = publicArticle(snap);
  if (canonical(payload.expectedArticle) !== canonical(source.snapshot)) {
    throw new HttpsError('failed-precondition', 'L’annonce a changé. Relisez son contenu avant de signaler cette version.');
  }
  const expectedMedia = await mediaProposals(source.snapshot, articleId, source.article.sellerId);
  const after = publicArticle(await db.collection('articles').doc(articleId).get());
  if (after.articleRevision !== source.articleRevision || after.contentHash !== source.contentHash) {
    throw new HttpsError('failed-precondition', 'L’annonce a changé pendant la lecture.');
  }
  return { protocol: 'article_report_preview_v1', actorUid: uid, articleId, sellerId: source.article.sellerId,
    articleRevision: source.articleRevision, contentHash: source.contentHash, snapshot: source.snapshot, expectedMedia,
    mediaCount: expectedMedia.length, conservation: expectedMedia.every(media => media.qualification === 'qualified') ? 'ready' : 'needs_review',
    authenticityVerified: false, photoRightsVerified: false };
  });
}
export function articleReportTuple(uid: string, payload: Record<string, unknown>, reason: string, description: string | null) {
  assertReportActor(uid, payload);
  const articleId = reportEvidenceId(payload.targetId, 'Annonce'), requestId = reportEvidenceId(payload.requestId, 'Intention');
  if (!HASH.test(String(payload.expectedArticleRevision)) || !HASH.test(String(payload.expectedArticleContentHash)) ||
      !Array.isArray(payload.expectedMedia) || payload.expectedMedia.length < 1 || payload.expectedMedia.length > 10) {
    throw new HttpsError('invalid-argument', 'L’aperçu exact de l’annonce est requis.');
  }
  const expectedMedia = payload.expectedMedia.map((m: any, index: number): MediaProposal => {
    if (!m || Object.keys(m).sort().join(',') !== 'contentType,index,qualification,size,sourceCrc32c,sourceGeneration' || m.index !== index ||
        !['qualified', 'needs_review'].includes(m.qualification)) throw new HttpsError('invalid-argument', 'Témoin média invalide.');
    if (m.qualification === 'qualified') {
      if (typeof m.sourceGeneration !== 'string' || !/^\d+$/.test(m.sourceGeneration) || typeof m.sourceCrc32c !== 'string' ||
          typeof m.contentType !== 'string' || !m.contentType.startsWith('image/') || !Number.isSafeInteger(m.size) ||
          m.size <= 0 || m.size >= 10 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Témoin média invalide.');
    } else if ([m.sourceGeneration, m.sourceCrc32c, m.contentType, m.size].some(v => v !== null)) {
      throw new HttpsError('invalid-argument', 'Témoin inconnu incohérent.');
    }
    return { index, sourceGeneration: m.sourceGeneration, sourceCrc32c: m.sourceCrc32c,
      contentType: m.contentType, size: m.size, qualification: m.qualification };
  });
  const input = { actorUid: uid, articleId, requestId, reason, description, expectedArticleRevision: payload.expectedArticleRevision,
    expectedArticleContentHash: payload.expectedArticleContentHash, expectedMedia };
  return { ...input, tupleHash: digest(input), reportId: articleReportIntentId(uid, articleId, requestId) };
}
type Tuple = ReturnType<typeof articleReportTuple>;
export async function verifyArticleReportSources(tuple: Tuple, authorize?: ArticleReportAuthorization) {
  return authorizedArticleReport(authorize, async () => {
  const source = publicArticle(await db.collection('articles').doc(tuple.articleId).get());
  if (source.articleRevision !== tuple.expectedArticleRevision || source.contentHash !== tuple.expectedArticleContentHash) {
    throw new HttpsError('failed-precondition', 'Cette annonce ne correspond plus à l’aperçu examiné.');
  }
  const proposed = await mediaProposals(source.snapshot, tuple.articleId, source.article.sellerId);
  if (canonical(proposed) !== canonical(tuple.expectedMedia)) throw new HttpsError('failed-precondition', 'Les photos ont changé. Relisez l’aperçu.');
  return source;
  });
}
export async function prepareArticleReportCapture(tx: FirebaseFirestore.Transaction, snap: FirebaseFirestore.DocumentSnapshot, tuple: Tuple) {
  const source = publicArticle(snap);
  if (source.articleRevision !== tuple.expectedArticleRevision || source.contentHash !== tuple.expectedArticleContentHash) {
    throw new HttpsError('failed-precondition', 'La version signalée a changé.');
  }
  const ids = source.article.articleReportEvidenceReportIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)) {
    throw new HttpsError('failed-precondition', 'La conservation des dossiers de cette annonce demande un rapprochement.');
  }
  const reportIds: string[] = ids ?? [];
  if (!reportIds.includes(tuple.reportId) && reportIds.length >= 40) throw new HttpsError('resource-exhausted', 'Les dossiers de cette annonce demandent un rapprochement.');
  // Different client IDs must not bypass the one-allegation-per-actor/source
  // quota. A genuinely changed listing or photo generation can be reported
  // again, without replacing the earlier dossier or native receipt.
  if (reportIds.length) {
    const previous = await tx.getAll(...reportIds.map(id => db.collection('reports').doc(id)));
    for (const prior of previous) {
      const report = prior.data();
      if (!report) throw new HttpsError('failed-precondition', 'Protection de signalement inconnue.');
      const evidence = await readQualifiedEvidence(report, prior.id, tx);
      if (evidence.articleId !== tuple.articleId) throw new HttpsError('failed-precondition', 'Protection de signalement divergente.');
      if (evidence.reporterId === tuple.actorUid && evidence.contentHash === tuple.expectedArticleContentHash &&
          canonical(evidence.input.expectedMedia) === canonical(tuple.expectedMedia)) {
        throw new HttpsError('already-exists', 'Cette version a déjà été signalée. Pour ajouter un élément au dossier existant, contactez le support avec sa référence.',
          { reportId: prior.id, existingVersion: true, nextAction: 'support' });
      }
    }
  }
  const media: CapturedMedia[] = tuple.expectedMedia.map(m => {
    const image = (source.snapshot.images as Array<{ url: string }>)[m.index];
    const mediaId = digest([tuple.reportId, tuple.requestId, m.index, image.url, m.sourceGeneration]);
    return { ...m, mediaId, sourcePath: qualifiedPath(image.url, tuple.articleId, source.article.sellerId),
      privatePath: `report_evidence/${digest(tuple.reportId)}/${tuple.requestId}/${mediaId}`,
      state: m.qualification === 'qualified' ? 'pending' : 'needs_review', privateGeneration: null,
      reason: m.qualification === 'qualified' ? null : 'source_unqualified' };
  });
  tx.update(snap.ref, { articleReportEvidenceReportIds: [...new Set([...reportIds, tuple.reportId])] });
  return { schemaVersion: 1, protocol: 'article_report_evidence_v1', requestId: tuple.requestId, tupleHash: tuple.tupleHash,
    articleId: tuple.articleId, sellerId: source.article.sellerId, reporterId: tuple.actorUid,
    articleRevision: source.articleRevision, contentHash: source.contentHash, snapshot: source.snapshot,
    input: { actorUid: tuple.actorUid, articleId: tuple.articleId, requestId: tuple.requestId, reason: tuple.reason,
      description: tuple.description, expectedArticleRevision: tuple.expectedArticleRevision,
      expectedArticleContentHash: tuple.expectedArticleContentHash, expectedMedia: tuple.expectedMedia },
    media, capturedAt: Timestamp.now(), state: 'pending', authenticityVerified: false, photoRightsVerified: false };
}
function nativeEvidence(report: FirebaseFirestore.DocumentData, reportId: string, anchor: FirebaseFirestore.DocumentData | undefined) {
  const evidence = report.articleEvidence;
  if (!evidence || evidence.schemaVersion !== 1 || evidence.protocol !== 'article_report_evidence_v1' ||
      report.id !== reportId || report.targetType !== 'article' || report.targetId !== evidence.articleId ||
      report.reporterId !== evidence.reporterId || report.targetOwnerId !== evidence.sellerId ||
      ![articleReportIntentId(evidence.reporterId, evidence.articleId, evidence.requestId),
        `${evidence.reporterId}_article_${evidence.articleId}`].includes(reportId) || !HASH.test(evidence.tupleHash ?? '') ||
      !HASH.test(evidence.contentHash ?? '') || !HASH.test(evidence.articleRevision ?? '') ||
      !(evidence.capturedAt instanceof Timestamp) || !Array.isArray(evidence.media) || !evidence.media.length || evidence.media.length > 10 ||
      digest(evidence.snapshot) !== evidence.contentHash || !['pending', 'preserved', 'needs_review'].includes(evidence.state) ||
      !evidence.input || digest(evidence.input) !== evidence.tupleHash || evidence.input.actorUid !== evidence.reporterId ||
      evidence.input.articleId !== evidence.articleId || evidence.input.requestId !== evidence.requestId ||
      evidence.input.reason !== report.reason || evidence.input.description !== (report.description ?? null) ||
      evidence.input.expectedArticleRevision !== evidence.articleRevision || evidence.input.expectedArticleContentHash !== evidence.contentHash ||
      evidence.media.length !== evidence.snapshot?.images?.length || evidence.media.length !== evidence.input.expectedMedia?.length) {
    throw new HttpsError('failed-precondition', 'Dossier photographique natif non qualifié.');
  }
  reportEvidenceId(evidence.requestId, 'Intention native');
  if (!anchor || anchor.schemaVersion !== 1 || anchor.writer !== 'submitReport_capture_v1' || anchor.reportId !== reportId ||
      anchor.reporterId !== evidence.reporterId || anchor.sellerId !== evidence.sellerId || anchor.articleId !== evidence.articleId ||
      anchor.requestId !== evidence.requestId || anchor.tupleHash !== evidence.tupleHash || anchor.contentHash !== evidence.contentHash ||
      anchor.articleRevision !== evidence.articleRevision || !(anchor.capturedAt instanceof Timestamp) ||
      !anchor.capturedAt.isEqual(evidence.capturedAt)) {
    throw new HttpsError('failed-precondition', 'Cette structure historique ne prouve pas une capture serveur.');
  }
  for (const [index, media] of (evidence.media as CapturedMedia[]).entries()) {
    const image = evidence.snapshot.images?.[media.index];
    const proposal = { index: media.index, sourceGeneration: media.sourceGeneration, sourceCrc32c: media.sourceCrc32c,
      contentType: media.contentType, size: media.size, qualification: media.qualification };
    if (media.index !== index || canonical(proposal) !== canonical(evidence.input.expectedMedia[index]) ||
        !image || media.mediaId !== digest([reportId, evidence.requestId, media.index, image.url, media.sourceGeneration]) ||
        media.privatePath !== `report_evidence/${digest(reportId)}/${evidence.requestId}/${media.mediaId}` ||
        media.sourcePath !== qualifiedPath(image.url, evidence.articleId, evidence.sellerId) ||
        !['pending', 'preserved', 'needs_review'].includes(media.state)) {
      throw new HttpsError('failed-precondition', 'Référence photographique native non qualifiée.');
    }
  }
  return evidence;
}
/** Flush-time documentary validation against the same native public source.
 * This validates capture only; it grants no stock or moderation authority. */
export function validateArticleReportCaptureProjection(snap:FirebaseFirestore.DocumentSnapshot,report:FirebaseFirestore.DocumentData,
  anchor:FirebaseFirestore.DocumentData|undefined) {
  const source=publicArticle(snap),evidence=nativeEvidence(report,report.id,anchor);
  if(evidence.articleId!==snap.id||evidence.sellerId!==source.article.sellerId||evidence.articleRevision!==source.articleRevision||
    evidence.contentHash!==source.contentHash||evidence.state!=='pending'||report.status!=='pending'||
    !(report.createdAt instanceof Timestamp)||!report.createdAt.isEqual(evidence.capturedAt)||
    evidence.authenticityVerified!==false||evidence.photoRightsVerified!==false)
    throw new HttpsError('failed-precondition','La capture ne correspond plus à sa source publique.');
  return evidence;
}
function evidenceAnchorRef(reportId: string) {
  return db.collection('reports').doc(reportId).collection('native_evidence').doc('capture');
}
async function readQualifiedEvidence(report: FirebaseFirestore.DocumentData, reportId: string, tx?: FirebaseFirestore.Transaction) {
  const ref = evidenceAnchorRef(reportId), anchor = await (tx ? tx.get(ref) : ref.get());
  return nativeEvidence(report, reportId, anchor.data());
}
export function createArticleReportEvidenceAnchor(tx: FirebaseFirestore.Transaction, reportId: string, evidence: FirebaseFirestore.DocumentData) {
  tx.create(evidenceAnchorRef(reportId), { schemaVersion: 1, writer: 'submitReport_capture_v1', reportId,
    articleId: evidence.articleId, sellerId: evidence.sellerId, reporterId: evidence.reporterId, requestId: evidence.requestId,
    tupleHash: evidence.tupleHash, contentHash: evidence.contentHash, articleRevision: evidence.articleRevision, capturedAt: evidence.capturedAt });
}
export async function reportEvidenceReceipt(report: FirebaseFirestore.DocumentData, reportId: string, uid: string, requestId: string,
  tx?: FirebaseFirestore.Transaction) {
  const evidence = await readQualifiedEvidence(report, reportId, tx);
  if (evidence.reporterId !== uid || evidence.requestId !== requestId) throw new HttpsError('permission-denied', 'Cette intention ne correspond pas au dossier.');
  return { protocol: 'article_report_receipt_v1', actorUid: uid, reportId, articleId: evidence.articleId, requestId,
    receivedAt: evidence.capturedAt.toDate().toISOString(), articleRevision: evidence.articleRevision, contentHash: evidence.contentHash,
    tupleHash: evidence.tupleHash, conservation: evidence.state, mediaCount: evidence.media.length,
    reason: report.reason, description: report.description ?? null, status: report.status,
    authenticityVerified: false, photoRightsVerified: false };
}
function nonexecutionReceipt(anchor: FirebaseFirestore.DocumentData, uid: string, articleId: string, requestId: string) {
  const reportId = articleReportIntentId(uid, articleId, requestId), input = anchor.input;
  if (anchor.schemaVersion !== 1 || anchor.writer !== 'submitReport_neutralize_v1' ||
      anchor.protocol !== 'article_report_nonexecution_v1' || anchor.actorUid !== uid || anchor.articleId !== articleId ||
      anchor.requestId !== requestId || anchor.reportId !== reportId || !input || input.actorUid !== uid ||
      input.articleId !== articleId || input.requestId !== requestId || !HASH.test(anchor.tupleHash ?? '') ||
      digest(input) !== anchor.tupleHash || !(anchor.neutralizedAt instanceof Timestamp) ||
      !HASH.test(input.expectedArticleRevision ?? '') || !HASH.test(input.expectedArticleContentHash ?? '') ||
      typeof input.reason !== 'string' || !input.reason || input.reason.length > 100 ||
      (input.description !== null && (typeof input.description !== 'string' || input.description.length > 2000)) ||
      !Array.isArray(input.expectedMedia) || !input.expectedMedia.length || input.expectedMedia.length > 10) {
    throw new HttpsError('failed-precondition', 'Reçu de non-exécution natif non qualifié.');
  }
  return { protocol: 'article_report_nonexecution_v1', actorUid: uid, reportId, articleId, requestId,
    tupleHash: anchor.tupleHash, reason: input.reason, description: input.description,
    articleRevision: input.expectedArticleRevision, contentHash: input.expectedArticleContentHash,
    neutralizedAt: anchor.neutralizedAt.toDate().toISOString(), state: 'not_executed', sourceExamined: false,
    reportCreated: false, authenticityVerified: false, photoRightsVerified: false };
}
/** The same private checkpoint is read by submit before its first write and
 * created by neutralization. Concurrent requests therefore serialize; merely
 * observing an absent report never authorizes a new intention. */
export async function readArticleReportNonexecution(uid: string, articleId: string, requestId: string,
  tx?: FirebaseFirestore.Transaction) {
  const ref = evidenceAnchorRef(articleReportIntentId(uid, articleId, requestId));
  const anchor = (await (tx ? tx.get(ref) : ref.get())).data();
  if (!anchor) return null;
  if (anchor.writer === 'submitReport_capture_v1') return null;
  return nonexecutionReceipt(anchor, uid, articleId, requestId);
}
export function assertArticleReportOutcomeTuple(receipt: { tupleHash: string }, tuple: Tuple) {
  if (receipt.tupleHash !== tuple.tupleHash) throw new HttpsError('failed-precondition', 'Cette intention a déjà un autre contenu.');
}
export async function neutralizeArticleReport(uid: string, payload: Record<string, unknown>, authorize?: ArticleReportAuthorization) {
  assertReportActor(uid, payload);
  if (typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 100 ||
      (payload.description !== undefined && payload.description !== null && typeof payload.description !== 'string')) {
    throw new HttpsError('invalid-argument', 'Le récit exact de cette intention est requis.');
  }
  const reason = payload.reason.trim(), description = typeof payload.description === 'string' ? payload.description.trim() || null : null;
  if (description && description.length > 2000) throw new HttpsError('invalid-argument', 'Description trop longue.');
  const tuple = articleReportTuple(uid, payload, reason, description);
  if (payload.expectedTupleHash !== tuple.tupleHash) throw new HttpsError('invalid-argument', 'Le hash de l’intention exacte est requis.');
  return authorizedArticleReport(authorize, () => db.runTransaction(async tx => {
    await authorize?.(tx);
    const priorNonexecution = await readArticleReportNonexecution(uid, tuple.articleId, tuple.requestId, tx);
    if (priorNonexecution) {
      assertArticleReportOutcomeTuple(priorNonexecution, tuple);
      return priorNonexecution;
    }
    const existing = await findArticleReportIntent(uid, tuple.articleId, tuple.requestId, tx);
    if (existing.report) {
      const receipt = await reportEvidenceReceipt(existing.report, existing.reportId, uid, tuple.requestId, tx);
      assertArticleReportOutcomeTuple(receipt, tuple);
      return { ...receipt, state: 'recorded' };
    }
    const checkpointRef = evidenceAnchorRef(tuple.reportId), checkpoint = await tx.get(checkpointRef);
    if (checkpoint.exists) throw new HttpsError('failed-precondition', 'Le checkpoint existant doit être rapproché du dossier.');
    const { tupleHash: _tupleHash, reportId: _reportId, ...input } = tuple;
    const anchor = { schemaVersion: 1, writer: 'submitReport_neutralize_v1', protocol: 'article_report_nonexecution_v1',
      actorUid: uid, reportId: tuple.reportId, articleId: tuple.articleId, requestId: tuple.requestId,
      tupleHash: tuple.tupleHash, input, neutralizedAt: Timestamp.now() };
    tx.create(checkpointRef, anchor);
    return nonexecutionReceipt(anchor, uid, tuple.articleId, tuple.requestId);
  }));
}
export async function observeArticleReport(uid: string, payload: Record<string, unknown>, authorize?: ArticleReportAuthorization) {
  assertReportActor(uid, payload);
  return authorizedArticleReport(authorize, async () => {
  const articleId = reportEvidenceId(payload.targetId, 'Annonce'), requestId = reportEvidenceId(payload.requestId, 'Intention');
  const nonexecution = await readArticleReportNonexecution(uid, articleId, requestId);
  if (nonexecution) return nonexecution;
  const { reportId, report } = await findArticleReportIntent(uid, articleId, requestId);
  if (!report) return { protocol: 'article_report_receipt_v1', actorUid: uid, articleId, reportId, requestId, state: 'unrecorded' };
  const anchor = await evidenceAnchorRef(reportId).get();
  if (!anchor.exists) return { protocol: 'article_report_receipt_v1', actorUid: uid, articleId, reportId, requestId,
    state: 'historical_unknown', conservation: 'historical_unknown' };
  return { ...await reportEvidenceReceipt(report, reportId, uid, requestId), state: 'recorded' };
  });
}
/** Recovery of the earlier native key is allowed only for its exact original
 * request. A legacy simple report supplies no native version or media proof. */
export async function findArticleReportIntent(uid: string, articleId: string, requestId: string,
  tx?: FirebaseFirestore.Transaction) {
  const reportId = articleReportIntentId(uid, articleId, requestId);
  const read = (id: string) => tx ? tx.get(db.collection('reports').doc(id)) : db.collection('reports').doc(id).get();
  const report = (await read(reportId)).data();
  if (report) return { reportId, report };
  const legacyId = `${uid}_article_${articleId}`, legacy = (await read(legacyId)).data();
  if (legacy?.articleEvidence?.requestId === requestId) {
    const anchorRef = evidenceAnchorRef(legacyId), anchor = await (tx ? tx.get(anchorRef) : anchorRef.get());
    if (anchor.exists) {
      await reportEvidenceReceipt(legacy, legacyId, uid, requestId, tx);
    }
    // Its alleged intention remains visible as unknown; do not overwrite it
    // or infer a server writer from fields alone.
    return { reportId: legacyId, report: legacy };
  }
  return { reportId, report: undefined };
}
export async function preserveReportEvidence(reportId: string, authorize?: ArticleReportAuthorization): Promise<void> {
  return authorizedArticleReport(authorize, async () => {
  const ref = db.collection('reports').doc(reportId), report = (await ref.get()).data();
  if (!report) throw new HttpsError('failed-precondition', 'Dossier photographique absent.');
  const evidence = await readQualifiedEvidence(report, reportId);
  for (const media of evidence.media as CapturedMedia[]) {
    if (media.state !== 'pending') continue;
    await authorize?.();
    let state: 'preserved' | 'needs_review' = 'needs_review', privateGeneration: string | null = null, reason: string | null = 'source_missing_or_unqualified';
    try {
      if (!media.sourcePath || media.qualification !== 'qualified') throw new Error('unqualified');
      privateGeneration = await preservePrivateImage(media.sourcePath, media.privatePath, media as unknown as PrivateImageWitness,
        evidence.requestId, media.mediaId);
      state = 'preserved'; reason = null;
    } catch (error) {
      if (!permanentMediaFailure(error)) throw new HttpsError('unavailable', 'La conservation photographique doit être reprise avant suppression.');
    }
    await authorize?.();
    await db.runTransaction(async tx => {
      await authorize?.(tx);
      const currentReport = (await tx.get(ref)).data();
      if (!currentReport) throw new HttpsError('failed-precondition', 'Dossier disparu pendant sa conservation.');
      const current = await readQualifiedEvidence(currentReport, reportId, tx);
      if (current.tupleHash !== evidence.tupleHash) throw new HttpsError('failed-precondition', 'Intention de conservation divergente.');
      const index = current.media.findIndex((m: CapturedMedia) => m.mediaId === media.mediaId);
      if (index < 0) throw new HttpsError('failed-precondition', 'Témoin média divergent.');
      if (current.media[index].state !== 'pending') return;
      const updated = [...current.media]; updated[index] = { ...updated[index], state, privateGeneration, reason };
      const conservation = updated.some((m: CapturedMedia) => m.state === 'pending') ? 'pending'
        : updated.some((m: CapturedMedia) => m.state === 'needs_review') ? 'needs_review' : 'preserved';
      tx.update(ref, { 'articleEvidence.media': updated, 'articleEvidence.state': conservation, 'articleEvidence.updatedAt': Timestamp.now() });
    });
  }
  // All initially unqualified sources have no copy attempt, but must finish as unknown.
  await db.runTransaction(async tx => {
    await authorize?.(tx);
    const currentReport = (await tx.get(ref)).data();
    if (!currentReport) throw new HttpsError('failed-precondition', 'Dossier absent.');
    const current = await readQualifiedEvidence(currentReport, reportId, tx);
    const state = current.media.some((m: CapturedMedia) => m.state === 'pending') ? 'pending'
      : current.media.some((m: CapturedMedia) => m.state === 'needs_review') ? 'needs_review' : 'preserved';
    if (current.state !== state) tx.update(ref, { 'articleEvidence.state': state, 'articleEvidence.updatedAt': Timestamp.now() });
  });
  });
}
/** Called after edit's article transaction and before destroying removed objects.
 * Capture serializes on that article; a preview of the old revision cannot be
 * accepted once edit committed. Unknown or saturated barriers never disappear. */
export async function preserveArticleReportEvidenceBeforeDeletion(articleId: string, sourcePaths: string[]): Promise<void> {
  const article = (await db.collection('articles').doc(articleId).get()).data();
  const ids = article?.articleReportEvidenceReportIds;
  if (ids === undefined) return;
  if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new HttpsError('failed-precondition', 'La barrière photographique demande un rapprochement avant suppression.');
  }
  for (const reportId of ids) {
    const report = (await db.collection('reports').doc(reportId).get()).data();
    if (!report) throw new HttpsError('failed-precondition', 'Protection photographique inconnue.');
    const evidence = await readQualifiedEvidence(report, reportId);
    if (evidence.articleId !== articleId) throw new HttpsError('failed-precondition', 'Protection photographique divergente.');
    if (evidence.media.some((m: CapturedMedia) => m.sourcePath && sourcePaths.includes(m.sourcePath) && m.state === 'pending')) await preserveReportEvidence(reportId);
    const after = await readQualifiedEvidence((await db.collection('reports').doc(reportId).get()).data()!, reportId);
    if (after.media.some((m: CapturedMedia) => m.sourcePath && sourcePaths.includes(m.sourcePath) && m.state === 'pending')) {
      throw new HttpsError('failed-precondition', 'Conservation photographique encore en cours.');
    }
  }
}
/** Caller rechecks CURRENT administrative authority before and after external IO. */
export async function readReportPrivateImage(reportId: string, mediaId: string) {
  if (!HASH.test(mediaId)) throw new HttpsError('invalid-argument', 'Média invalide.');
  const report = (await db.collection('reports').doc(reportId).get()).data();
  if (!report) throw new HttpsError('not-found', 'Signalement introuvable.');
  const evidence = await readQualifiedEvidence(report, reportId), media = evidence.media.find((m: CapturedMedia) => m.mediaId === mediaId);
  if (!media || media.state !== 'preserved' || !media.privateGeneration) throw new HttpsError('failed-precondition', 'Média privé non conservé.');
  const data = await readPrivateImage(media.privatePath, media as PrivateImageWitness, evidence.requestId, mediaId);
  const after = await readQualifiedEvidence((await db.collection('reports').doc(reportId).get()).data()!, reportId);
  const still = after.media.find((m: CapturedMedia) => m.mediaId === mediaId);
  if (after.tupleHash !== evidence.tupleHash || canonical(still) !== canonical(media)) throw new HttpsError('permission-denied', 'Le média ne correspond plus au dossier.');
  return { protocol: 'article_report_media_v1', reportId, articleId: evidence.articleId, mediaId,
    generation: media.privateGeneration, sourceGeneration: media.sourceGeneration, contentType: media.contentType, size: data.length,
    authenticityVerified: false, photoRightsVerified: false, dataUrl: `data:${media.contentType};base64,${data.toString('base64')}` };
}
export async function adminReportEvidenceProjection(report: FirebaseFirestore.DocumentData, reportId: string, tx?: FirebaseFirestore.Transaction) {
  if (!report.articleEvidence) return { protocol: 'article_report_evidence_v1', reportId, conservation: 'historical_unknown', snapshot: null, media: [],
    authenticityVerified: false, photoRightsVerified: false };
  let e;
  const anchorRef = evidenceAnchorRef(reportId), anchor = await (tx ? tx.get(anchorRef) : anchorRef.get());
  if (!anchor.exists) return { protocol: 'article_report_evidence_v1', reportId, conservation: 'historical_unknown', snapshot: null, media: [],
    authenticityVerified: false, photoRightsVerified: false };
  try { e = nativeEvidence(report, reportId, anchor.data()); }
  catch { return { protocol: 'article_report_evidence_v1', reportId, conservation: 'needs_review', snapshot: null, media: [],
    integrity: 'unqualified_native_capture', authenticityVerified: false, photoRightsVerified: false }; }
  const { images: _images, ...snapshot } = e.snapshot;
  return { protocol: 'article_report_evidence_v1', reportId, articleId: e.articleId, sellerId: e.sellerId, reporterId: e.reporterId,
    articleRevision: e.articleRevision, contentHash: e.contentHash, capturedAt: e.capturedAt.toDate().toISOString(), snapshot,
    conservation: e.state, media: e.media.map((m: CapturedMedia) => ({ index: m.index, mediaId: m.mediaId, state: m.state, reason: m.reason,
      contentType: m.contentType, size: m.size, sourceGeneration: m.sourceGeneration, privateGeneration: m.privateGeneration })),
    authenticityVerified: false, photoRightsVerified: false };
}
