import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoverySourceFields, prepareFinancialRecoverySource, financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
/** Private bank-change intention and explicit payout destination. No raw bank
 * number/routing number is persisted, returned or logged. Provider IO stays out
 * of transactions; an unknown creation is recovered only by positive identity. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { BANK_OWNERSHIP_STATEMENT, BANK_OWNERSHIP_STATEMENT_VERSION } from '../shared/bankConsent';
import { ELIGIBILITY_POLICY_VERSION } from '../shared/eligibility';
import { assertAccountOperationOpen, assertRecentAccountAuthentication } from './eligibility';
import { isDefinitiveStripeFailure } from './payoutOutcome';
import { nativeTime } from './stripeCheckoutProof';

type BankPrivateGuard = (tx?: FirebaseFirestore.Transaction) => Promise<unknown>;
type StripeClient = NonNullable<ReturnType<typeof getStripe>>;
const profileRef = (uid: string) => db.collection('eligibility_profiles').doc(uid);
const auditRef = (id: string) => db.collection('eligibility_audit').doc(id);
const terminal = new Set(['completed', 'rejected', 'candidate_unavailable', 'not_started']);
const accountId = (v: unknown): v is string => typeof v === 'string' && /^acct_[A-Za-z0-9_]{1,190}$/.test(v);
const bankId = (v: unknown): v is string => typeof v === 'string' && /^ba_[A-Za-z0-9_]{1,190}$/.test(v);
const failure = (reason: string) => new HttpsError('failed-precondition', 'Les renseignements bancaires doivent être vérifiés. Contactez notre équipe.',
  { reason, action: 'contactSupport' });

/** Provider prose may include bank coordinates. Only these documented codes,
 * parameter NAMES and an opaque Stripe request reference are diagnostic data. */
function logBankProviderFailure(uid: string, op: any, operation: 'create_bank' | 'select_bank' | 'delete_bank', error: unknown) {
  const value = error as {type?: unknown; rawType?: unknown; code?: unknown; param?: unknown; statusCode?: unknown; requestId?: unknown} | null;
  const types = new Set(['StripeInvalidRequestError','StripeCardError','StripeAPIError','StripeConnectionError',
    'StripeRateLimitError','StripeIdempotencyError','StripeAuthenticationError','StripePermissionError','StripeUnknownError']);
  const rawTypes = new Set(['invalid_request_error','card_error','api_error','idempotency_error','rate_limit_error']);
  const codes = new Set(['parameter_unknown','parameter_missing','parameter_invalid_empty','parameter_invalid_integer','parameter_invalid_string_blank',
    'bank_account_exists','bank_account_bad_routing_numbers','bank_account_unusable','bank_account_unverified',
    'routing_number_invalid','account_number_invalid','invalid_bank_account','resource_missing','idempotency_key_in_use',
    'account_invalid','country_unsupported','currency_not_supported','platform_account_required']);
  const params = new Set(['default_for_currency','external_account','external_account[routing_number]','external_account[account_number]',
    'external_account[account_holder_name]','external_account[country]','external_account[currency]',
    'account_holder_name','country','currency','metadata']);
  logger.warn('Bank provider operation failed', {userId: uid, operationId: op.id, requestId: op.requestId, operation,
    providerType: typeof value?.type === 'string' && types.has(value.type) ? value.type : null,
    providerRawType: typeof value?.rawType === 'string' && rawTypes.has(value.rawType) ? value.rawType : null,
    providerCode: typeof value?.code === 'string' && codes.has(value.code) ? value.code : null,
    providerParam: typeof value?.param === 'string' && params.has(value.param) ? value.param : null,
    providerRequestId: typeof value?.requestId === 'string' && /^req_[A-Za-z0-9]{1,128}$/.test(value.requestId) ? value.requestId : null,
    providerHttpStatus: Number.isSafeInteger(value?.statusCode) && Number(value?.statusCode) >= 400 && Number(value?.statusCode) <= 599 ? value!.statusCode : null});
}

/** Bind a sensitive intention to the UID captured by the initiating client.
 * A supplied mismatch is refused for reads too; legacy recovery may omit it. */
export function assertExpectedBankActor(uid: string, data: any, required = false) {
  if ((required || data?.expectedUid !== undefined) && data?.expectedUid !== uid) {
    throw new HttpsError('failed-precondition', 'La session a changé. Reprenez la demande depuis votre compte.',
      { reason: 'account_actor_changed', action: 'refreshSession' });
  }
}

export function bankHolderDeclaration(data: any, authTime: unknown) {
  const name = typeof data?.accountHolderName === 'string' ? data.accountHolderName.trim() : '';
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpsError('invalid-argument',
    'Le nom du titulaire ou cotitulaire est requis (200 caractères maximum).', { field: 'accountHolderName' });
  if (data.bankOwnershipAccepted !== true || data.bankOwnershipStatementVersion !== BANK_OWNERSHIP_STATEMENT_VERSION) {
    throw new HttpsError('failed-precondition', 'Confirmez que vous êtes titulaire ou cotitulaire de ce compte bancaire.',
      { reason: 'bank_ownership_declaration_required', field: 'bankOwnershipAccepted' });
  }
  return { accountHolderName: name, accepted: true, statementVersion: BANK_OWNERSHIP_STATEMENT_VERSION,
    statement: BANK_OWNERSHIP_STATEMENT, ownershipVerified: false, proofType: 'explicit_checkbox',
    authTime, acceptedAt: FieldValue.serverTimestamp(), acceptedAtMs: Date.now() };
}
function validDeclaration(value: any) {
  return value?.accepted === true && value.ownershipVerified === false && value.statementVersion === BANK_OWNERSHIP_STATEMENT_VERSION &&
    value.statement === BANK_OWNERSHIP_STATEMENT && value.proofType === 'explicit_checkbox' &&
    typeof value.accountHolderName === 'string' && value.accountHolderName.trim().length > 0 && value.accountHolderName.length <= 200 &&
    nativeTime(value.acceptedAt) && Number.isSafeInteger(value.acceptedAtMs) && Number.isSafeInteger(value.authTime) &&
    value.acceptedAtMs - value.authTime * 1000 >= -60_000 && value.acceptedAtMs - value.authTime * 1000 <= 5 * 60_000;
}
export function assertOwnedCanadianConnect(account: any, uid: string, expectedId: string) {
  if (!accountId(expectedId) || !account || account.id !== expectedId || account.deleted === true || account.type !== 'custom' ||
      account.business_type !== 'individual' || account.country !== 'CA' || account.metadata?.firebaseUserId !== uid) throw failure('bank_account_link_unqualified');
}
export function qualifiedCanadianBank(bank: any, expectedAccount: string): boolean {
  return !!bank && bank.object === 'bank_account' && bankId(bank.id) && bank.account === expectedAccount &&
    bank.country === 'CA' && bank.currency === 'cad' && typeof bank.last4 === 'string' && /^\d{4}$/.test(bank.last4) &&
    ['new', 'validated', 'verified'].includes(bank.status);
}
export function connectPayoutCapable(account: any): boolean {
  const requirements = account?.requirements;
  return account?.payouts_enabled === true && account.capabilities?.transfers === 'active' &&
    account.settings?.payouts?.schedule?.interval === 'manual' && requirements?.disabled_reason === null &&
    Array.isArray(requirements.past_due) && requirements.past_due.length === 0;
}
/** Owner-safe classification; risk labels and provider details are never
 * surfaced as a bank error. This observation grants no financial permission. */
