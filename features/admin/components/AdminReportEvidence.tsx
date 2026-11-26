import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { AdminModerationReport, FavorableArticleSource } from '@/types/articleModeration';
import { ReportReasonLabels, type ReportReason } from '@/services/moderationService';
import {AdminMessageReportEvidence} from './AdminMessageReportEvidence';
export function AdminReportEvidence({ report, favorableSource }: { report: AdminModerationReport; favorableSource?: FavorableArticleSource | null }) {
  const article = report.articleReview;
  const knownReason = report.reason && Object.prototype.hasOwnProperty.call(ReportReasonLabels, report.reason)
    ? ReportReasonLabels[report.reason as ReportReason] : null;
  const reason = typeof knownReason === 'string' ? knownReason : 'Motif non reconnu';
  return <View style={styles.card}>
    <Text style={styles.title}>Dossier privé de signalement</Text>
    <Text selectable style={styles.caption}>Signalement : {report.id} · état : {report.status} · version : {report.revision}</Text>
    <Text style={styles.body}>Allégation : {reason}</Text>
    {report.description ? <Text style={styles.body}>{report.description}</Text> : null}
    <Text style={styles.caption}>Signalé par : {report.reporterName ?? 'Nom inconnu'} · {report.reporterId ?? 'Identité inconnue'}</Text>
    <Text style={styles.body}>Une allégation ou un résultat automatique ne certifie pas l’authenticité. Examinez les sources et motivez la décision ; les pièces et les références restent privées.</Text>
    {report.targetType === 'message' ? <AdminMessageReportEvidence key={`${report.id}:${report.revision}`} reportId={report.id} reportRevision={report.revision} /> : null}
    {article ? <>
      <Text selectable style={styles.caption}>Article : {article.articleId} · propriétaire observé : {article.ownerId ?? 'inconnu'} · version : {article.revision}</Text>
      <Text style={styles.body}>Modération : {article.moderationStatus ?? 'non renseignée'} · actif : {article.isActive === null ? 'inconnu' : article.isActive ? 'oui' : 'non'} · origine : {article.decisionSource ?? 'non renseignée'}</Text>
      {article.currentDecision ? <>
        <Text style={styles.title}>Décision actuelle</Text><Text style={styles.body}>{article.currentDecision.ownerMessage}</Text>
        <Text selectable style={styles.caption}>{article.currentDecision.id} · {article.currentDecision.action === 'reject' ? 'Retrait' : article.currentDecision.action === 'approve' ? 'Décision favorable' : 'Examen'}</Text>
        {article.currentDecision.evidenceReferences.map((reference, index) => <Text key={`${index}:${reference}`} selectable style={styles.caption}>{reference}</Text>)}
      </> : null}
    </> : <Text style={styles.body}>Aucune source d’article actuelle dans ce dossier. La clôture seule du signalement ne décide pas du sort d’une annonce.</Text>}
    {report.ownerAppeal ? <>
      <Text style={styles.title}>Contestation du propriétaire authentifié</Text>
      <Text style={styles.body}>{report.ownerAppeal.reason}</Text>
      <Text selectable style={styles.caption}>Propriétaire : {report.ownerAppeal.ownerId} · décision : {report.ownerAppeal.decisionId} · reçue : {report.ownerAppeal.receivedAt ?? 'date inconnue'}</Text>
    </> : null}
    {favorableSource ? <>
      <Text style={styles.title}>Source native de la levée envisagée</Text>
      <Text style={styles.body}>{favorableSource.restriction.action === 'reject' ? 'Motif de retrait à examiner' : 'Motif d’examen à examiner'} : {favorableSource.restriction.ownerMessage ?? 'Motif historique non communiqué'}</Text>
      <Text style={styles.body}>{favorableSource.restrictionEvidenceQualified ? 'Les références de cette restriction sont qualifiées par la source native.' : 'La source de cette restriction reste incomplète. Une décision favorable ne garantit pas la remise en visibilité.'}</Text>
      <Text selectable style={styles.caption}>Décision à lever : {favorableSource.expectedDecisionId}{'\n'}Décision privée actuelle : {favorableSource.expectedModerationDecisionId}{'\n'}Version article : {favorableSource.expectedArticleRevision}{'\n'}Version signalement : {favorableSource.expectedReportRevision}{'\n'}Version modération : {favorableSource.expectedModerationRevision}</Text>
      {favorableSource.restriction.evidenceReferences.map((reference, index) => <Text key={`restriction:${index}:${reference}`} selectable style={styles.caption}>Référence historique privée : {reference}</Text>)}
      {favorableSource.appeal ? <><Text style={styles.body}>Contestation sélectionnée : {favorableSource.appeal.status} · {favorableSource.appeal.reason ?? 'Motif non communiqué'}</Text>
        <Text selectable style={styles.caption}>{favorableSource.expectedAppealId} · version : {favorableSource.expectedAppealRevision}</Text></> : <Text style={styles.body}>Aucune contestation sélectionnée dans cette source.</Text>}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ card: { padding: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.md, gap: spacing.sm },
  title: { ...typography.h3, color: colors.foreground }, body: { ...typography.body, color: colors.foregroundSecondary }, caption: { ...typography.caption, color: colors.muted } });
