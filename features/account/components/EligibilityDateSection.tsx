import React from 'react';
import { Text,StyleSheet } from 'react-native';
import { Button } from '@/components/ui';
import { colors,typography } from '@/constants/theme';
import type { OwnerEligibility } from '@/types/eligibility';
import { declaredDateLabel } from '@/utils/eligibilityPresentation';
export function EligibilityDateSection({eligibility,onFirstDate,onCorrection}:{eligibility:OwnerEligibility;onFirstDate:()=>void;onCorrection:()=>void}) {
 return <>
      <Text style={styles.title}>Date de naissance déclarée</Text>
      <Text style={styles.body}>{declaredDateLabel(eligibility.dateOfBirth, eligibility.dateOfBirthCopy)}</Text>
      {eligibility.dateOfBirthSource === 'missing' ? <>
        <Text style={styles.body}>La première date passe par le parcours d’inscription, avec votre acceptation des conditions et de la confidentialité.</Text>
        <Button onPress={onFirstDate}>Compléter mes renseignements</Button>
      </> : <Button variant="secondary" onPress={onCorrection}>Demander une correction</Button>}
 </>;
}
const styles=StyleSheet.create({title:{...typography.h3,color:colors.foreground},body:{...typography.body,color:colors.foregroundSecondary}});