export function ownerPayoutRestriction(uid: string, account?: any,
  bank?: {qualified: boolean; declared: boolean; lookupComplete: boolean}) {
  type Category = 'none' | 'restricted' | 'under_review' | 'information_required' | 'pending_verification' | 'bank_destination' | 'unknown';
  let category: Category = 'unknown';
  const requirements = account?.requirements, reason = requirements?.disabled_reason;
  const validList = (value: unknown): value is string[] => Array.isArray(value) && value.every(field => typeof field === 'string' && field.length > 0);
  const current = validList(requirements?.currently_due) ? requirements.currently_due as string[] : null;
  const overdue = validList(requirements?.past_due) ? requirements.past_due as string[] : null;
  const pending = validList(requirements?.pending_verification) ? requirements.pending_verification as string[] : null;
  if (typeof reason === 'string' && (reason.startsWith('rejected.') || reason === 'platform_paused')) category = 'restricted';
  else if (reason === 'under_review' || reason === 'listed') category = 'under_review';
  else if (reason !== null && !['requirements.past_due', 'requirements.pending_verification'].includes(reason)) category = 'unknown';
  else if (current === null || overdue === null || pending === null) category = 'unknown';
  else {
    const due = [...current, ...overdue];
    const identityDue = due.some(field => field !== 'external_account');
    if (identityDue) category = 'information_required';
    else if (reason === 'requirements.pending_verification' || pending.length > 0) category = 'pending_verification';
    else if (due.includes('external_account')) category = 'bank_destination';
    else if (reason === 'requirements.past_due') category = 'unknown';
    else if (connectPayoutCapable(account)) {
      if (!bank?.lookupComplete) category = 'unknown';
      else category = bank.qualified && bank.declared ? 'none' : 'bank_destination';
    }
  }
  const actions = {none: null, restricted: 'contactSupport', under_review: 'contactSupport', information_required: 'completeIdentityInformation',
    pending_verification: 'refreshStripeStatus', bank_destination: 'correctBankDetails', unknown: 'contactSupport'} as const;
  const messages = {none: 'Le compte et la destination bancaire ont été vérifiés pour cette observation.',
    restricted: 'Les retraits font l’objet d’une restriction sur le compte de paiement. Contactez notre équipe pour son examen.',
    under_review: 'Le compte de paiement fait l’objet d’un examen. Contactez notre équipe pour connaître les étapes disponibles.',
    information_required: 'Des renseignements de vérification du compte de paiement doivent être complétés dans l’application.',
    pending_verification: 'Des renseignements du compte de paiement sont en cours de vérification. Actualisez leur état.',
    bank_destination: 'La destination bancaire ou la déclaration de titulaire doit être complétée ou corrigée.',
    unknown: 'La disponibilité des retraits doit être vérifiée par notre équipe.'};
  return {protocol: 'connect_payout_restriction_v1' as const, ownerId: uid, observedAt: new Date().toISOString(), category,
    action: actions[category], message: messages[category], bankChangeResolvesRestriction: false as const, payoutPermissionGranted: false as const};
}
async function listBanks(stripe: StripeClient, id: string, privateGuard?: BankPrivateGuard) {
  const banks: any[] = []; let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    if(privateGuard)await privateGuard();
    const result = await stripe.accounts.listExternalAccounts(id, { object: 'bank_account', limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if(privateGuard)await privateGuard();
    banks.push(...result.data);
    if (!result.has_more) return banks;
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor) break;
  }
  throw failure('bank_accounts_lookup_incomplete');
}
function uniqueDefault(banks: any[], id: string) {
  const defaults = banks.filter(bank => bank.object === 'bank_account' && bank.account === id && bank.currency === 'cad' && bank.default_for_currency === true);
  if (defaults.length > 1) throw failure('bank_default_ambiguous');
  return defaults[0] ?? null;
}
function operationAction(state: string) {
  return state === 'completed' ? null : ['rejected', 'candidate_unavailable'].includes(state) ? 'correctBankDetails' :
    ['reconciliation_required', 'selection_unknown', 'deletion_unknown'].includes(state) ? 'contactSupport' : 'resumeBankOperation';
}
function dto(op: any) {
  if (op.state === 'not_started') throw new HttpsError('failed-precondition', 'Cette référence est clôturée sans opération bancaire démarrée.',
    { reason: 'bank_operation_not_started', requestId: op.requestId, operationId: op.id, action: 'discardRequestJournal' });
  const action = operationAction(op.state);
  return { success: op.state === 'completed', requestId: op.requestId, operationId: op.id, operationState: op.state,
    mode: op.mode ?? null, bankAccountId: bankId(op.bankAccountId) ? op.bankAccountId : null,
    bankAccountLast4: typeof op.last4 === 'string' ? op.last4 : null, bankAccountStatus: typeof op.bankStatus === 'string' ? op.bankStatus : null,
    previousBankPreserved: true, ownershipVerified: false, action };
}

/** The profile is the shared serialization document for NEW withdrawal debits,
 * provider authorizations and bank changes. Reads of a query alone cannot
 * exclude a withdrawal inserted immediately after that query. */
export function assertBankOperationIdle(profile: FirebaseFirestore.DocumentData | null | undefined) {
  if (profile?.bankOperation && !terminal.has(profile.bankOperation.state)) throw new HttpsError('failed-precondition',
    'Une modification bancaire est en cours. Attendez sa confirmation avant de demander un retrait.',
    {reason: 'bank_operation_in_progress', action: 'getStripeAccountStatus'});
}
export function commitBankWithdrawalBarrier(tx: FirebaseFirestore.Transaction, uid: string) {
  tx.set(profileRef(uid), {bankWithdrawalRevision: FieldValue.increment(1)}, {merge: true});
}

