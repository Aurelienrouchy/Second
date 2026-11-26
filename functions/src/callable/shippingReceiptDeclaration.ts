import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { prepareOperationalNotices } from '../utils/notifications';
import { RECEIPT_DECLARATION_PROTOCOL, RECEIPT_DECLARATION_STATEMENT, parseReceiptDeclarationInput,
  declarationRef, declarationCommandRef, declarationInputHash, qualifyDeclarationCommand, readReceiptDeclaration,
  readReceiptSource, receiptDeclarationNotice, declarationDTO, receiptCommandDTO, receiptReview,
  type DeclarationCommand, type ReceiptSource } from '../utils/shippingReceiptDeclaration';

/** Human declaration only: no delivered state, clock, fund release, dispute,
 * refund or return mutation. Historical access has no new-commerce admission. */
export const declareShippingReceipt = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async request => withPrivateAccountSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
  const uid = request.auth.uid, input = parseReceiptDeclarationInput(uid, request.data);
  const result = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const summaryRef = declarationRef(input.transactionId);
    const commandRef = input.mode === 'preview' ? null : declarationCommandRef(uid, input.requestId);
    // The caller's exact terminal receipt wins before any current condition.
    const prior = commandRef ? (await tx.get(commandRef)).data() : undefined;
    if (prior && input.mode !== 'preview') {
      const command = qualifyDeclarationCommand(prior, uid, input, commandRef!.id);
      let declaration: DeclarationCommand | null = null;
      if (command.state === 'committed') {
        declaration = await readReceiptDeclaration(tx, input.transactionId, (await tx.get(summaryRef)).data());
        if (!declaration || declaration.commandId !== command.commandId || declaration.inputHash !== command.inputHash) throw receiptReview();
      }
      return { role: 'buyer' as const, source: { buyerId: command.buyerId, sellerId: command.sellerId,
        qualification: command.state === 'committed' ? 'native_paid_contract' as const : 'needs_review' as const,
        sourceRevision: null, sourceHash: null }, command, declaration, sourceObservedCurrently: false, created: false };
    }
    const orderSnap = await tx.get(db.collection('transactions').doc(input.transactionId)), order = orderSnap.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Cette commande ne vous appartient pas.');
    const role = order.buyerId === uid ? 'buyer' as const : 'seller' as const;
    if (input.mode !== 'preview' && role !== 'buyer') throw new HttpsError('permission-denied', 'Seul l’acheteur peut déclarer la réception.');
    const rawDeclaration = (await tx.get(summaryRef)).data();
    const declaration = await readReceiptDeclaration(tx, input.transactionId, rawDeclaration);
    if (declaration && (declaration.buyerId !== order.buyerId || declaration.sellerId !== order.sellerId)) throw receiptReview();
    const source = await readReceiptSource(tx, input.transactionId, orderSnap);
    const current = { role, source, declaration, sourceObservedCurrently: true };
    if (input.mode === 'preview' || input.mode === 'observe') return { ...current, command: null, created: false };
    const recordedAt = Timestamp.now();
    const base = { schemaVersion: 1 as const, protocol: RECEIPT_DECLARATION_PROTOCOL as typeof RECEIPT_DECLARATION_PROTOCOL, commandId: commandRef!.id,
      inputHash: declarationInputHash(uid, input), actorUid: uid, buyerId: source.buyerId, sellerId: source.sellerId,
      transactionId: input.transactionId, requestId: input.requestId, statementVersion: RECEIPT_DECLARATION_PROTOCOL as typeof RECEIPT_DECLARATION_PROTOCOL,
      statement: RECEIPT_DECLARATION_STATEMENT as typeof RECEIPT_DECLARATION_STATEMENT, accepted: true as const, expectedSourceRevision: input.expectedSourceRevision,
      expectedSourceHash: input.expectedSourceHash, recordedAt };
    let state: DeclarationCommand['state'] = 'not_executed', reason: DeclarationCommand['reason'] = null;
    if (input.mode === 'neutralize') state = 'neutralized';
    else if (declaration) reason = 'already_declared';
    else if (source.qualification !== 'native_paid_contract') reason = 'source_unqualified';
    else if (source.sourceRevision !== input.expectedSourceRevision || source.sourceHash !== input.expectedSourceHash) reason = 'source_changed';
    else state = 'committed';
    const command: DeclarationCommand = { ...base, state, reason };
    if (state === 'committed') {
      const notices = await prepareOperationalNotices(tx, [receiptDeclarationNotice(command)]);
      command.notificationId = notices.notificationIds[0];
      await assertPrivateAccountSession(request, tx);
      tx.create(commandRef!, command);
      tx.create(summaryRef, command);
      notices.commit();
      return { ...current, command, declaration: command, created: true };
    }
    await assertPrivateAccountSession(request, tx);
    tx.create(commandRef!, command);
    return { ...current, command, created: true };
  });
  if (result.created) logger.info('Buyer shipping receipt declaration command recorded', {
    actorUid: uid, transactionId: input.transactionId, commandId: result.command?.commandId,
    state: result.command?.state, reason: result.command?.reason });
  const source: ReceiptSource = result.source;
  return { protocol: RECEIPT_DECLARATION_PROTOCOL, ownerId: uid, transactionId: input.transactionId, role: result.role,
    statementVersion: RECEIPT_DECLARATION_PROTOCOL, statement: RECEIPT_DECLARATION_STATEMENT,
    qualification: source.qualification, sourceRevision: source.sourceRevision, sourceHash: source.sourceHash,
    sourceObservedCurrently: result.sourceObservedCurrently, declaration: declarationDTO(result.declaration), command: receiptCommandDTO(result.command),
    financialEffectsApplied: false, deadlinesChanged: false, recoursesClosed: false };
}));
