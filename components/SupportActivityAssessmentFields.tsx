import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Checkbox, Input} from '@/components/ui';
import type {SupportActivityAssessment, SupportActivityCriterion, SupportActivityFinding, SupportActivityProgram, SupportActivityReference} from '@/types/supportActivityReview';
import {isSupportActivityAssessment, supportActivityReferencesAreCurrent} from '@/utils/supportActivityReviewContract';
import {colors, spacing, typography} from '@/constants/theme';
type ReferenceDraft = SupportActivityReference;
type CriterionDraft = {criterion: SupportActivityCriterion; finding: SupportActivityFinding; reason: string; evidenceReadIds: string[]; references: ReferenceDraft[]};
const emptyReference = (): ReferenceDraft => ({url: '', title: '', instrument: '', provisions: '', consultedAt: ''});
const labels: Record<SupportActivityCriterion, string> = {person_restrictions: 'Restrictions visant la personne', activity_restrictions: 'Restrictions visant l’activité réelle'};
const empty = () => ({applicabilityReason: '', identity: false, matching: false, minimization: false, criteria: (['person_restrictions', 'activity_restrictions'] as const).map(criterion => ({criterion, finding: 'unknown' as SupportActivityFinding, reason: '', evidenceReadIds: [] as string[], references: [emptyReference()]}))});
/** Human inputs only. The program and evidence IDs come from current native
 * sources; a URL or matching name never becomes an automatic legal conclusion. */
