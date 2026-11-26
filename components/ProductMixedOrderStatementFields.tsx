import {StyleSheet,Text,View} from 'react-native';
import {Button,Input} from '@/components/ui';
import {ProductMaterialDateFields} from '@/components/ProductMaterialDateFields';
import {colors,spacing,typography} from '@/constants/theme';
import {MIXED_KIND_LABELS} from '@/utils/productMixedOrderStatement';
import type {ProductMixedOrderDraft} from '@/types/productMixedOrders';
export function ProductMixedOrderStatementFields({value,disabled,onChange}:{value:ProductMixedOrderDraft;disabled:boolean;onChange:(v:ProductMixedOrderDraft)=>void}){
  const change=(patch:Partial<ProductMixedOrderDraft>)=>{if(!disabled)onChange({...value,...patch});};
  return <View style={styles.section}><Text style={styles.title}>Constat de contenu mélangé ou d’étiquettes échangées</Text><Text style={styles.caption}>Décrivez uniquement ce que vous constatez dans cette commande. Ne recopiez ni nom, coordonnées, adresse, référence de commande ou étiquette identifiant un autre acheteur dans le récit ou les pièces. Aucun rapprochement avec une autre personne n’est établi par ce dépôt.</Text>
    {(Object.keys(MIXED_KIND_LABELS) as (keyof typeof MIXED_KIND_LABELS)[]).map(kind=><Button key={kind} variant={value.kind===kind?'primary':'secondary'} disabled={disabled} onPress={()=>change({kind})}>{MIXED_KIND_LABELS[kind]}</Button>)}
    <ProductMaterialDateFields label="Date du constat de mélange" value={value.observedAt} disabled={disabled} onChange={observedAt=>change({observedAt})}/>
    <Input label="Ce que j’ai observé, sans coordonnées de tiers" multiline value={value.description} maxLength={4000} disabled={disabled} onChangeText={description=>change({description})}/>
    {(['available','unavailable','unknown'] as const).map(evidenceAvailability=><Button key={evidenceAvailability} variant={value.evidenceAvailability===evidenceAvailability?'primary':'secondary'} disabled={disabled} onPress={()=>change({evidenceAvailability})}>{evidenceAvailability==='available'?'Pièces disponibles selon moi':evidenceAvailability==='unavailable'?'Pièces indisponibles selon moi':'Disponibilité inconnue'}</Button>)}
    <Input label="Limites et pièces manquantes selon moi" multiline value={value.evidenceLimitations} maxLength={2000} disabled={disabled} onChangeText={evidenceLimitations=>change({evidenceLimitations})}/>
    {value.contestedDecision?<><Text selectable style={styles.caption}>Décision exacte contestée : {value.contestedDecision.decisionId} · {value.contestedDecision.contentHash}. Ce constat demandera un réexamen de cette version.</Text><Button variant="secondary" disabled={disabled} onPress={()=>change({contestedDecision:null})}>Conserver un nouveau constat sans contestation</Button></>:null}
    <Text style={styles.caption}>Le trajet et l’étiquette sont ceux du constat colis choisi. Après dépôt, aucune interception ou récupération n’est promise. Photos privées et réception physique restent distinctes ; le dépôt n’autorise ni frais, dette, stock, remboursement ou regroupement contractuel.</Text>
  </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.sm,paddingVertical:spacing.sm},title:{...typography.body,color:colors.foreground},caption:{...typography.caption,color:colors.muted}});