/** Complete bounded owner scan. The ordinary status read does not run it.
 * Unknown/legacy records remain dependencies; no financial receipt is edited. */
async function pendingBankWithdrawals(tx: FirebaseFirestore.Transaction, uid: string) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let page = 0; page < 20; page++) {
    let query = db.collection('withdrawal_requests').where('userId', '==', uid).orderBy('__name__').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const found = await tx.get(query);
    for (const row of found.docs) {
      const value = row.data();
      if (value.userId !== uid) return true;
      if (value.status === 'not_executed' && value.withdrawalNonExecution?.intentCommitted !== true &&
          !value.withdrawalIntent && !value.providerSubmission && !value.stripeTransferId && !value.stripePayoutId) continue;
      if (value.reconciliationRequired === true || value.payoutOutcome === 'unknown' || value.transferOutcome === 'unknown') return true;
      if (value.status === 'completed' && value.payoutOutcome === 'paid' && nativeTime(value.completedAt) &&
          value.payoutCompletion?.schemaVersion === 1 && value.payoutCompletion.ownerId === uid &&
          value.payoutCompletion.withdrawalRequestId === row.id && nativeTime(value.payoutCompletion.observedAt)) continue;
      if (value.status === 'failed' && value.payoutRecovery?.schemaVersion === 1 && value.payoutRecovery.state === 'recovered' &&
          value.payoutRecovery.ownerId === uid && value.payoutRecovery.requestId === row.id && nativeTime(value.payoutRecovery.compensatedAt)) continue;
      return true;
    }
    if (found.size < 100) return false;
    cursor = found.docs.at(-1)!;
  }
  throw failure('bank_withdrawals_lookup_incomplete');
}
async function assertNoPendingBankWithdrawal(tx: FirebaseFirestore.Transaction, uid: string) {
  if (await pendingBankWithdrawals(tx, uid)) throw new HttpsError('failed-precondition',
    'Un retrait est encore en cours. Vous pourrez modifier vos comptes bancaires une fois ce retrait terminé.',
    {reason: 'bank_withdrawal_in_progress', action: 'refreshWithdrawals'});
}
function attachedCanadianBank(bank: any, id: string): boolean {
  return bank?.object === 'bank_account' && bankId(bank.id) && bank.account === id && bank.country === 'CA' &&
    bank.currency === 'cad' && /^\d{4}$/.test(bank.last4 ?? '');
}
async function declarationForBank(tx: FirebaseFirestore.Transaction, uid: string, account: string, bank: any,
  profile: FirebaseFirestore.DocumentData) {
  const selected = profile.selectedBank;
  if (selected?.bankAccountId === bank.id && selected.accountId === account && selected.source === 'connect_creation_declaration' &&
      selected.operationId === profile.connectOperation?.id && profile.connectOperation?.state === 'linked' &&
      profile.connectOperation?.providerId === account && validDeclaration(profile.connectOperation.bankDeclaration)) return profile.connectOperation.bankDeclaration;
  const operationIds = new Set<string>();
  if (selected?.bankAccountId === bank.id && selected.accountId === account && selected.source === 'bank_operation' &&
      typeof selected.operationId === 'string') operationIds.add(selected.operationId);
  if (typeof bank.metadata?.secondBankOperationId === 'string' && /^bank_[a-f0-9]{64}$/.test(bank.metadata.secondBankOperationId) &&
      bank.metadata.firebaseUserId === uid) operationIds.add(bank.metadata.secondBankOperationId);
  for (const id of operationIds) {
    const op = (await tx.get(auditRef(id))).data();
    if (op?.action === 'account_bank_operation' && op.schemaVersion === 1 && op.ownerId === uid && op.id === id &&
        op.accountId === account && op.bankAccountId === bank.id && op.state === 'completed' &&
        op.mode !== 'delete_existing' && validDeclaration(op.declaration)) return op.declaration;
  }
  return null;
}

export async function ownerBankInventory(uid: string, account: any, stripe: StripeClient, privateGuard?: BankPrivateGuard) {
  assertOwnedCanadianConnect(account, uid, account.id);
  const banks = await listBanks(stripe, account.id, privateGuard);
  // An incomplete identity cannot become a manufactured masked bank card.
  if (banks.some(bank => !attachedCanadianBank(bank, account.id))) throw failure('bank_inventory_unqualified');
  uniqueDefault(banks, account.id);
  return db.runTransaction(async tx => {
    if (privateGuard) await privateGuard(tx);
    const user = (await tx.get(db.collection('users').doc(uid))).data();
    const profile = (await tx.get(profileRef(uid))).data() ?? {};
    if (user?.stripeAccountId !== account.id) throw failure('bank_account_link_unqualified');
    const pendingWithdrawal = await pendingBankWithdrawals(tx, uid);
    const activeOperation = !!profile.bankOperation && !terminal.has(profile.bankOperation.state);
    const rows = [];
    for (const bank of banks) {
      const declared = !!await declarationForBank(tx, uid, account.id, bank, profile);
      const selected = profile.selectedBank?.accountId === account.id && profile.selectedBank?.bankAccountId === bank.id;
      const blocked = selected ? 'selected_bank' : bank.default_for_currency === true ? 'default_bank' :
        activeOperation ? 'operation_in_progress' : pendingWithdrawal ? 'withdrawal_in_progress' : null;
      rows.push({id: bank.id as string, bankName: typeof bank.bank_name === 'string' && bank.bank_name.trim() ? bank.bank_name.trim().slice(0, 200) : null,
        last4: bank.last4 as string, currency: 'CAD' as const, country: 'CA' as const,
        status: typeof bank.status === 'string' && ['new','validated','verified','errored','verification_failed','tokenized_account_number_deactivated'].includes(bank.status) ? bank.status : null,
        isDefault: bank.default_for_currency === true, isSelected: selected,
        canSelect: !selected && !activeOperation && !pendingWithdrawal && qualifiedCanadianBank(bank, account.id),
        canDelete: blocked === null, deleteBlockedReason: blocked,
        selectionDeclarationRequired: !declared});
    }
    if (privateGuard) await privateGuard(tx);
    return {bankAccountsAvailable: true as const, bankAccounts: rows,
      bankChangesBlockedReason: activeOperation ? 'operation_in_progress' as const : pendingWithdrawal ? 'withdrawal_in_progress' as const : null};
  });
}

