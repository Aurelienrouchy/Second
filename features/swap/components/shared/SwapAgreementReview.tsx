import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { SwapAgreementPreview } from '@/types/swap';
import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { SwapAgreementImage } from './SwapAgreementImage';

function images(item: SwapAgreementPreview['initiatorItems'][number]): string[] {
  const values = Array.isArray(item.images) ? item.images.map(value => value && typeof value.url === 'string' ? value.url : null)
    .filter((value): value is string => !!value) : [];
  return values.length ? values : typeof item.imageUrl === 'string' && item.imageUrl ? [item.imageUrl] : [];
}
function statements(item: SwapAgreementPreview['initiatorItems'][number]): string[] {
  const hygiene = item.hygieneDeclaration && typeof item.hygieneDeclaration === 'object' ? item.hygieneDeclaration as Record<string, unknown> : null;
  const child = item.childSafetyDeclaration && typeof item.childSafetyDeclaration === 'object' ? item.childSafetyDeclaration as Record<string, unknown> : null;
  const lines: string[] = [];
  if (hygiene?.kind === 'underwear') lines.push('Le membre déclare que ce sous-vêtement n’a jamais été porté.');
  if (hygiene?.kind === 'cosmetic') lines.push('Le membre déclare que ce cosmétique est neuf et encore scellé.');
  if (hygiene?.kind === 'not_applicable') lines.push('Le membre déclare un article sans sous-vêtement ou cosmétique.');
  if (child) {
    lines.push(`Usage déclaré : ${child.intendedUse === 'daywear_only' ? 'vêtement de jour uniquement' : child.intendedUse === 'sleep_or_related' ? 'sommeil ou usage apparenté' : 'inconnu'}.`);
    lines.push(`Étiquette déclarée : ${child.labelStatus === 'readable' ? 'lisible' : child.labelStatus === 'missing' ? 'absente' : 'inconnue'}.${typeof child.labelText === 'string' ? ` ${child.labelText}` : ''}`);
    if (child.sleepwearStyle) lines.push(`Coupe déclarée : ${child.sleepwearStyle === 'tight_fitting_claimed' ? 'ajustée' : child.sleepwearStyle === 'loose_fitting_claimed' ? 'ample' : 'inconnue'}.`);
    lines.push(`Préoccupation de sécurité déclarée : ${child.safetyConcern === 'observed' ? 'signalée' : child.safetyConcern === 'none_observed' ? 'aucune observée' : 'inconnue'}.${typeof child.observation === 'string' ? ` ${child.observation}` : ''}`);
  }
  return lines;
}

interface Props { preview: SwapAgreementPreview; uid: string; accepted: boolean; disabled?: boolean; onToggle: () => void; onReload?: () => void;
  swapId?: string; acceptedAgreement?: boolean; articlePrivacyWithdrawals?: Record<string, unknown>; compact?: boolean; readOnly?: boolean }
