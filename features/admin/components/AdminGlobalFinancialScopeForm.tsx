import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Input} from '@/components/ui';
import {isGlobalFinancialControlPointAligned, isGlobalFinancialNativeCapture, isGlobalFinancialScope} from '@/services/globalFinancialReconciliationService';
import type {GlobalFinancialNativeCapture, GlobalFinancialScope} from '@/types/globalFinancialReconciliation';
import {colors, spacing, typography} from '@/constants/theme';

export function AdminGlobalFinancialScopeForm({disabled, resumingCreation, onSubmit, onCapturePoint}: {
  disabled: boolean; resumingCreation: boolean; onSubmit: (scope: GlobalFinancialScope, guard: () => void) => void;
  onCapturePoint: (guard: () => void, precision?: 'minute') => Promise<{point: GlobalFinancialNativeCapture; assertCurrent: () => void; precision?: 'minute'}>;
}) {
  const [accountKind, setKind] = useState<'platform' | 'connected'>('platform'), [accountId, setAccount] = useState(''), [platformAccountId, setPlatform] = useState('');
  const [livemode, setLive] = useState<boolean | null>(null), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [connectedKind, setConnectedKind] = useState<'withdrawal' | 'current_account'>('withdrawal'), [connectedId, setConnectedId] = useState('');
  const [statementId, setStatementId] = useState(''), [statementType, setStatementType] = useState<'balance.summary.1' | 'balance.summary.2'>('balance.summary.1');
  const [epochId, setEpochId] = useState(''), [epochHash, setEpochHash] = useState(''), [bounds, setBounds] = useState(''), [notice, setNotice] = useState<string | null>(null);
  const [readMode, setReadMode] = useState<'live' | 'fixed'>('live'), [seconds, setSeconds] = useState(''), [nanoseconds, setNanoseconds] = useState('');
  const [completeKnownSources, setCompleteKnownSources] = useState(false), [precision, setPrecision] = useState<'exact' | 'minute'>('exact');
  const [controlBalance, setControlBalance] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<{point: GlobalFinancialNativeCapture; assertCurrent: () => void; precision?: 'minute'} | null>(null), [capturing, setCapturing] = useState(false);
  const revision = useRef(0), captureLock = useRef(false);
  const edit = <T,>(setter: (value: T) => void, value: T) => {revision.current++; setter(value); setSelectedPoint(null); setNotice(null);};
  const capture = async () => {
    if (disabled || resumingCreation || captureLock.current || readMode !== 'fixed') return;
    const selected = revision.current, draftGuard = () => {if (revision.current !== selected) throw new Error('La portée saisie a changé.');};
    captureLock.current = true; setCapturing(true); setSelectedPoint(null); setNotice(null);
    try {const value = await onCapturePoint(draftGuard, precision === 'minute' ? 'minute' : undefined); value.assertCurrent(); draftGuard();
      // This is the operator's explicit control-mode choice: period end comes
      // from the qualified server point, never from a client-created capture.
      if (controlBalance) {
        if (value.point.readTime.nanoseconds !== 0) throw new Error('Le contrôle exige un point serveur à la seconde exacte.');
        setTo(new Date(value.point.readTime.seconds * 1000).toISOString().replace('.000Z', 'Z'));
      }
      setSelectedPoint(value);}
    catch (error) {if (revision.current === selected) setNotice(error instanceof Error ? error.message : 'Le point natif ne peut pas être qualifié.');}
    finally {captureLock.current = false; setCapturing(false);}
  };
  const submit = () => {
    try {
      if (disabled || capturing || captureLock.current) return;
      const utc = (v: string) => {if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) || new Date(v).toISOString() !== v.replace('Z', '.000Z')) throw new Error('Utilisez deux dates UTC exactes, au format 2026-10-20T00:00:00Z.'); return Date.parse(v) / 1000;};
      let declared: unknown = null; if (bounds.trim()) {if (bounds.length > 5000) throw new Error('Bornes documentaires trop longues.'); declared = JSON.parse(bounds);}
      let nativeCapture: GlobalFinancialNativeCapture | undefined;
      if (readMode === 'fixed') {
        if (resumingCreation) {
          const initialPoint: unknown = {protocol: 'firestore_read_time_v1', readTime: {seconds: /^\d{1,10}$/.test(seconds) ? Number(seconds) : null, nanoseconds: /^\d{1,9}$/.test(nanoseconds) ? Number(nanoseconds) : null}};
          if (!isGlobalFinancialNativeCapture(initialPoint)) throw new Error('Recopiez les secondes et nanosecondes du point initial exact. Aucun nouveau point ne peut remplacer celui de cette commande.');
          nativeCapture = initialPoint;
        } else {
          if (!selectedPoint) throw new Error('Obtenez le point serveur pour cette portée avant de préparer le rapport.');
          selectedPoint.assertCurrent(); nativeCapture = selectedPoint.point;
        }
      }
      const value: unknown = {accountKind, accountId: accountId.trim(), platformAccountId: platformAccountId.trim(), livemode, currency: 'CAD', period: {fromSeconds: utc(from.trim()), toSeconds: utc(to.trim())},
        connectedReference: accountKind === 'connected' ? {kind: connectedKind, id: connectedId} : null,
        epoch: epochId.trim() || epochHash.trim() ? {id: epochId.trim(), proofHash: epochHash.trim()} : null, boundaries: declared,
        statementReference: statementId.trim() ? {reportRunId: statementId.trim(), reportType: statementType} : null, ...(nativeCapture ? {nativeCapture} : {}),
        ...(completeKnownSources ? {coverageMode: 'complete_known_sources_v1'} : {}), ...(controlBalance ? {controlBalanceMode: 'global_control_balance_v1'} : {})};
      if (!isGlobalFinancialScope(value)) throw new Error('Vérifiez le compte, le mode, la période passée et les références exactes. Les bornes exigent des cents entiers et une référence avec empreinte SHA-256.');
      if (controlBalance && !resumingCreation && !isGlobalFinancialControlPointAligned(value)) throw new Error('Le contrôle exige la fin de période au point serveur exact, avec zéro nanoseconde.');
      const selected = revision.current; onSubmit(value, () => {if (revision.current !== selected) throw new Error('La portée saisie a changé.'); if (readMode === 'fixed' && !resumingCreation) selectedPoint?.assertCurrent();});
    } catch (error) {setNotice(error instanceof Error ? error.message : 'Portée invalide.');}
  };
  return <View style={styles.section}>
    <Text style={styles.body}>{resumingCreation ? 'Reprendre la création conservée avec sa portée exacte' : 'Nouveau rapport documentaire — un seul compte'}</Text>
    <View style={styles.section}><Button variant="secondary" disabled={disabled} onPress={() => edit(setKind, accountKind === 'platform' ? 'connected' : 'platform')}>{accountKind === 'platform' ? 'Compte plateforme' : 'Compte connecté'}</Button>
      <Input label="Compte observé acct_…" value={accountId} onChangeText={v => edit(setAccount, v)} maxLength={195} autoCapitalize="none" disabled={disabled}/>
      <Input label="Compte plateforme acct_…" value={platformAccountId} onChangeText={v => edit(setPlatform, v)} maxLength={195} autoCapitalize="none" disabled={disabled}/>
      <Button variant="secondary" disabled={disabled} onPress={() => edit(setLive, livemode === null ? false : !livemode)}>{livemode === null ? 'Choisir le mode : test ou réel' : livemode ? 'Mode réel' : 'Mode test'}</Button>
    </View>
    {accountKind === 'connected' ? <><Button variant="secondary" disabled={disabled} onPress={() => edit(setConnectedKind, connectedKind === 'withdrawal' ? 'current_account' : 'withdrawal')}>{connectedKind === 'withdrawal' ? 'Lien par retrait historique' : 'Lien par compte vendeur actuel'}</Button>
      <Input label={connectedKind === 'withdrawal' ? 'Référence native du retrait' : 'UID propriétaire du compte actuel'} value={connectedId} onChangeText={v => edit(setConnectedId, v)} maxLength={200} autoCapitalize="none" disabled={disabled}/></> : null}
    <Text style={styles.caption}>Devise CAD. Début inclus, fin exclue, en UTC. Les liens entre comptes ne deviennent pas une somme de revenus.</Text>
    <Input label="Début UTC inclus — AAAA-MM-JJTHH:mm:ssZ" value={from} onChangeText={v => edit(setFrom, v)} maxLength={20} autoCapitalize="none" disabled={disabled}/>
    <Input label="Fin UTC exclue — AAAA-MM-JJTHH:mm:ssZ" value={to} onChangeText={v => edit(setTo, v)} maxLength={20} autoCapitalize="none" disabled={disabled || controlBalance && !resumingCreation}/>
    <Text style={styles.body}>Lecture des sources natives</Text>
    <Button variant="secondary" disabled={disabled || capturing} onPress={() => {
      edit(setControlBalance, !controlBalance);
      if (!controlBalance) {setCompleteKnownSources(true); setReadMode('fixed'); setPrecision('minute'); if (!resumingCreation) setTo('');}
    }}>{controlBalance ? 'Contrôle de balance sélectionné — retirer ce choix' : 'Choisir explicitement le contrôle de balance au point serveur'}</Button>
    {controlBalance ? <Text style={styles.caption}>{resumingCreation ? 'Reprenez toute la portée et le point initial exacts. Aucun champ de cette ancienne intention n’est remplacé automatiquement.' : 'La fin de période sera fixée au point natif obtenu du serveur, avec zéro nanoseconde. Le début reste inclus et cette fin reste exclue.'} Les preuves indépendantes d’ouverture, clôture, sources et drainage sont configurées côté serveur. Une référence, un montant ou une borne saisis ici n’accordent aucune qualification. Un contrôle équilibré ne permet aucun mouvement financier ni réouverture.</Text> : null}
    <Button variant="secondary" disabled={disabled || capturing || controlBalance} onPress={() => {edit(setCompleteKnownSources, !completeKnownSources); if (!completeKnownSources) setReadMode('fixed');}}>{completeKnownSources ? 'Parcours complet des sources connues sélectionné — choisir les limites V1' : 'Choisir explicitement le parcours complet des sources connues'}</Button>
    <Text style={styles.caption}>{completeKnownSources ? 'Ce choix exige un point natif. Il retire uniquement les plafonds totaux de pages, sources, références et tentatives. Les tailles par appel et les autres limites demeurent ; chaque page exige une instruction explicite. La couverture globale et la balance réconciliée ne sont pas certifiées.' : 'Le contrat V1 conserve ses limites historiques. Une intention ou un rapport existant ne reçoit jamais automatiquement le nouveau choix ; sa portée et son empreinte restent inchangées.'}</Text>
    <Button variant="secondary" disabled={disabled || capturing || completeKnownSources} onPress={() => edit(setReadMode, readMode === 'live' ? 'fixed' : 'live')}>{readMode === 'live' ? 'Lecture native en direct — choisir un point fixe' : 'Lecture native à point fixe — choisir le direct'}</Button>
    <Text style={styles.caption}>{readMode === 'live' ? 'Les pages natives sont lues à leur date de consultation, sans point commun. Les anciens rapports conservent ce mode.' : 'Les sources natives connues, leurs liens et leur contrelecture seront lus au même point Firestore. Le rôle opérateur et les lectures Stripe restent actuels. Ce choix ne certifie ni le jeu complet de sources, ni le solde global, ni une restauration.'}</Text>
    {readMode === 'fixed' ? <>
      {resumingCreation ? <>
        <Text style={styles.caption}>Reprise du point initial uniquement. Saisissez ses valeurs exactes et toute la portée d’origine ; leur empreinte sera vérifiée avant l’appel. Un point expiré reste une issue à documenter avec cette même référence.</Text>
        <Input label="Point initial — secondes serveur exactes" value={seconds} onChangeText={v => edit(setSeconds, v)} maxLength={10} keyboardType="number-pad" disabled={disabled}/>
        <Input label="Point initial — nanosecondes serveur exactes" value={nanoseconds} onChangeText={v => edit(setNanoseconds, v)} maxLength={9} keyboardType="number-pad" disabled={disabled}/>
      </> : <>
        <Button variant="secondary" disabled={disabled || capturing || controlBalance} onPress={() => edit(setPrecision, precision === 'exact' ? 'minute' : 'exact')}>{precision === 'exact' ? 'Point serveur exact — choisir la minute vérifiée' : 'Point serveur à la minute vérifiée — choisir le point exact'}</Button>
        <Text style={styles.caption}>{precision === 'minute' ? 'Le serveur dérive le début de la minute depuis son horloge native puis vérifie réellement une lecture à cet instant. Aucune date de capture n’est saisie par le client. Le mode PITR et la disponibilité future de ce point restent non vérifiés.' : 'Le serveur fournit son point natif exact. Sa disponibilité lors des lectures suivantes reste à vérifier.'}</Text>
        <Button variant="secondary" disabled={disabled || capturing} onPress={() => {void capture();}}>{capturing ? 'Lecture du point serveur…' : selectedPoint ? 'Obtenir un nouveau point avant préparation' : 'Obtenir le point serveur pour cette portée'}</Button>
      </>}
      {selectedPoint ? <Text selectable style={styles.caption}>Point serveur exact : secondes {selectedPoint.point.readTime.seconds} · nanosecondes {selectedPoint.point.readTime.nanoseconds}. Toute modification de portée efface ce choix. {selectedPoint.point.readTime.seconds >= Date.parse(to) / 1000 ? 'Ce point couvre la fin de période saisie.' : 'La fin de période saisie n’est pas couverte par ce point ; choisissez un point plus récent avant préparation.'}</Text> : null}
      {selectedPoint?.precision === 'minute' ? <Text style={styles.caption}>Lecture native à la minute vérifiée lors de l’obtention. Aucune activation PITR, conservation de sept jours ou disponibilité ultérieure n’est attestée.</Text> : null}
      <Text style={styles.caption}>Le point devient immuable dès la préparation. Si sa lecture expire ou devient indisponible, le même rapport et la même commande restent à reprendre ; aucune lecture en direct de remplacement n’est proposée.</Text>
    </> : null}
    <Input label="Relevé Stripe déjà créé — frr_… (facultatif)" value={statementId} onChangeText={v => edit(setStatementId, v)} maxLength={195} autoCapitalize="none" disabled={disabled}/>
    <Button variant="secondary" disabled={disabled} onPress={() => edit(setStatementType, statementType === 'balance.summary.1' ? 'balance.summary.2' : 'balance.summary.1')}>{statementType}</Button>
    <Text style={styles.caption}>Lecture d’un relevé existant seulement. Le schéma V1 reconnu peut qualifier ses flux ; V2 demeure inconnu. Aucun relevé n’est créé chez Stripe.</Text>
    <Input label="Référence d’époque déclarée (facultatif)" value={epochId} onChangeText={v => edit(setEpochId, v)} maxLength={200} autoCapitalize="none" disabled={disabled}/>
    <Input label="Empreinte de cette preuve d’époque" value={epochHash} onChangeText={v => edit(setEpochHash, v)} maxLength={64} autoCapitalize="none" disabled={disabled}/>
    <Input label="Bornes déclarées JSON (facultatif)" value={bounds} onChangeText={v => edit(setBounds, v)} maxLength={5000} multiline autoCapitalize="none" disabled={disabled}/>
    <Text selectable style={styles.caption}>{'Format : {"opening":[{"balanceType":"payments","availableCents":100,"pendingCents":0,"evidenceReference":{"reference":"source","contentHash":"SHA256"}}],"closing":[…]}. Aucun chiffre ni époque n’est déduit automatiquement ; ces déclarations restent non vérifiées.'}</Text>
    {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
    <Button disabled={disabled || capturing || livemode === null || readMode === 'fixed' && !resumingCreation && !selectedPoint} onPress={submit}>{resumingCreation ? 'Reprendre cette création exacte' : 'Préparer ce rapport privé'}</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