async function completeBankDeletion(uid: string, op: any, privateGuard?: BankPrivateGuard) {
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if (privateGuard) await privateGuard(tx);
    const source = await assertAccountOperationOpen(tx, uid, true, false);
    const stored = (await tx.get(auditRef(op.id))).data(); validOperation(stored, uid, op.id);
    if (stored!.state === 'completed') return dto(stored);
    if (stored!.mode !== 'delete_existing' || !['deleting', 'deletion_unknown'].includes(stored!.state) ||
        !nativeTime(stored!.deleteAuthorizedAt) || stored!.bankAccountId !== op.bankAccountId ||
        source.user!.stripeAccountId !== op.accountId || source.profile?.bankOperation?.id !== op.id ||
        source.profile?.selectedBank?.bankAccountId === op.bankAccountId || terminal.has(stored!.state)) throw failure('bank_operation_conflict');
    if (privateGuard) await privateGuard(tx);
    await recoveryCommit({refs: [auditRef(op.id).path, profileRef(uid).path]});
    tx.update(auditRef(op.id), await financialRecoverySourceFields('bank_operation', auditRef(op.id), stored!,
      {state: 'completed', completedAt: FieldValue.serverTimestamp(), leaseUntilMs: 0, bankStatus: null, deletionObserved: true}));
    tx.update(profileRef(uid), {'bankOperation.state': 'completed'});
    return dto({...stored, state: 'completed', bankStatus: null});
  });
}

/** Existing-bank mutations never re-send a provider effect on a resume. The
 * selected bank, native declaration and current owner are reserved together. */
