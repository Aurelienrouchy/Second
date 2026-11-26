import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Modal, StyleSheet, Text, View, useWindowDimensions, type ViewToken} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import type {ConvenienceReturnPreview} from '@/types/convenienceReturn';
export interface ConvenienceReturnFact {id: string; label: string; value: string}
const money = (cents: number) => new Intl.NumberFormat('fr-CA', {style: 'currency', currency: 'CAD'}).format(cents / 100);
export function convenienceReturnFacts(preview: ConvenienceReturnPreview, compact = false): ConvenienceReturnFact[] {
  if(compact){
    const terms=preview.proposal?.terms??preview.terms;
    if(!terms)return [];
    const facts:ConvenienceReturnFact[]=[],add=(id:string,label:string,value:string)=>facts.push({id,label,value});
    add('article','Article',terms.article.title);
    if(terms.article.description)add('description','Description',terms.article.description);
    add('unit','Contenu du retour','saleUnit'in terms.article&&terms.article.saleUnit==='set_as_one'?'L’ensemble complet, tel qu’il a été vendu.':'L’article complet, tel qu’il a été vendu.');
    for(const [id,label,address]of [['from','Départ du retour',terms.route.shipFrom],['to','Adresse de retour',terms.route.shipTo]]as const)add(id,label,[address.name,address.addressLine1,address.addressLine2,`${address.cityLocality}, ${address.stateProvince} ${address.postalCode}`,address.countryCode,address.phone,address.email].filter(Boolean).join('\n'));
    const parcel=terms.route.parcel;
    add('parcel','Colis prévu',`${parcel.weight.value} kg · ${parcel.dimensions.length} × ${parcel.dimensions.width} × ${parcel.dimensions.height} cm. Vérifiez que ce format convient au retour.`);
    add('service','Service de retour',`${terms.route.carrierCode} · ${terms.route.serviceCode}`);
    add('reason','Motif','Vous avez changé d’avis et déclarez l’article conforme. Le vendeur peut accepter ou refuser ce retour.');
    if(terms.protocol==='convenience_return_terms_v2'){
      add('cost','Frais de retour','À la charge de l’acheteur, déduits du remboursement. Le montant sera présenté avant la création de l’étiquette.');
      add('refund','Remboursement prévu',`Prix de l’article uniquement : ${money(terms.refund.originalArticleCents)}. Les frais de port initiaux, les frais de service et leurs taxes ne sont pas remboursés.`);
      if(terms.refund.alreadyAllocatedArticleCents>0)add('allocated','Montant déjà affecté',`${money(terms.refund.alreadyAllocatedArticleCents)}. Cette somme n’est pas nécessairement déjà remboursée.`);
      add('remaining','Prix article remboursable au maximum',`${money(terms.refund.maximumRemainingArticleCents)}, avant les frais de retour.`);
    }else add('cost','Frais et remboursement','Les frais et le remboursement seront à convenir séparément.');
    add('next','Prochaine étape','Attendez l’accord du vendeur, puis les instructions et l’étiquette avant d’expédier. Le remboursement sera confirmé séparément.');
    if(preview.proposal)add('proposal','Demande en cours',preview.sourceCurrentlyMatches?'Cette demande correspond aux informations de la commande.':'La commande a changé. Aucun nouvel accord ne peut être donné pour le moment.');
    return facts;
  }
  const rows: ConvenienceReturnFact[] = [];
  const add = (label: string, value: string) => {
    for (let offset = 0; offset < value.length; offset += 180) rows.push({id: `${label}:${offset}`, label, value: value.slice(offset, offset + 180)});
  };
  // An older proposal keeps its own conditions even when the current source differs.
  const terms = preview.proposal?.terms ?? preview.terms;
  if (!terms) return [];
  add('Commande et parties', `${terms.transactionId} · acheteur ${terms.buyerId} · vendeur ${terms.sellerId}`);
  add('Article figé', `${terms.article.title} · ${terms.articleId}`);
  add('Description figée', terms.article.description);
  add('Unité retournée', 'saleUnit' in terms.article
    ? terms.article.saleUnit === 'set_as_one' ? 'Ensemble vendu et retourné comme un tout. Aucun retour d’élément séparé n’est convenu ici.' : 'Un article unique ; la demande porte sur toute la transaction.'
    : 'Le contenu complet de l’annonce ; la demande porte sur toute la transaction.');
  for (const [label, address] of [['Départ du retour', terms.route.shipFrom], ['Destination du retour', terms.route.shipTo]] as const) {
    add(label, [address.name, address.addressLine1, address.addressLine2, `${address.cityLocality}, ${address.stateProvince} ${address.postalCode}`, address.countryCode].filter(Boolean).join('\n'));
    if (address.phone) add(`${label} · téléphone`, address.phone);
    if (address.email) add(`${label} · courriel`, address.email);
  }
  const p = terms.route.parcel;
  add('Colis contractuel', `${p.weight.value} kg · ${p.dimensions.length} × ${p.dimensions.width} × ${p.dimensions.height} cm. Ces mesures ne prouvent pas le contenu physique du colis.`);
  add('Service et origine du trajet', `${terms.route.carrierCode} · ${terms.route.serviceCode} · transporteur ${terms.route.carrierId} · étiquette aller ${terms.route.outboundLabelId}`);
  add('Motif déclaré', 'Simple changement d’avis pour un article déclaré conforme par l’acheteur. La conformité et l’état physique ne sont pas vérifiés par cette déclaration.');
  add('Portée de l’accord', 'Le vendeur choisit explicitement d’accepter ou de refuser le principe de ce retour. Aucun retour pour changement d’avis n’est imposé au vendeur.');
  if (terms.protocol === 'convenience_return_terms_v2') {
    add('Frais de retour', 'Les frais de retour sont à la charge de l’acheteur. Le devis financier distinct précise leur déduction du prix article et le remboursement net à confirmer. Aucun montant d’étiquette n’est établi par cet accord documentaire.');
    add('Règle de remboursement', 'Le remboursement prévu porte uniquement sur le prix de l’article. Les frais de port initiaux, les frais de service et leurs taxes éventuelles ne sont pas remboursés pour ce changement d’avis.');
    add('Prix initial de l’article', money(terms.refund.originalArticleCents));
    add('Part article déjà réservée ou allouée', `${money(terms.refund.alreadyAllocatedArticleCents)}. Cette allocation ne prouve pas un remboursement exécuté.`);
    add('Plafond article restant à instruire', `${money(terms.refund.maximumRemainingArticleCents)}. Ce plafond n’est ni une instruction ni une preuve de remboursement.`);
    add('Port initial exclu', money(terms.refund.excluded.outboundShippingCents));
    add('Frais de service exclus', money(terms.refund.excluded.serviceFeeCents));
    add('Taxes du service exclues', money(terms.refund.excluded.serviceTaxCents));
    add('Limites de cet accord', 'L’accord ne confirme ni le paiement du retour, ni la disponibilité de son étiquette, ni un remboursement. Aucun débit d’étiquette sur le compte du vendeur n’est autorisé. Une instruction native distincte doit rapprocher les moyens de paiement initiaux.');
  } else add('Coûts et remboursement', 'La répartition et le financement des frais restent à instruire séparément. Aucun paiement du vendeur, remboursement, gel de fonds ou achat d’étiquette n’est autorisé par cet accord.');
  add('Avant tout dépôt', 'Aucune permission d’expédier n’est donnée ici. Attendez les instructions et l’étiquette qualifiées dans le parcours distinct. Le signalement d’une non-conformité et le support restent accessibles.');
  if (preview.proposal) {
    add('Proposition enregistrée', `${preview.proposal.proposalId} · reçue ${preview.proposal.requestedAt} · réponse ${preview.proposal.respondedAt ?? 'non enregistrée'}`);
    add('Conditions de cette proposition', preview.sourceCurrentlyMatches ? 'La source actuelle correspond à la proposition native.' : 'La source actuelle ne correspond pas à la proposition. Aucun nouvel accord n’est proposé.');
  }
  return rows;
}
interface Segment extends ConvenienceReturnFact {factId: string}
const keyExtractor = (row: Segment) => row.id;
const viewabilityConfig = {itemVisiblePercentThreshold: 95, minimumViewTime: 300};
/** A dedicated native full-screen surface removes the enclosing order's
 * ScrollView clipping. Newlines are split before length, and actual measured
 * row heights still qualify each visible segment. Visibility is not reading. */
