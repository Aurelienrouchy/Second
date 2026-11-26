/** Human review criteria, not a sanctions feed or an automatic legal verdict. */
import {HttpsError} from 'firebase-functions/v2/https';
import {supportHash, supportObject, supportText} from './supportRequest';

const program = {
  protocol: 'support_activity_program_v1', id: 'quebec_private_marketplace_v1', version: 1,
  criteria: ['person_restrictions', 'activity_restrictions'],
  guidance: [{title: 'Affaires mondiales Canada — renseignements essentiels sur les sanctions',
    url: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/essential-informations-essentielles.aspx?lang=eng'}],
  instructions: ['Examiner séparément la personne et l’activité réellement en cause.',
    'Vérifier les textes applicables, leur portée et les exceptions ; une liste consolidée n’est pas la loi.',
    'Rapprocher les pièces sans décision automatique fondée sur un nom, un statut Stripe ou une matière.',
    'Documenter les incertitudes, la motivation communiquée, la prochaine revue et le recours.'],
  automaticScreening: false, exhaustiveCoverageVerified: false, legalAuthorityAutomaticallyVerified: false,
} as const;
export function supportActivityProgram() {return {...program, contentHash: supportHash(program)};}

export function qualifyActivityAssessment(value: unknown,
  reads: {readId: string; purpose: string}[], finding: string) {
  const item = supportObject(value, ['programId', 'programVersion', 'programHash', 'applicabilityReason', 'criteria',
    'manualIdentityComparisonAccepted', 'noAutomaticNameMatchingAccepted', 'minimizationAccepted']);
  const current = supportActivityProgram();
  if (item.programId !== current.id || item.programVersion !== current.version || item.programHash !== current.contentHash ||
      item.manualIdentityComparisonAccepted !== true || item.noAutomaticNameMatchingAccepted !== true || item.minimizationAccepted !== true ||
      !Array.isArray(item.criteria) || item.criteria.length !== 2) {
    throw new HttpsError('invalid-argument', 'Programme actuel, examens humains distincts et attestations requis.');
  }
  const applicabilityReason = supportText(item.applicabilityReason, 'Portée et applicabilité examinées', 4000), seen = new Set<string>();
  const criteria = item.criteria.map((raw: unknown) => {
    const criterion = supportObject(raw, ['criterion', 'finding', 'reason', 'evidenceReadIds', 'references']);
    if (!(current.criteria as readonly unknown[]).includes(criterion.criterion) || seen.has(criterion.criterion) ||
        !['prohibition_supported', 'no_prohibition_identified', 'unknown'].includes(criterion.finding) ||
        !Array.isArray(criterion.evidenceReadIds) || criterion.evidenceReadIds.length < 2 || criterion.evidenceReadIds.length > 10 ||
        new Set(criterion.evidenceReadIds).size !== criterion.evidenceReadIds.length ||
        criterion.evidenceReadIds.some((id: unknown) => !reads.some(read => read.readId === id)) ||
        !Array.isArray(criterion.references) || criterion.references.length < 1 || criterion.references.length > 5) {
      throw new HttpsError('invalid-argument', 'Critère, pièces effectivement lues et sources officielles consultées requis.');
    }
    seen.add(criterion.criterion);
    const purposes = reads.filter(read => criterion.evidenceReadIds.includes(read.readId)).map(read => read.purpose);
    if (!purposes.includes('regulatory_basis') || !purposes.includes(criterion.criterion === 'person_restrictions' ? 'identity' : 'activity')) {
      throw new HttpsError('failed-precondition', 'Chaque examen doit lier ses propres pièces d’identité ou d’activité et de fondement.');
    }
    const references = criterion.references.map((rawReference: unknown) => {
      const ref = supportObject(rawReference, ['url', 'title', 'instrument', 'provisions', 'consultedAt']);
      const url = supportText(ref.url, 'Source officielle', 2000);
      let parsed: URL; try {parsed = new URL(url);} catch {throw new HttpsError('invalid-argument', 'Source officielle HTTPS requise.');}
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
          !/(^|\.)gc\.ca$/.test(parsed.hostname) && !/(^|\.)gouv\.qc\.ca$/.test(parsed.hostname) ||
          typeof ref.consultedAt !== 'string' || !Number.isFinite(Date.parse(ref.consultedAt)) ||
          new Date(ref.consultedAt).toISOString() !== ref.consultedAt || Date.parse(ref.consultedAt) > Date.now() ||
          Date.parse(ref.consultedAt) < Date.now() - 30 * 86400_000) {
        throw new HttpsError('invalid-argument', 'Texte officiel et date de consultation réelle dans les 30 jours requis.');
      }
      return {url, title: supportText(ref.title, 'Titre de la source', 500), instrument: supportText(ref.instrument, 'Texte applicable', 1000),
        provisions: supportText(ref.provisions, 'Dispositions et exceptions examinées', 2000), consultedAt: ref.consultedAt as string};
    });
    return {criterion: criterion.criterion as string, finding: criterion.finding as string, reason: supportText(criterion.reason, 'Motivation du critère'),
      evidenceReadIds: criterion.evidenceReadIds as string[], references};
  });
  const prohibited = criteria.some(row => row.finding === 'prohibition_supported'), clear = criteria.every(row => row.finding === 'no_prohibition_identified');
  if (['restrict_new_operations', 'activity_restriction_maintained'].includes(finding) && !prohibited ||
      ['lift_own_restriction', 'activity_no_prohibition_identified'].includes(finding) && !clear ||
      finding === 'activity_documents_requested' && clear) {
    throw new HttpsError('failed-precondition', 'La conclusion doit correspondre aux examens humains documentés ; une incertitude ne permet pas une levée.');
  }
  return {programId: current.id, programVersion: current.version, programHash: current.contentHash, applicabilityReason,
    criteria, manualIdentityComparisonAccepted: true, noAutomaticNameMatchingAccepted: true, minimizationAccepted: true,
    exhaustiveCoverageVerified: false, automaticScreening: false, legalAuthorityAutomaticallyVerified: false};
}