async function manageExistingBank(uid: string, data: any, stripe: StripeClient, token: {auth_time?: unknown},
  previous: FirebaseFirestore.DocumentData | null, id: string, attemptId: string, privateGuard?: BankPrivateGuard) {
  let op = previous;
  let fresh = false;
  const record = (state: string, fields: Record<string, unknown> = {}) => recordState(uid, id, state, fields, privateGuard);
  if (!op) {
    assertExpectedBankActor(uid, data, true); assertRecentAccountAuthentication(token);
    if (!bankId(data.bankAccountId)) throw new HttpsError('invalid-argument', 'Choisissez un compte bancaire.');
    const source = await db.runTransaction(async tx => {if (privateGuard) await privateGuard(tx); return assertAccountOperationOpen(tx, uid, true);});
    const linked = source.user!.stripeAccountId;
    if (!accountId(linked)) throw failure('bank_account_link_missing');
    if (privateGuard) await privateGuard();
    const account = await stripe.accounts.retrieve(linked);
    if (privateGuard) await privateGuard(); assertOwnedCanadianConnect(account, uid, linked);
    if (account.settings?.payouts?.schedule?.interval !== 'manual') throw failure('bank_manual_schedule_required');
    const banks = await listBanks(stripe, linked, privateGuard);
    const bank = banks.find(candidate => candidate.id === data.bankAccountId);
    if (!attachedCanadianBank(bank, linked)) throw failure('bank_candidate_unqualified');
    uniqueDefault(banks, linked);
    const reserved = await db.runTransaction(async tx => {
      const recoveryCommit = financialRecoveryCommitCheckpoint();
      if (privateGuard) await privateGuard(tx);
      const before = await tx.get(auditRef(id));
      if (before.exists) {const existing = before.data()!; validOperation(existing, uid, id); return {op: existing, created: false};}
      const evidence = await assertAccountOperationOpen(tx, uid, true);
      assertRecentAccountAuthentication(token);
      if (evidence.user!.stripeAccountId !== linked) throw failure('bank_account_link_unqualified');
      assertBankOperationIdle(evidence.profile);
      await assertNoPendingBankWithdrawal(tx, uid);
      const selected = evidence.profile?.selectedBank;
      let declaration: any = null;
      if (data.mode === 'delete_existing') {
        if (selected?.bankAccountId === bank.id && selected.accountId === linked) throw new HttpsError('failed-precondition',
          'Remplacez le compte utilisé pour vos retraits avant de le supprimer.', {reason: 'bank_selected_protected'});
        if (bank.default_for_currency === true) throw new HttpsError('failed-precondition',
          'Choisissez un autre compte pour vos retraits avant de supprimer celui-ci.', {reason: 'bank_default_protected'});
      } else {
        if (!qualifiedCanadianBank(bank, linked)) throw failure('bank_candidate_unqualified');
        declaration = await declarationForBank(tx, uid, linked, bank, evidence.profile ?? {});
        if (!declaration) declaration = bankHolderDeclaration(data, token.auth_time);
      }
      const value = {action: 'account_bank_operation', schemaVersion: 1, ownerId: uid, actorUid: uid, id, requestId: data.requestId,
        source: 'addBankAccount', policyVersion: ELIGIBILITY_POLICY_VERSION, mode: data.mode, accountId: linked,
        bankAccountId: bank.id, previousBankAccountId: selected?.bankAccountId ?? null, declaration,
        inputHash: createHash('sha256').update(JSON.stringify([uid, data.requestId, data.mode, linked, bank.id])).digest('hex'),
        // The phase change creating -> deleting is part of the existing
        // financial source hash: reservation alone never authorizes DELETE.
        state: 'creating', attemptId, leaseUntilMs: Date.now() + 120_000,
        last4: bank.last4, bankStatus: bank.status ?? null, createdAt: FieldValue.serverTimestamp()};
      if (privateGuard) await privateGuard(tx);
      await recoveryCommit({refs: [auditRef(id).path, profileRef(uid).path]});
      tx.create(auditRef(id), await financialRecoverySourceFields('bank_operation', auditRef(id), before, value));
      tx.set(profileRef(uid), {bankOperation: {id, requestId: data.requestId, state: value.state, accountId: linked}}, {merge: true});
      return {op: value, created: true};
    });
    op = reserved.op; fresh = reserved.created;
  }
  validOperation(op, uid, id);
  if (terminal.has(op!.state)) return dto(op);
  if (privateGuard) await privateGuard();
  const account = await stripe.accounts.retrieve(op!.accountId);
  if (privateGuard) await privateGuard(); assertOwnedCanadianConnect(account, uid, op!.accountId);
  const banks = await listBanks(stripe, op!.accountId, privateGuard);
  const bank = banks.find(candidate => candidate.id === op!.bankAccountId);
  if (op!.mode === 'delete_existing') {
    if (!bank && nativeTime(op!.deleteAuthorizedAt)) return completeBankDeletion(uid, op, privateGuard);
    if (!fresh) return dto(op!.leaseUntilMs > Date.now() && ['creating', 'deleting'].includes(op!.state) ? op :
      await record(nativeTime(op!.deleteAuthorizedAt) ? 'deletion_unknown' : 'rejected', {leaseUntilMs: 0}));
    if (!attachedCanadianBank(bank, op!.accountId) || bank.default_for_currency === true) return dto(await record('rejected', {leaseUntilMs: 0}));
  } else {
    if (!qualifiedCanadianBank(bank, op!.accountId)) return dto(await record('candidate_unavailable', {leaseUntilMs: 0}));
    if (bank.default_for_currency === true) return completeBank(uid, op, bank, privateGuard);
    if (!fresh) return dto(op!.leaseUntilMs > Date.now() && ['creating', 'selecting'].includes(op!.state) ? op :
      await record(nativeTime(op!.selectionAuthorizedAt) ? 'selection_unknown' : 'rejected', {leaseUntilMs: 0}));
  }
  // Revalidate the native reservation and owner immediately before the only
  // authorized external effect. This profile write serializes wallet debits.
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if (privateGuard) await privateGuard(tx);
    const evidence = await assertAccountOperationOpen(tx, uid, true);
    const stored = (await tx.get(auditRef(id))).data(); validOperation(stored, uid, id);
    assertRecentAccountAuthentication(token);
    if (evidence.user!.stripeAccountId !== op!.accountId || evidence.profile?.bankOperation?.id !== id ||
        stored!.attemptId !== attemptId || stored!.state !== 'creating' || nativeTime(stored!.deleteAuthorizedAt) ||
        nativeTime(stored!.selectionAuthorizedAt) || stored!.bankAccountId !== bank.id ||
        op!.mode === 'delete_existing' && evidence.profile?.selectedBank?.bankAccountId === bank.id) throw failure('bank_operation_conflict');
    await assertNoPendingBankWithdrawal(tx, uid);
    if (privateGuard) await privateGuard(tx);
    const state = op!.mode === 'delete_existing' ? 'deleting' : 'selecting';
    const fields = {state, [op!.mode === 'delete_existing' ? 'deleteAuthorizedAt' : 'selectionAuthorizedAt']: FieldValue.serverTimestamp()};
    await recoveryCommit({refs: [auditRef(id).path, profileRef(uid).path]});
    tx.update(auditRef(id), await financialRecoverySourceFields('bank_operation', auditRef(id), stored!, fields));
    tx.update(profileRef(uid), {'bankOperation.state': state});
  });
  if (privateGuard) await privateGuard();
  if (op!.mode === 'delete_existing') {
    try {
      const result = await stripe.accounts.deleteExternalAccount(op!.accountId, bank.id, {}, {idempotencyKey: 'bank_delete_' + id});
      if (result.id !== bank.id || result.deleted !== true) return dto(await record('deletion_unknown', {leaseUntilMs: 0}));
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logBankProviderFailure(uid, op, 'delete_bank', error);
      return dto(await record(isDefinitiveStripeFailure(error) ? 'rejected' : 'deletion_unknown', {leaseUntilMs: 0}));
    }
    if (privateGuard) await privateGuard();
    return completeBankDeletion(uid, op, privateGuard);
  }
  try {
    const result = await stripe.accounts.updateExternalAccount(op!.accountId, bank.id, {default_for_currency: true}, {idempotencyKey: 'bank_default_' + id});
    if (privateGuard) await privateGuard();
    if (!qualifiedCanadianBank(result, op!.accountId) || result.default_for_currency !== true) return dto(await record('selection_unknown', {leaseUntilMs: 0}));
    return completeBank(uid, op, result, privateGuard);
  } catch (error) {
    if (error instanceof FinancialRecoveryBlocked) throw error;
    logBankProviderFailure(uid, op, 'select_bank', error);
    return dto(await record(isDefinitiveStripeFailure(error) ? 'rejected' : 'selection_unknown', {leaseUntilMs: 0}));
  }
}
function validOperation(op: any, uid: string, id: string) {
  if (!op || op.action !== 'account_bank_operation' || op.schemaVersion !== 1 || op.ownerId !== uid || op.id !== id ||
      (op.state !== 'not_started' && !accountId(op.accountId))) throw failure('bank_operation_unqualified');
}
async function recordState(uid: string, id: string, state: string, fields: Record<string, unknown> = {}, privateGuard?: BankPrivateGuard) {
  return db.runTransaction(async tx => {
    if(privateGuard)await privateGuard(tx);
    const op = (await tx.get(auditRef(id))).data(); validOperation(op, uid, id);
    const profile = (await tx.get(profileRef(uid))).data();
    if (profile?.bankOperation?.id !== id) throw failure('bank_operation_conflict');
    if (terminal.has(op!.state)) return op!;
    if (['selecting', 'selection_unknown', 'reconciliation_required'].includes(op!.state) && ['creating', 'unknown'].includes(state)) return op!;
    // An unusable bank cannot neutralize a default-selection call in flight.
    if (state === 'candidate_unavailable' && ['selecting', 'selection_unknown'].includes(op!.state)) state = 'reconciliation_required';
    const next = { ...op, ...fields, state };
    if(privateGuard)await privateGuard(tx);
    tx.update(auditRef(id), await financialRecoverySourceFields('bank_operation',auditRef(id),op!,{...fields,state,updatedAt:FieldValue.serverTimestamp()}));
    tx.update(profileRef(uid), { 'bankOperation.state': state });
    return next;
  });
}
async function completeBank(uid: string, op: any, bank: any, privateGuard?: BankPrivateGuard) {
  if (!qualifiedCanadianBank(bank, op.accountId)) throw failure('bank_candidate_unqualified');
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if(privateGuard)await privateGuard(tx);
    const evidence = await assertAccountOperationOpen(tx, uid, true, false);
    const stored = (await tx.get(auditRef(op.id))).data(); validOperation(stored, uid, op.id);
    if (stored!.state === 'completed') return dto(stored);
    if (terminal.has(stored!.state)) throw failure('bank_operation_terminal');
    if (evidence.user!.stripeAccountId !== op.accountId || evidence.profile?.bankOperation?.id !== op.id ||
        stored!.bankAccountId !== bank.id || !validDeclaration(stored!.declaration)) throw failure('bank_operation_conflict');
    await assertNoPendingBankWithdrawal(tx, uid);
    const selected = { schemaVersion: 1, accountId: op.accountId, bankAccountId: bank.id, operationId: op.id,
      source: 'bank_operation', last4: bank.last4, status: bank.status, declared: true, ownershipVerified: false, observedAtMs: Date.now() };
    if(privateGuard)await privateGuard(tx);
    await recoveryCommit({refs: [(auditRef(op.id)).path]});
    tx.update(auditRef(op.id), await financialRecoverySourceFields('bank_operation',auditRef(op.id),stored!,{state:'completed',last4:bank.last4,bankStatus:bank.status,
      completedAt:FieldValue.serverTimestamp(),leaseUntilMs:0,updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(profileRef(uid)).path]});
    tx.set(profileRef(uid), { selectedBank: selected, bankOperation: { id: op.id, requestId: op.requestId, state: 'completed', accountId: op.accountId } }, { merge: true });
    await recoveryCommit({refs: [(db.collection('users').doc(uid)).path]});
    tx.update(db.collection('users').doc(uid), { stripeBankAccountAdded: true, stripeBankAccountLast4: bank.last4, stripeBankAccountStatus: bank.status });
    return dto({ ...stored, state: 'completed', last4: bank.last4, bankStatus: bank.status });
  });
}