export function ConvenienceReturnFacts({facts, onSeen, onReviewOpened, onReviewClosed, compact=false}: {compact?:boolean; facts: ConvenienceReturnFact[]; onSeen: (ids: string[]) => void; onReviewOpened: () => void; onReviewClosed: () => void}) {
  const {width, fontScale} = useWindowDimensions();
  const [open, setOpen] = useState(false), opened = useRef(false), viewport = useRef(0);
  const epoch = useRef(0), [openingEpoch, setOpeningEpoch] = useState(0);
  const limit = Math.max(1, Math.floor((width - spacing.lg * 2) / ((compact ? spacing.sm : spacing.lg) * Math.max(1, fontScale))) * (compact ? 3 : 1));
  const [segments, setSegments] = useState<Segment[]>(() => facts.flatMap(fact => {
    const pieces: Segment[] = []; let position = 0;
    for (const line of fact.value.split(/\r\n|\r|\n/)) {
      const text = line || ' ';
      for (let offset = 0; offset < text.length; offset += limit) pieces.push({id: `${fact.id}:${position++}`, factId: fact.id, label: fact.label, value: text.slice(offset, offset + limit)});
    }
    return pieces;
  }));
  const measured = useRef(new Map<string, number>()), visible = useRef(new Set<string>()), seen = useRef(new Set<string>()), published = useRef(new Set<string>());
  const currentSegments = useRef(segments), publish = useRef(onSeen);
  useLayoutEffect(() => {currentSegments.current = segments; publish.current = onSeen;}, [segments, onSeen]);
  const qualify = useCallback(() => {
    if (!opened.current || epoch.current !== openingEpoch || viewport.current <= 0) return;
    for (const id of visible.current) {const height = measured.current.get(id); if (height !== undefined && height > 0 && height <= viewport.current) seen.current.add(id);}
    const completed = facts.filter(fact => !published.current.has(fact.id) && currentSegments.current.filter(row => row.factId === fact.id).every(row => seen.current.has(row.id))).map(fact => fact.id);
    if (completed.length) {completed.forEach(id => published.current.add(id)); publish.current(completed);}
  }, [facts, openingEpoch]);
  useEffect(() => {
    if (!open) return; const timer = setInterval(qualify, 350); return () => clearInterval(timer);
  }, [open, qualify]);
  const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: ViewToken<Segment>[]}) => {
    if (!opened.current || epoch.current !== openingEpoch) return;
    visible.current = new Set(viewableItems.filter(v => v.isViewable).map(v => v.item.id)); qualify();
  }, [qualify, openingEpoch]);
  const renderItem = useCallback(({item}: {item: Segment}) => <View style={styles.row} onLayout={event => {
    if (!opened.current || epoch.current !== openingEpoch) return;
    measured.current.set(item.id, event.nativeEvent.layout.height);
    if (viewport.current > 0 && event.nativeEvent.layout.height > viewport.current && item.value.length > 1) {
      // A large accessibility font or unusual glyph cannot create an
      // unviewable atomic row. Its children must each be seen afresh.
      const middle = Math.ceil(item.value.length / 2); measured.current.delete(item.id); visible.current.delete(item.id); seen.current.delete(item.id);
      setSegments(rows => rows.flatMap(row => row.id === item.id ? [{...row, id: `${row.id}:a`, value: row.value.slice(0, middle)}, {...row, id: `${row.id}:b`, value: row.value.slice(middle)}] : [row]));
    }
  }}>{!compact||currentSegments.current.find(row=>row.factId===item.factId)?.id===item.id?<Text style={styles.label}>{item.label}</Text>:null}<Text selectable style={styles.body}>{item.value}</Text></View>, [openingEpoch]);
  const close = () => {if (!opened.current || epoch.current !== openingEpoch) return; opened.current = false; epoch.current++; visible.current.clear(); measured.current.clear(); setOpen(false); onReviewClosed();};
  return <><Button variant="secondary" onPress={() => {try {onReviewOpened(); epoch.current++; visible.current.clear(); measured.current.clear(); viewport.current = 0; setOpeningEpoch(epoch.current); opened.current = true; setOpen(true);} catch { /* An obsolete source cannot open a new consultation. */ }}}>{compact?'Vérifier les détails du retour':'Ouvrir toutes les conditions du retour'}</Button>
    <Modal visible={open} animationType="none" presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.viewport} onLayout={event => {if (opened.current && epoch.current === openingEpoch) viewport.current = event.nativeEvent.layout.height;}}>
          <FlashList key={openingEpoch} data={segments} keyExtractor={keyExtractor} renderItem={renderItem} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
            ListHeaderComponent={<View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{compact?'Votre retour':'Conditions du retour pour changement d’avis'}</Text>{compact?<Text style={styles.label}>Vérifiez ces informations avant de confirmer votre choix.</Text>:<Text style={styles.label}>Parcourez chaque ligne. Leur affichage ne certifie pas leur lecture ; votre déclaration explicite reste nécessaire après fermeture.</Text>}</View>}/>
        </View>
        <Button variant="secondary" onPress={close}>Fermer</Button>
      </SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({modal: {flex: 1, gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background}, viewport: {flex: 1}, heading: {gap: spacing.md, paddingBottom: spacing.md}, title: {...typography.h3, color: colors.foreground}, row: {gap: spacing.xs, paddingVertical: spacing.sm}, label: {...typography.caption, color: colors.muted}, body: {...typography.bodySmall, color: colors.foreground}});
