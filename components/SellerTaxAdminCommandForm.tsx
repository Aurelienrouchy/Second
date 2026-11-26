import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Input, Checkbox} from '@/components/ui';
import {isSellerTaxCommand} from '@/services/sellerTaxService';
import {SELLER_TAX_ACTION_LABELS} from '@/components/SellerTaxDocumentCard';
import {colors, spacing, typography} from '@/constants/theme';
import type {SellerTaxCommand, SellerTaxDocumentReference, SellerTaxScope, SellerTaxSource, SellerTaxCaptureReference} from '@/types/sellerTax';

const sellerActions: SellerTaxCommand['action'][] = ['ingest', 'identity_record', 'evidence_event', 'declaration_prepare', 'filing_record', 'copy_record', 'credit_note_record'];
export function SellerTaxAdminCommandForm({scope, version, disabled, operatorQualified, declaration, sourceId, captureReference, onCommand}: {
  scope: SellerTaxScope; version: number; disabled: boolean; operatorQualified: boolean; declaration: SellerTaxDocumentReference | null;
  sourceId?: string; captureReference?: SellerTaxCaptureReference | null; onCommand: (command: SellerTaxCommand) => void;
}) {
  const [action, setAction] = useState<SellerTaxCommand['action']>(scope.subject === 'operator' ? 'operator_record' : 'ingest');
  const [artifactId, setArtifactId] = useState(''), [generation, setGeneration] = useState(''), [contentHash, setContentHash] = useState('');
  const [kind, setKind] = useState<SellerTaxSource['kind']>('purchase'), [id, setId] = useState(sourceId ?? ''), [refundIntentId, setRefundIntentId] = useState('');
  const [declarationKind, setDeclarationKind] = useState<'original' | 'corrective' | 'cancelled'>('original');
  const [importConfirmed, setImportConfirmed] = useState(false);
  const evidenceNeeded = ['operator_record', 'identity_record', 'evidence_event', 'filing_record', 'copy_record', 'credit_note_record'].includes(action);
  const sourceNeeded = ['ingest', 'evidence_event', 'credit_note_record'].includes(action);
  const intakeBlocked = ['identity_record', 'evidence_event'].includes(action) && !operatorQualified;
  const source: SellerTaxSource = action === 'credit_note_record' || kind === 'purchase_refund' ? {kind: 'purchase_refund', id, refundIntentId} : {kind, id};
  const base = {expectedVersion: version}, evidenceReference = {artifactId, generation, contentHash};
  let command: SellerTaxCommand | null = null;
  if (action === 'operator_record' || action === 'identity_record') command = {...base, action, evidenceReference};
  else if (action === 'ingest') command = {...base, action, source};
  else if (action === 'evidence_event' || action === 'credit_note_record') command = {...base, action, source, evidenceReference};
  else if (action === 'declaration_prepare') command = {...base, action, kind: declarationKind, previousDeclaration: declarationKind === 'original' ? null : declaration, ...captureReference ? {captureReference} : {}};
  else if ((action === 'filing_record' || action === 'copy_record') && declaration) command = {...base, action, declaration, evidenceReference};
  const canSubmit = !disabled && !intakeBlocked && !!command && isSellerTaxCommand(command, scope) && (!evidenceNeeded || importConfirmed);
  return <View style={styles.section}>
    <Text style={styles.title}>Acte documentaire administratif</Text>
    <Text style={styles.caption}>Ces actes ne déposent rien auprès d’une autorité et ne collectent aucun identifiant fiscal dans l’application. Les références ci-dessous doivent provenir de véritables pièces du coffre privé configuré ; leur importation ne certifie pas les faits ni la qualification légale.</Text>
    {(scope.subject === 'operator' ? ['operator_record'] as const : sellerActions).map(value => <Button key={value} variant={action === value ? 'secondary' : 'ghost'} disabled={disabled}
      onPress={() => {setAction(value); setImportConfirmed(false);}}>{SELLER_TAX_ACTION_LABELS[value]}</Button>)}
    {sourceNeeded ? <>
      {action !== 'credit_note_record' ? <View style={styles.section}>{(['purchase', 'purchase_refund', 'swap'] as const).map(value => <Button key={value} variant={kind === value ? 'secondary' : 'ghost'} disabled={disabled} onPress={() => setKind(value)}>{value === 'purchase' ? 'Commande' : value === 'purchase_refund' ? 'Remboursement lié' : 'Troc'}</Button>)}</View> : null}
      <Input label="Référence native de la commande ou du troc" value={id} onChangeText={setId} maxLength={128} autoCapitalize="none" disabled={disabled}/>
      {source.kind === 'purchase_refund' ? <Input label="Identifiant natif de l’intention de remboursement" value={refundIntentId} onChangeText={setRefundIntentId} maxLength={128} autoCapitalize="none" disabled={disabled}/> : null}
    </> : null}
    {action === 'declaration_prepare' ? <>
      {(['original', 'corrective', 'cancelled'] as const).map(value => <Button key={value} variant={declarationKind === value ? 'secondary' : 'ghost'} disabled={disabled} onPress={() => setDeclarationKind(value)}>{value === 'original' ? 'Préparation originale' : value === 'corrective' ? 'Préparation corrective' : 'Préparation d’annulation'}</Button>)}
      <Text style={styles.caption}>Une correction ou annulation reste liée à la déclaration native sélectionnée. La préparation n’est ni un fichier officiel ni un dépôt.</Text>
      <Text style={styles.caption}>{captureReference ? 'La capture native complète choisie sera relue avant la préparation.' : 'Aucune capture complète choisie : la préparation utilise le résumé conservateur limité aux événements enregistrés.'}</Text>
    </> : null}
    {['declaration_prepare', 'filing_record', 'copy_record'].includes(action) ? <Text selectable style={styles.caption}>Déclaration sélectionnée : {declaration?.id ?? 'Aucune. Lisez les déclarations pour sélectionner une référence native.'}</Text> : null}
    {evidenceNeeded ? <>
      <Input label="Identifiant opaque de l’artefact réel du coffre" value={artifactId} onChangeText={setArtifactId} maxLength={64} autoCapitalize="none" disabled={disabled}/>
      <Input label="Génération exacte de l’artefact" value={generation} onChangeText={setGeneration} maxLength={30} keyboardType="number-pad" disabled={disabled}/>
      <Input label="Empreinte SHA-256 des octets réels du coffre" value={contentHash} onChangeText={setContentHash} maxLength={64} autoCapitalize="none" disabled={disabled}/>
      <Checkbox checked={importConfirmed} onToggle={() => {if (!disabled) setImportConfirmed(value => !value);}}>Ces références correspondent à une pièce réelle du coffre configuré ; je n’y saisis aucune valeur d’identité ou d’identifiant fiscal.</Checkbox>
    </> : null}
    {intakeBlocked ? <Text style={styles.caption}>L’évaluation annuelle de l’exploitant et la finalité de collecte ne sont pas qualifiées dans la lecture actuelle. Aucun nouvel import d’identité ou de valorisation n’est proposé.</Text> : null}
    <Button disabled={!canSubmit} onPress={() => {if (canSubmit && command) onCommand(command);}}>Enregistrer cet acte documentaire exact</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