export async function manageBankAccount(uid: string, data: any, stripe: StripeClient, token: { auth_time?: unknown }, privateGuard?: BankPrivateGuard) {
  if(privateGuard)await privateGuard();
  assertExpectedBankActor(uid, data);
  if (typeof data?.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId)) throw new HttpsError('invalid-argument', 'Référence de demande bancaire requise.', { field: 'requestId' });
  const id = 'bank_' + createHash('sha256').update(JSON.stringify([uid, data.requestId])).digest('hex');
  const attemptId = randomUUID();
  const record=(id:string,state:string,fields:Record<string,unknown>={})=>recordState(uid,id,state,fields,privateGuard);
  let op: FirebaseFirestore.DocumentData | null = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if(privateGuard)await privateGuard(tx);
    const requested = (await tx.get(auditRef(id))).data();
    const profile = (await tx.get(profileRef(uid))).data();
    if (requested) { validOperation(requested, uid, id); return requested; }
    const active = profile?.bankOperation;
    if (active && !terminal.has(active.state)) {
      const previous = (await tx.get(auditRef(active.id))).data(); validOperation(previous, uid, active.id);
      if(privateGuard)await privateGuard(tx);
      await recoveryCommit({refs: [(auditRef(id)).path]});
    tx.create(auditRef(id), { action: 'account_bank_operation', schemaVersion: 1, ownerId: uid, actorUid: uid, id,
        requestId: data.requestId, accountId: null, state: 'not_started', supersededByOperationId: active.id,
        inputHash: id.slice(5), source: 'addBankAccount_request_superseded', policyVersion: ELIGIBILITY_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(), stoppedAt: FieldValue.serverTimestamp() });
      return previous!;
    }
    if (Object.keys(data).every(key => key === 'requestId' || key === 'expectedUid')) {
      // This durable terminal receipt also fences an original request arriving
      // late: its reservation must re-read this exact operation ID before IO.
      const stopped = { action: 'account_bank_operation', schemaVersion: 1, ownerId: uid, actorUid: uid, id,
        requestId: data.requestId, accountId: null, state: 'not_started', inputHash: id.slice(5),
        source: 'addBankAccount_read_resume', policyVersion: ELIGIBILITY_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(), stoppedAt: FieldValue.serverTimestamp() };
      if(privateGuard)await privateGuard(tx);
      await recoveryCommit({refs: [(auditRef(id)).path]});
    tx.create(auditRef(id), stopped); return stopped;
    }
    return null;
  });
  if (op && terminal.has(op.state)) return dto(op);
  const requestedMode = op?.mode ?? data.mode;
  if (requestedMode === 'select_existing' || requestedMode === 'delete_existing') {
    return manageExistingBank(uid, data, stripe, token, op, op?.id ?? id, attemptId, privateGuard);
  }
  let freshInput: any = null;
  if (!op) {
    assertExpectedBankActor(uid, data, true);
    assertRecentAccountAuthentication(token);
    const declaration = bankHolderDeclaration(data, token.auth_time), mode = data.mode ?? 'replace';
    if (!['replace', 'declare_current'].includes(mode)) throw new HttpsError('invalid-argument', 'Mode bancaire invalide');
    if (mode === 'replace' && (typeof data.transitNumber !== 'string' || !/^\d{5}$/.test(data.transitNumber) ||
        typeof data.institutionNumber !== 'string' || !/^\d{3}$/.test(data.institutionNumber) ||
        typeof data.accountNumber !== 'string' || !/^\d{7,12}$/.test(data.accountNumber))) throw new HttpsError('invalid-argument', 'Renseignements bancaires canadiens invalides');
    const source = await db.runTransaction(async tx=>{if(privateGuard)await privateGuard(tx);return assertAccountOperationOpen(tx,uid,true);});
    const linked = source.user!.stripeAccountId;
    if (!accountId(linked)) throw failure('bank_account_link_missing');
    if(privateGuard)await privateGuard();
    const account = await stripe.accounts.retrieve(linked);if(privateGuard)await privateGuard();assertOwnedCanadianConnect(account, uid, linked);
    if (account.settings?.payouts?.schedule?.interval !== 'manual') throw failure('bank_manual_schedule_required');
    const banks = await listBanks(stripe, linked,privateGuard);
    const defaultBank = uniqueDefault(banks, linked);
    // Withdrawals use the explicit native selection, which can legitimately
    // differ from Stripe's currency default. A declaration must bind that
    // exact selected ba_, never borrow the declaration of the provider default.
    const selectedAtRead = source.profile?.selectedBank;
    const current = mode === 'declare_current' && selectedAtRead != null
      ? selectedAtRead.accountId === linked && bankId(selectedAtRead.bankAccountId)
        ? banks.find(candidate => candidate.id === selectedAtRead.bankAccountId) : null
      : defaultBank;
    if (mode === 'declare_current' && (!bankId(data.bankAccountId) || current?.id !== data.bankAccountId || !qualifiedCanadianBank(current, linked))) {
      throw failure('bank_current_destination_changed');
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw failure('bank_configuration_unavailable');
    const inputHash = createHmac('sha256', secret).update(JSON.stringify({ mode, declaration: declaration.accountHolderName,
      transit: data.transitNumber ?? null, institution: data.institutionNumber ?? null, number: data.accountNumber ?? null,
      bankAccountId: data.bankAccountId ?? null })).digest('hex');
    const reserved = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if(privateGuard)await privateGuard(tx);
      const missingOperation=await tx.get(auditRef(id)),previous=missingOperation.data();
      if (previous) { validOperation(previous, uid, id); return { op: previous, created: false }; }
      const evidence = await assertAccountOperationOpen(tx, uid, true);
      assertRecentAccountAuthentication(token);
      if (evidence.user!.stripeAccountId !== linked || (evidence.profile?.bankOperation && !terminal.has(evidence.profile.bankOperation.state))) throw failure('bank_operation_conflict');
      if (mode === 'declare_current' && bankSelectionIdentity(evidence.profile?.selectedBank) !== bankSelectionIdentity(selectedAtRead)) {
        throw failure('bank_current_destination_changed');
      }
      await assertNoPendingBankWithdrawal(tx, uid);
      const value = { action: 'account_bank_operation', schemaVersion: 1, ownerId: uid, actorUid: uid, id, requestId: data.requestId,
        source: 'addBankAccount', policyVersion: ELIGIBILITY_POLICY_VERSION, inputHash, accountId: linked, mode, declaration,
        previousBankAccountId: current?.id ?? null, bankAccountId: mode === 'declare_current' ? current.id : null,
        state: 'creating', attemptId, leaseUntilMs: Date.now() + 120_000, createdAt: FieldValue.serverTimestamp() };
      if(privateGuard)await privateGuard(tx);
      await recoveryCommit({refs: [(auditRef(id)).path]});
    tx.create(auditRef(id), await financialRecoverySourceFields('bank_operation',auditRef(id),missingOperation,value));
      await recoveryCommit({refs: [(profileRef(uid)).path]});
    tx.set(profileRef(uid), { bankOperation: { id, requestId: data.requestId, state: 'creating', accountId: linked } }, { merge: true });
      return { op: value, created: true };
    });
    op = reserved.op;
    if (reserved.created && mode === 'declare_current') return completeBank(uid, op, current,privateGuard);
    if (reserved.created) freshInput = data;
  }
  validOperation(op, uid, op!.id);
  if (terminal.has(op!.state)) return dto(op);
  if(privateGuard)await privateGuard();
  const account = await stripe.accounts.retrieve(op!.accountId);if(privateGuard)await privateGuard();assertOwnedCanadianConnect(account, uid, op!.accountId);
  if (account.settings?.payouts?.schedule?.interval !== 'manual') throw failure('bank_manual_schedule_required');
  let bank: any = null;
  if (freshInput) {
    // Only this freshly reserved operation may create its candidate. Unknown
    // earlier operations continue through GET-only recovery below.
    await db.runTransaction(async tx=>{if(privateGuard)await privateGuard(tx);const evidence=await assertAccountOperationOpen(tx,uid,true);
      const current=(await tx.get(auditRef(op!.id))).data();validOperation(current,uid,op!.id);
      if(current!.state!=='creating'||current!.attemptId!==attemptId||current!.bankAccountId||
        evidence.user!.stripeAccountId!==op!.accountId||evidence.profile?.bankOperation?.id!==op!.id)throw failure('bank_operation_conflict');
      await assertNoPendingBankWithdrawal(tx, uid);
      if(privateGuard)await privateGuard(tx);
      await prepareFinancialRecoverySource('bank_operation',auditRef(op!.id).path,current!);});
    if(privateGuard)await privateGuard();
    try {
      bank = await stripe.accounts.createExternalAccount(op!.accountId, { external_account: { object: 'bank_account', country: 'CA', currency: 'cad',
        routing_number: freshInput.transitNumber + freshInput.institutionNumber, account_number: freshInput.accountNumber,
        account_holder_name: op!.declaration.accountHolderName, account_holder_type: 'individual' },
        // Stripe rejects explicit false here. Omission preserves the existing
        // currency default; only the separately journaled update selects NEW.
        metadata: { firebaseUserId: uid, secondBankOperationId: op!.id } }, { idempotencyKey: 'bank_create_' + op!.id });
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logBankProviderFailure(uid, op, 'create_bank', error);
      op = await record(op!.id, isDefinitiveStripeFailure(error) ? 'rejected' : 'unknown', { leaseUntilMs: 0 });
      return dto(op);
    }
    if(privateGuard)await privateGuard();
    if (!bankId(bank?.id) || bank.account !== op!.accountId || bank.metadata?.secondBankOperationId !== op!.id || bank.metadata?.firebaseUserId !== uid) {
      return dto(await record(op!.id, 'reconciliation_required', { leaseUntilMs: 0 }));
    }
    op = await record(op!.id, 'creating', { bankAccountId: bank.id });
  } else if (bankId(op!.bankAccountId)) {
    if(privateGuard)await privateGuard();
    bank = await stripe.accounts.retrieveExternalAccount(op!.accountId, op!.bankAccountId);
    if(privateGuard)await privateGuard();
  } else {
    const matches = (await listBanks(stripe, op!.accountId,privateGuard)).filter(candidate => candidate.metadata?.secondBankOperationId === op!.id && candidate.metadata?.firebaseUserId === uid);
    if (matches.length !== 1) return dto(op);
    bank = matches[0]; op = await record(op!.id, op!.state, { bankAccountId: bank.id });
  }
  if (!qualifiedCanadianBank(bank, op!.accountId)) return dto(await record(op!.id,
    bank?.object === 'bank_account' && bank.account === op!.accountId && bank.country === 'CA' && bank.currency === 'cad' &&
      /^\d{4}$/.test(bank?.last4 ?? '') && ['errored', 'verification_failed', 'tokenized_account_number_deactivated'].includes(bank.status)
      ? 'candidate_unavailable' : 'reconciliation_required', { leaseUntilMs: 0,
    last4: bank?.account === op!.accountId && /^\d{4}$/.test(bank?.last4 ?? '') ? bank.last4 : null,
    bankStatus: typeof bank?.status === 'string' && ['new', 'validated', 'verified', 'errored', 'verification_failed', 'tokenized_account_number_deactivated'].includes(bank.status) ? bank.status : null }));
  if (op!.mode === 'declare_current' || bank.default_for_currency === true) return completeBank(uid, op, bank,privateGuard);
  if (op!.state === 'selection_unknown') return dto(op);
  if (op!.state === 'selecting') return dto(op!.leaseUntilMs > Date.now() ? op : await record(op!.id, 'selection_unknown', { leaseUntilMs: 0 }));
  assertRecentAccountAuthentication(token);
  const claimed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if(privateGuard)await privateGuard(tx);
    const evidence = await assertAccountOperationOpen(tx, uid, true);
    const stored = (await tx.get(auditRef(op!.id))).data(); validOperation(stored, uid, op!.id);
    if (terminal.has(stored!.state) || ['selecting', 'selection_unknown', 'reconciliation_required'].includes(stored!.state)) return { claimed: false, op: stored };
    if (evidence.user!.stripeAccountId !== op!.accountId || evidence.profile?.bankOperation?.id !== op!.id) throw failure('bank_operation_conflict');
    if (stored!.bankAccountId !== bank.id || (stored!.leaseUntilMs > Date.now() && stored!.attemptId !== attemptId)) return { claimed: false, op: stored };
    await assertNoPendingBankWithdrawal(tx, uid);
    if(privateGuard)await privateGuard(tx);
    await recoveryCommit({refs: [(auditRef(op!.id)).path]});
    tx.update(auditRef(op!.id), await financialRecoverySourceFields('bank_operation',auditRef(op!.id),stored!,{state:'selecting',attemptId,leaseUntilMs:Date.now()+120_000,updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(profileRef(uid)).path]});
    tx.update(profileRef(uid), { 'bankOperation.state': 'selecting' }); return { claimed: true, op: stored };
  });
  if (!claimed.claimed) return dto(claimed.op);
  if(privateGuard)await privateGuard();
  try { bank = await stripe.accounts.updateExternalAccount(op!.accountId, bank.id, { default_for_currency: true }, { idempotencyKey: 'bank_default_' + op!.id }); }
  catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;
      logBankProviderFailure(uid, op, 'select_bank', recoveryFailure);
      return dto(await record(op!.id, 'selection_unknown', { leaseUntilMs: 0 })); }
  if(privateGuard)await privateGuard();
  if (bank.default_for_currency !== true || !qualifiedCanadianBank(bank, op!.accountId)) return dto(await record(op!.id, 'selection_unknown', { leaseUntilMs: 0 }));
  return completeBank(uid, op, bank,privateGuard);
}

