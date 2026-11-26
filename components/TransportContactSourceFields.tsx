import {StyleSheet,Text,View} from 'react-native';
import {Button,Input} from '@/components/ui';
import {colors,spacing,typography} from '@/constants/theme';
import type {TransportContactProvenance} from '@/types/transportContact';
const labels={participant_observation:'Observation personnelle déclarée',carrier_notice_declared:'Avis du transporteur déclaré',operator_carrier_contact:'Contact transporteur effectué par l’opérateur',document_reference:'Référence documentaire déclarée',unknown:'Source inconnue'};
export function TransportContactSourceFields({value,onChange,disabled,admin,label}:{value:TransportContactProvenance;onChange:(v:TransportContactProvenance)=>void;disabled:boolean;admin:boolean;label:string}){
  return <View style={styles.group}><Text style={styles.caption}>{label}</Text>{(Object.keys(labels) as TransportContactProvenance['kind'][]).filter(k=>admin||k!=='operator_carrier_contact').map(kind=><Button key={kind} variant={value.kind===kind?'primary':'secondary'} disabled={disabled} onPress={()=>onChange({...value,kind})}>{labels[kind]}</Button>)}
    <Input label="Émetteur déclaré, ou inconnu" value={value.issuer??''} maxLength={500} disabled={disabled} onChangeText={issuer=>onChange({...value,issuer:issuer||null})}/><Input label="Référence de la source, ou inconnue" value={value.reference??''} maxLength={500} disabled={disabled} onChangeText={reference=>onChange({...value,reference:reference||null})}/><Input label="Date de la source déclarée — UTC exacte ou vide si inconnue" hint="AAAA-MM-JJTHH:mm:ss.sssZ ; aucune date n’est déduite." value={value.issuedAt??''} maxLength={24} autoCapitalize="none" disabled={disabled} onChangeText={issuedAt=>onChange({...value,issuedAt:issuedAt||null})}/>
  </View>;
}
const styles=StyleSheet.create({group:{gap:spacing.sm},caption:{...typography.caption,color:colors.muted}});