export function SupportActivityAssessmentFields({program, sourceKey, proofs, disabled, onChange}: {program: SupportActivityProgram; sourceKey: string; proofs: {readId: string; purpose: string}[]; disabled: boolean; onChange: (value: SupportActivityAssessment | null) => void}) {
  const key = JSON.stringify([sourceKey, program.id, program.version, program.contentHash]), [draft, setDraft] = useState({...empty(), key});
  if (draft.key !== key) setDraft({...empty(), key});
  const edit = (patch: Partial<Omit<typeof draft, 'key'>>) => {
    if (disabled) return; const next = {...draft, ...patch}, candidate = {programId: program.id, programVersion: program.version, programHash: program.contentHash, applicabilityReason: next.applicabilityReason.trim(), manualIdentityComparisonAccepted: next.identity, noAutomaticNameMatchingAccepted: next.matching, minimizationAccepted: next.minimization,
      criteria: next.criteria.map(c => ({...c, reason: c.reason.trim(), references: c.references.map(r => ({url: r.url.trim(), title: r.title.trim(), instrument: r.instrument.trim(), provisions: r.provisions.trim(), consultedAt: r.consultedAt}))}))};
    setDraft(next);
    const bound = next.criteria.every(c => c.evidenceReadIds.every(id => proofs.some(p => p.readId === id)) && c.evidenceReadIds.some(id => proofs.some(p => p.readId === id && p.purpose === 'regulatory_basis')) && c.evidenceReadIds.some(id => proofs.some(p => p.readId === id && p.purpose === (c.criterion === 'person_restrictions' ? 'identity' : 'activity'))));
    onChange(bound && isSupportActivityAssessment(candidate, false) && supportActivityReferencesAreCurrent(candidate as SupportActivityAssessment) ? candidate as SupportActivityAssessment : null);
  };
  const criterion = (index: number, patch: Partial<CriterionDraft>) => edit({criteria: draft.criteria.map((c, i) => i === index ? {...c, ...patch} : c)});
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Programme humain de conformité — {program.id}, version {program.version}</Text>
    <Text selectable style={styles.caption}>Empreinte du programme natif : {program.contentHash}</Text>
    {program.instructions.map((instruction, i) => <Text key={i} style={styles.caption}>{instruction}</Text>)}
    {program.guidance.map(g => <Text selectable key={g.url} style={styles.caption}>{g.title} : {g.url}</Text>)}
    <Text style={styles.caption}>Consultez les textes officiels réellement pertinents et leurs exceptions. Pour chaque critère, saisissez la référence consultée, sa date réelle et les pièces correspondantes. Aucune consultation ou interdiction n’est déduite d’un lien, d’un nom, d’un statut de paiement ou d’une matière.</Text>
    <Input label="Portée et applicabilité effectivement examinées" value={draft.applicabilityReason} maxLength={4000} multiline disabled={disabled} onChangeText={applicabilityReason => edit({applicabilityReason})}/>
    {draft.criteria.map((c, index) => <View key={c.criterion} style={styles.section}><Text style={styles.title}>{labels[c.criterion]}</Text>
      {(['unknown', 'prohibition_supported', 'no_prohibition_identified'] as const).map(finding => <Button key={finding} variant={c.finding === finding ? 'primary' : 'secondary'} disabled={disabled} onPress={() => criterion(index, {finding})}>{finding === 'unknown' ? 'Incertitude conservée' : finding === 'prohibition_supported' ? 'Interdiction étayée dans cette portée' : 'Aucune interdiction identifiée dans cette portée'}</Button>)}
      <Input label={`Motivation : ${labels[c.criterion]}`} value={c.reason} maxLength={4000} multiline disabled={disabled} onChangeText={reason => criterion(index, {reason})}/>
      {proofs.filter(p => p.purpose === 'regulatory_basis' || p.purpose === (c.criterion === 'person_restrictions' ? 'identity' : 'activity')).map(p => <Checkbox key={p.readId} checked={c.evidenceReadIds.includes(p.readId)} disabled={disabled} onToggle={() => criterion(index, {evidenceReadIds: c.evidenceReadIds.includes(p.readId) ? c.evidenceReadIds.filter(id => id !== p.readId) : [...c.evidenceReadIds, p.readId]})}><Text selectable style={styles.caption}>Lier la lecture {p.purpose} · {p.readId} à ce critère.</Text></Checkbox>)}
      {c.references.map((r, referenceIndex) => <View key={referenceIndex} style={styles.section}>{(['url', 'title', 'instrument', 'provisions', 'consultedAt'] as const).map(field => <Input key={field} label={`${labels[c.criterion]} · source ${referenceIndex + 1} · ${field === 'url' ? 'URL gouvernementale HTTPS' : field === 'title' ? 'Titre exact' : field === 'instrument' ? 'Texte applicable' : field === 'provisions' ? 'Dispositions et exceptions examinées' : 'Consultation réelle UTC (moins de 30 jours)'}`} value={r[field]} maxLength={field === 'title' ? 500 : field === 'instrument' ? 1000 : field === 'consultedAt' ? 24 : 2000} multiline={field === 'provisions'} disabled={disabled} onChangeText={value => criterion(index, {references: c.references.map((ref, i) => i === referenceIndex ? {...ref, [field]: value} : ref)})}/>)}</View>)}
      <Button variant="secondary" disabled={disabled || c.references.length >= 5} onPress={() => criterion(index, {references: [...c.references, emptyReference()]})}>Ajouter une source officielle à ce critère</Button>
      {c.references.length > 1 ? <Button variant="secondary" disabled={disabled} onPress={() => criterion(index, {references: c.references.slice(0, -1)})}>Retirer la dernière source de ce critère</Button> : null}
    </View>)}
    <Checkbox checked={draft.identity} disabled={disabled} onToggle={() => edit({identity: !draft.identity})}><Text style={styles.caption}>J’ai rapproché humainement les pièces d’identité utiles à cette personne exacte.</Text></Checkbox>
    <Checkbox checked={draft.matching} disabled={disabled} onToggle={() => edit({matching: !draft.matching})}><Text style={styles.caption}>Un nom commun ou similaire ne prouve pas une identité ni une interdiction.</Text></Checkbox>
    <Checkbox checked={draft.minimization} disabled={disabled} onToggle={() => edit({minimization: !draft.minimization})}><Text style={styles.caption}>Je limite les pièces, la recherche et les conclusions à la portée nécessaire de ce dossier.</Text></Checkbox>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