/** The declaration is private and bound to the exact external ID. No historical
 * declaration is fabricated for a legacy bank; declare_current services it. */
export async function bankOwnerStatus(uid: string, account: any, stripe: StripeClient, privateGuard?: BankPrivateGuard) {
  const readSource=async(tx:FirebaseFirestore.Transaction)=>{
    if(privateGuard){await privateGuard(tx);const user=(await tx.get(db.collection('users').doc(uid))).data();
      if(user?.stripeAccountId!==account.id)throw failure('bank_account_link_unqualified');}
    const profile = (await tx.get(profileRef(uid))).data() ?? {};
    const selected = profile.selectedBank;
    let declaration: any = null;
    if (selected?.source === 'bank_operation' && typeof selected.operationId === 'string') {
      const op = (await tx.get(auditRef(selected.operationId))).data();
      if (op?.action === 'account_bank_operation' && op.ownerId === uid && op.state === 'completed' && op.bankAccountId === selected.bankAccountId && op.accountId === account.id) declaration = op.declaration;
    } else if (selected?.source === 'connect_creation_declaration' && profile.connectOperation?.id === selected.operationId && profile.connectOperation?.state === 'linked') declaration = profile.connectOperation.bankDeclaration;
    if(privateGuard)await privateGuard(tx);
    return { profile, selected, declared: validDeclaration(declaration) };
  };
  let source=await db.runTransaction(readSource);
  assertOwnedCanadianConnect(account, uid, account.id);
  let bank: any = null, lookupComplete = true;
  if(privateGuard)await privateGuard();
  try { bank = bankId(source.selected?.bankAccountId) ? await stripe.accounts.retrieveExternalAccount(account.id, source.selected.bankAccountId) : uniqueDefault(await listBanks(stripe, account.id,privateGuard), account.id); }
  catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; lookupComplete = false; /* Missing IO grants no payout permission or inferred bank repair. */ }
  if(privateGuard){await privateGuard();const current=await db.runTransaction(readSource);
    if(JSON.stringify([current.selected,current.profile.bankOperation,current.declared])!==JSON.stringify([source.selected,source.profile.bankOperation,source.declared]))throw failure('bank_operation_conflict');
    source=current;}
  const qualified = qualifiedCanadianBank(bank, account.id), declared = source.declared && source.selected?.accountId === account.id && source.selected?.bankAccountId === bank?.id;
  const operation = source.profile.bankOperation;
  return { bankAccountId: bankId(bank?.id) && bank.account === account.id ? bank.id : null,
    bankAccountLast4: bank?.account === account.id && /^\d{4}$/.test(bank?.last4 ?? '') ? bank.last4 : null,
    bankAccountStatus: qualified ? bank.status : typeof bank?.status === 'string' && ['errored', 'verification_failed', 'tokenized_account_number_deactivated'].includes(bank.status) ? bank.status : null,
    bankDeclarationRequired: !declared, ownershipVerified: false, payoutEligible: qualified && declared && connectPayoutCapable(account),
    payoutRestriction: ownerPayoutRestriction(uid, account, {qualified, declared, lookupComplete}),
    bankOperation: operation ? { requestId: operation.requestId, operationId: operation.id, state: operation.state, action: operationAction(operation.state) } : null,
    selected: source.selected ?? null };
}
export function bankSelectionIdentity(selected: any): string {
  return createHash('sha256').update(JSON.stringify([selected?.accountId ?? null, selected?.bankAccountId ?? null,
    selected?.operationId ?? null, selected?.source ?? null, selected?.observedAtMs ?? null])).digest('hex');
}
export async function qualifyWithdrawalBank(uid: string, stripe: StripeClient) {
  const source = await db.runTransaction(tx => assertAccountOperationOpen(tx, uid, true));
  const linked = source.user!.stripeAccountId;
  if (!accountId(linked)) throw failure('bank_account_link_missing');
  const account = await stripe.accounts.retrieve(linked); assertOwnedCanadianConnect(account, uid, linked);
  const bank = await bankOwnerStatus(uid, account, stripe);
  if (!['none', 'bank_destination'].includes(bank.payoutRestriction.category)) throw new HttpsError('failed-precondition',
    bank.payoutRestriction.message, {reason: 'connect_payout_restricted', action: bank.payoutRestriction.action,
      payoutRestriction: bank.payoutRestriction});
  if (bank.bankDeclarationRequired) throw failure('bank_ownership_declaration_required');
  if (!bank.payoutEligible || !bankId(bank.bankAccountId) || !bank.selected) throw failure('bank_payout_destination_unqualified');
  return { selectionIdentity: bankSelectionIdentity(bank.selected), destination: { schemaVersion: 1, accountId: linked,
    bankAccountId: bank.bankAccountId, last4: bank.bankAccountLast4, status: bank.bankAccountStatus, country: 'CA', currency: 'CAD',
    declarationOperationId: bank.selected.operationId, ownerDeclared: true, ownershipVerified: false,
    providerObservedAtMs: Date.now(), payoutMethod: 'standard' } };
}