export function SwapAgreementReview({ preview, uid, accepted, disabled, onToggle, onReload, swapId, acceptedAgreement = false, articlePrivacyWithdrawals, compact = false, readOnly = false }: Props) {
  const [details, setDetails] = useState(!compact);
  return <View style={styles.section}>
    {compact ? <>
      {(['initiator', 'receiver'] as const).map(side => <View key={side} style={styles.item}>
        <Text style={styles.title}>{(side === 'initiator' ? preview.initiatorId : preview.receiverId) === uid ? 'Vous proposez' : 'Vous recevez'}</Text>
        {(side === 'initiator' ? preview.initiatorItems : preview.receiverItems).map(item => <Text key={item.articleId} style={styles.body}>{item.title}</Text>)}
      </View>)}
      <Text style={styles.body}>{preview.exchangeMode === 'shipping' ? 'Envoi postal entre membres' : 'Remise en main propre'}</Text>
      <Text style={styles.body}>{preview.arrangements}</Text>
      <Text style={styles.body}>{preview.cashTopUp ? `Complément : ${formatPriceWithCurrency(preview.cashTopUp.amount / 100)} · ${preview.cashTopUp.payerId === uid ? 'vous payez' : 'l’autre membre paie'}.` : 'Sans complément.'}</Text>
      <Button variant="ghost" onPress={() => setDetails(value => !value)}>{details ? 'Masquer les détails' : 'Voir les détails et conditions'}</Button>
    </> : null}
    {details ? <View style={styles.section}>
    <Text style={styles.title}>Conditions de l’échange</Text>
    <Text style={styles.body}>{preview.exchangeMode === 'shipping' ? 'Envoi postal organisé entre les membres' : 'Remise en main propre'}</Text>
    <Text selectable style={styles.body}>{preview.termsText}</Text>
    <Text selectable style={styles.body}>{preview.arrangements}</Text>
    {preview.message ? <Text selectable style={styles.body}>Message de la proposition : {preview.message}</Text> : null}
    {(['initiator', 'receiver'] as const).map(side => <View key={side} style={styles.section}>
      <Text style={styles.title}>{(side === 'initiator' ? preview.initiatorId : preview.receiverId) === uid ? 'Vous proposez' : 'Vous recevez'}</Text>
      {(side === 'initiator' ? preview.initiatorItems : preview.receiverItems).map(item => <View key={item.articleId} style={styles.item}>
        {images(item).map((uri, index) => <SwapAgreementImage key={`${index}:${uri}`} articleId={item.articleId} originalReference={uri}
          publicSellerId={side === 'initiator' ? preview.initiatorId : preview.receiverId} swapId={swapId} acceptedAgreement={acceptedAgreement} withdrawalRecorded={!!articlePrivacyWithdrawals?.[item.articleId]} />)}
        <Text style={styles.title}>{item.title}</Text>
        <Text selectable style={styles.body}>{item.description || 'Description non enregistrée dans cet ancien accord.'}</Text>
        {item.listingContentVersion !== 'listing_content_v1' && item.listingContentVersion !== 'listing_content_v2' && <Text style={styles.body}>{item.saleUnit === 'set_as_one' ? 'Ensemble proposé comme un tout.' : item.saleUnit === 'single_article' ? 'Un article proposé entier.' : 'Unité non enregistrée dans cet ancien accord.'}</Text>}
        <Text style={styles.body}>{[item.brand, item.condition, item.size ? `${item.size.value} ${item.size.system}` : null, item.color, item.material, item.pattern].filter(value => typeof value === 'string' && value).join(' · ')}</Text>
        {Array.isArray(item.categoryIds) && item.categoryIds.every(value => typeof value === 'string') ? <Text style={styles.body}>{getCategoryLabelFromIds(item.categoryIds)}</Text> : null}
        {Array.isArray(item.colors) && item.colors.length ? <Text style={styles.body}>Couleurs : {item.colors.join(', ')}</Text> : null}
        {Array.isArray(item.materials) && item.materials.length ? <Text style={styles.body}>Matières : {item.materials.join(', ')}</Text> : null}
        {item.hasKnownDefects === true ? <Text style={styles.body}>Défauts déclarés : {String(item.defectsDescription ?? '')}</Text> : item.hasKnownDefects === false ? <Text style={styles.body}>Aucun défaut connu déclaré.</Text> : null}
        {item.hasAlterations === true ? <Text style={styles.body}>Retouches déclarées : {String(item.alterationsDescription ?? '')}</Text> : item.hasAlterations === false ? <Text style={styles.body}>Aucune retouche connue déclarée.</Text> : item.hasAlterations === null ? <Text style={styles.body}>Le membre ne sait pas si cet article a été retouché.</Text> : null}
        {statements(item).map((text, index) => <Text key={index} style={styles.body}>{text}</Text>)}
        <Text style={styles.body}>Valeur indiquée : {formatPriceWithCurrency(item.price)}</Text>
      </View>)}
    </View>)}
    <Text style={styles.body}>{preview.cashTopUp ? `Complément convenu : ${formatPriceWithCurrency(preview.cashTopUp.amount / 100)} · ${preview.cashTopUp.payerId === uid ? 'vous payez' : 'l’autre membre paie'}.` : 'Aucun complément monétaire.'}</Text>
    </View> : null}
    {!readOnly ? <Checkbox checked={accepted} disabled={disabled} onToggle={onToggle} accessibilityLabel="Je confirme ces articles et les conditions de cet échange">
      <Text style={styles.body}>Je confirme ces articles et les conditions de cet échange.</Text>
    </Checkbox> : null}
    {onReload ? <Button variant="ghost" disabled={disabled} onPress={onReload}>Relire les conditions</Button> : null}
  </View>;
}
const styles = StyleSheet.create({ section: {padding: spacing.md, gap: spacing.md}, item: {gap: spacing.sm, paddingBottom: spacing.md},
  title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foregroundSecondary} });
