import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Modal, StyleSheet, Text, View, useWindowDimensions, type ViewToken} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import type {ReturnDepositDeadlinePreview} from '@/types/returnDepositDeadline';
import {formatReturnDepositDate} from '@/utils/returnDepositDeadlineContract';

export interface ReturnDepositDeadlineFact {id: string; label: string; value: string}
export function returnDepositDeadlineFacts(source: ReturnDepositDeadlinePreview, proposed: {dueAtMs: number | null; motivation: string; partyMessage: string} | null, compact = false): ReturnDepositDeadlineFact[] {
  if(compact){
    const rows:ReturnDepositDeadlineFact[]=[];
    if(source.termsAccepted)rows.push({id:'terms',label:'Délai de dépôt',value:'Déposez le retour dans les sept jours calendaires suivant la mise à disposition de l’étiquette. Vous pouvez demander une prolongation motivée.'});
    else rows.push({id:'terms',label:'Délai de dépôt',value:'Le délai de cette ancienne demande doit être confirmé avec Seconde.'});
    if(source.clock&&source.qualification==='qualified'&&source.clock.currentLabelMatches){
      rows.push({id:'available',label:'Étiquette disponible depuis le',value:formatReturnDepositDate(source.clock.availableAt)});
      rows.push({id:'due',label:'À déposer avant le',value:formatReturnDepositDate(source.clock.dueAt)});
      if(source.clock.reviewRequired)rows.push({id:'review',label:'Suivi du retour',value:'Seconde vérifie les informations de ce retour.'});
      source.clock.extensions.forEach((entry,index)=>{rows.push({id:`extension:${index}:dates`,label:'Délai prolongé',value:formatReturnDepositDate(entry.newDueAt)});if(entry.partyMessage)rows.push({id:`extension:${index}:message`,label:'Message de Seconde',value:entry.partyMessage});});
    }
    return rows;
  }
  const facts: ReturnDepositDeadlineFact[] = [];
  const add = (id: string, label: string, value: string) => {facts.push({id, label, value});};
  add('identity', 'Commande et source native', `${source.transactionId} · ${source.source.sourceHash} · version ${source.source.version ?? 'inconnue'}`);
  add('terms', 'Conditions du dépôt', source.termsAccepted ? 'Sept jours calendaires, à la même heure civile de Toronto, à partir de la première fourniture native du document. Une heure locale inexistante ou ambiguë demande une revue humaine. Une prolongation motivée est possible.' : 'Les conditions de dépôt de cette ancienne demande ne sont pas enregistrées. Aucune échéance rétroactive n’est calculée.');
  add('qualification', 'Qualification de cette lecture', source.qualification === 'qualified' ? 'Horloge native qualifiée.' : source.qualification === 'historical_terms_not_recorded' ? 'Anciennes conditions non enregistrées.' : 'Source ou horloge à rapprocher ; aucune date de départ inventée.');
  if (source.clock) {
    add('available', 'Première fourniture native du document', formatReturnDepositDate(source.clock.availableAt));
    add('due', 'Échéance native actuelle', formatReturnDepositDate(source.clock.dueAt));
    add('labels', 'Étiquettes et instruction de délai', `Étiquette utilisée pour le début du délai : ${source.clock.baseLabelId}. Étiquette actuelle : ${source.clock.currentLabelId ?? 'inconnue'}. L’instruction de délai concerne cette étiquette actuelle : ${source.clock.currentLabelMatches ? 'oui' : 'non ; revue nécessaire'}. Un remplacement ne redémarre pas le délai.`);
    add('review', 'Revue requise selon le serveur', source.clock.reviewRequired ? 'Oui. La revue ne déduit ni faute, ni autorisation d’expédition ou remboursement.' : 'Aucune revue signalée par cette lecture ; cela ne confirme ni dépôt ni contenu.');
    source.clock.extensions.forEach((entry, index) => {
      add(`extension:${index}:dates`, `Prolongation ${index + 1} · dates`, `Enregistrée : ${formatReturnDepositDate(entry.recordedAt)}. Nouvelle échéance : ${formatReturnDepositDate(entry.newDueAt)}.`);
      if (entry.motivation !== null) add(`extension:${index}:motivation`, `Prolongation ${index + 1} · motivation privée`, entry.motivation);
      add(`extension:${index}:message`, `Prolongation ${index + 1} · message aux membres`, entry.partyMessage);
    });
  }
  add('physical', 'Dépôt, réception du colis et contenu', `Le dépôt chez le transporteur n’est pas vérifié par cette horloge. Réception du colis déclarée/enregistrée : ${source.physicalEvidence.parcelDeliveryDeclared ? formatReturnDepositDate(source.physicalEvidence.parcelDeliveredAt) : 'non établie par cette source'}. Le contenu et l’état de l’article ne sont pas confirmés.`);
  add('limits', 'Portée du délai', 'Dépasser le délai ne prouve pas une faute et ne déclenche aucun remboursement, libération de fonds, annulation ou changement de stock. Le délai ne donne aucune permission d’expédier. Les preuves du transport et les décisions financières restent distinctes.');
  if (proposed) {
    add('proposed:due', 'Nouvelle échéance proposée, sans nouveau départ', proposed.dueAtMs === null ? 'Date UTC invalide : aucune instruction ne pourra être envoyée.' : formatReturnDepositDate(new Date(proposed.dueAtMs).toISOString()));
    add('proposed:motivation', 'Motivation privée de cette prolongation', proposed.motivation || 'Motivation manquante.');
    add('proposed:message', 'Message qui sera adressé aux deux membres', proposed.partyMessage || 'Message manquant.');
  }
  return facts;
}
interface Segment extends ReturnDepositDeadlineFact {factId: string}
const keyExtractor = (row: Segment) => row.id;
const viewabilityConfig = {itemVisiblePercentThreshold: 95, minimumViewTime: 300};
/** One native full-screen list: enclosing order/admin scrolls grant no read marks. */
export function ReturnDepositDeadlineFacts({facts, onSeen, onReviewOpened, onReviewClosed, compact=false}: {compact?:boolean; facts: ReturnDepositDeadlineFact[]; onSeen: (ids: string[]) => void; onReviewOpened: () => void; onReviewClosed: () => void}) {
  const {width, fontScale} = useWindowDimensions();
  const [open, setOpen] = useState(false), [shownFor, setShownFor] = useState<number | null>(null), opened = useRef(false), shown = useRef(false), viewport = useRef(0);
  const epoch = useRef(0), [openingEpoch, setOpeningEpoch] = useState(0);
  const limit = Math.max(1, Math.floor((width - spacing.lg * 2) / ((compact ? spacing.sm : spacing.lg) * Math.max(1, fontScale))) * (compact ? 3 : 1));
  const [segments, setSegments] = useState<Segment[]>(() => facts.flatMap(fact => {
    const rows: Segment[] = []; let position = 0;
    for (const line of fact.value.split(/\r\n|\r|\n/)) {const text = line || ' '; for (let offset = 0; offset < text.length; offset += limit) rows.push({...fact, factId: fact.id, id: `${fact.id}:${position++}`, value: text.slice(offset, offset + limit)});}
    return rows;
  }));
  const measured = useRef(new Map<string, number>()), visible = useRef(new Set<string>()), seen = useRef(new Set<string>()), published = useRef(new Set<string>());
  const currentSegments = useRef(segments), publish = useRef(onSeen);
  useLayoutEffect(() => {currentSegments.current = segments; publish.current = onSeen;}, [segments, onSeen]);
  const qualify = useCallback(() => {
    if (!opened.current || !shown.current || epoch.current !== openingEpoch || viewport.current <= 0) return;
    for (const id of visible.current) {const height = measured.current.get(id); if (height !== undefined && height > 0 && height <= viewport.current) seen.current.add(id);}
    const completed = facts.filter(f => !published.current.has(f.id) && currentSegments.current.filter(row => row.factId === f.id).every(row => seen.current.has(row.id))).map(f => f.id);
    if (completed.length) {completed.forEach(id => published.current.add(id)); publish.current(completed);}
  }, [facts, openingEpoch]);
  useEffect(() => {if (!open) return; const timer = setInterval(qualify, 350); return () => clearInterval(timer);}, [open, qualify]);
  useEffect(() => () => {opened.current = false; shown.current = false; epoch.current++; visible.current.clear();}, []);
  const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: ViewToken<Segment>[]}) => {
    if (!opened.current || epoch.current !== openingEpoch) return;
    visible.current = new Set(viewableItems.filter(v => v.isViewable).map(v => v.item.id)); qualify();
  }, [qualify, openingEpoch]);
  const renderItem = useCallback(({item}: {item: Segment}) => <View style={styles.row} onLayout={event => {
    if (!opened.current || epoch.current !== openingEpoch) return;
    const height = event.nativeEvent.layout.height; measured.current.set(item.id, height);
    if (viewport.current > 0 && height > viewport.current && item.value.length > 1) {
      const middle = Math.ceil(item.value.length / 2); measured.current.delete(item.id); visible.current.delete(item.id); seen.current.delete(item.id);
      setSegments(rows => rows.flatMap(row => row.id === item.id ? [{...row, id: `${row.id}:a`, value: row.value.slice(0, middle)}, {...row, id: `${row.id}:b`, value: row.value.slice(middle)}] : [row]));
    }
  }}>{!compact||currentSegments.current.find(row=>row.factId===item.factId)?.id===item.id?<Text style={styles.label}>{item.label}</Text>:null}<Text selectable style={styles.body}>{item.value}</Text></View>, [openingEpoch]);
  const close = () => {if (!opened.current || epoch.current !== openingEpoch) return; opened.current = false; shown.current = false; epoch.current++; visible.current.clear(); measured.current.clear(); setOpen(false); setShownFor(null); onReviewClosed();};
  return <><Button variant="secondary" onPress={() => {try {onReviewOpened(); epoch.current++; shown.current = false; setShownFor(null); visible.current.clear(); measured.current.clear(); viewport.current = 0; setOpeningEpoch(epoch.current); opened.current = true; setOpen(true);} catch { /* An obsolete source cannot open a new consultation. */ }}}>{compact?'Voir les dates du retour':'Lire les dates, l’historique et l’instruction'}</Button>
    <Modal visible={open} animationType="none" presentationStyle="fullScreen" onRequestClose={close} onShow={() => {if (opened.current && epoch.current === openingEpoch) {shown.current = true; setShownFor(openingEpoch);}}}>
      <SafeAreaView style={styles.modal}><View style={styles.viewport} onLayout={event => {if (opened.current && epoch.current === openingEpoch) viewport.current = event.nativeEvent.layout.height;}}>
        {open && shownFor === openingEpoch ? <FlashList key={openingEpoch} data={segments} keyExtractor={keyExtractor} renderItem={renderItem} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={<Text accessibilityRole="header" style={styles.title}>{compact?'Dates du retour':'Délai de dépôt du retour et prolongations'}</Text>}/> : null}
      </View><Button variant="secondary" onPress={close}>Fermer</Button></SafeAreaView>
    </Modal></>;
}
const styles = StyleSheet.create({modal: {flex: 1, gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background}, viewport: {flex: 1}, title: {...typography.h3, color: colors.foreground}, row: {gap: spacing.xs, paddingVertical: spacing.sm}, label: {...typography.caption, color: colors.muted}, body: {...typography.bodySmall, color: colors.foreground}});
