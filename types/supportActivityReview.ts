export type SupportActivityCriterion = 'person_restrictions' | 'activity_restrictions';
export type SupportActivityFinding = 'unknown' | 'prohibition_supported' | 'no_prohibition_identified';
export interface SupportActivityProgram {protocol: 'support_activity_program_v1'; id: string; version: number; contentHash: string;
  criteria: SupportActivityCriterion[]; guidance: {title: string; url: string}[]; instructions: string[];
  automaticScreening: false; exhaustiveCoverageVerified: false; legalAuthorityAutomaticallyVerified: false}
export interface SupportActivityReference {url: string; title: string; instrument: string; provisions: string; consultedAt: string}
export interface SupportActivityAssessment {programId: string; programVersion: number; programHash: string; applicabilityReason: string;
  manualIdentityComparisonAccepted: true; noAutomaticNameMatchingAccepted: true; minimizationAccepted: true;
  criteria: {criterion: SupportActivityCriterion; finding: SupportActivityFinding; reason: string; evidenceReadIds: string[]; references: SupportActivityReference[]}[]}
export interface SupportActivityRecordedAssessment extends SupportActivityAssessment {exhaustiveCoverageVerified: false; automaticScreening: false; legalAuthorityAutomaticallyVerified: false}
