/** Independent deployment qualification. A local counter, UID or baseline
 * cannot attest that an old writer has drained or a restoration is qualified. */
import {readFinancialRecoveryControl, readFinancialRecoveryPinnedObject} from '../config/recoveryControl';
import {supportSourceHash} from './supportRequest';

export async function readFinancialSubjectQualification() {
  try {
    const {GLOBAL_CONTROL_WRITER_REGISTRY_HASH} = await import('./globalControlBalance');
    const current = await readFinancialRecoveryControl(), pin = {
      object: process.env.FINANCIAL_SUBJECT_WRITER_POLICY_OBJECT ?? '', generation: process.env.FINANCIAL_SUBJECT_WRITER_POLICY_GENERATION ?? '',
      sha256: process.env.FINANCIAL_SUBJECT_WRITER_POLICY_SHA256 ?? ''};
    if (current.control.financialEnvironment === 'unconfigured') throw new Error('financial_provider_unconfigured');
    const bundle = process.env.FINANCIAL_SUBJECT_WRITER_BUNDLE_SHA256 ?? '';
    if (!/^[a-f0-9]{64}$/.test(bundle) || bundle !== GLOBAL_CONTROL_WRITER_REGISTRY_HASH || current.control.mode !== 'normal') throw new Error('writer_deployment_unqualified');
    const value = JSON.parse((await readFinancialRecoveryPinnedObject(pin)).toString('utf8'));
    const expected = {protocol: 'financial_subject_writer_qualification_v1', installationId: current.control.installationId,
      firestoreProjectId: current.control.firestoreProjectId, firestoreDatabaseId: current.control.firestoreDatabaseId,
      financialEnvironment: current.control.financialEnvironment, stripePlatformAccountId: current.control.stripePlatformAccountId,
      epoch: current.control.epoch, adapterProtocol: 'financial_subject_transaction_v1', writerBundleHash: bundle,
      legacyWritersDrained: true, allFinancialWritesUseQualifiedAdapter: true, subjectsFromNativeSourcesOnly: true,
      unknownCountersNotAutomaticallyQualified: true};
    if (!value || Object.keys(value).length !== Object.keys(expected).length + 1 ||
        Object.entries(expected).some(([key, v]) => value[key] !== v) || typeof value.qualifiedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.qualifiedAt)) || Date.parse(value.qualifiedAt) < 1 || Date.parse(value.qualifiedAt) > Date.now() ||
        new Date(value.qualifiedAt).toISOString() !== value.qualifiedAt) throw new Error('writer_deployment_unqualified');
    return {protocol: 'financial_subject_deployment_view_v1', qualified: true, epoch: current.control.epoch,
      writerBundleHash: bundle, policyHash: supportSourceHash(pin), controlHash: current.sha256,
      controlGeneration: current.generation, qualifiedAt: value.qualifiedAt as string, reason: null};
  } catch {
    return {protocol: 'financial_subject_deployment_view_v1', qualified: false, epoch: null, writerBundleHash: null,
      policyHash: null, controlHash: null, controlGeneration: null, qualifiedAt: null, reason: 'independent_writer_deployment_or_restore_unqualified'};
  }
}
