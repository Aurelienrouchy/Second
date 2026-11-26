import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {Button, Input, ScreenHeader} from '@/components/ui';
import {SellerTaxDossierPanel} from '@/components/SellerTaxDossierPanel';
import {SellerTaxCommandJournal} from '@/components/SellerTaxCommandJournal';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {colors, spacing, typography} from '@/constants/theme';

export default function SellerTaxScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), generation = getAuthSessionGeneration();
  const context = useLabelLifecycleContext(`owner-tax:${uid}:${generation}`, uid);
  const [yearText, setYearText] = useState(String(new Date().getUTCFullYear())), [selectedYear, setSelectedYear] = useState<number | null>(null);
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  const validYear = year !== null && year >= 2024 && year <= new Date().getUTCFullYear() + 1;
  return <View style={styles.container}>
    <ScreenHeader title="Mes documents et démarches fiscales" onBack={() => router.back()}/>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Consultez vos événements, résumés documentaires et demandes d’aide par année. Les dates enregistrées sont affichées en UTC ; le rattachement fiscal dépend de la politique de période de l’exploitant indiquée dans le résumé.</Text>
      <Text style={styles.caption}>Ce parcours ne collecte aucun identifiant fiscal et ne donne pas d’avis sur votre revenu imposable. Une pièce de remise externe ne rend pas à elle seule une copie téléchargeable dans l’application.</Text>
      {!uid ? <Text style={styles.body}>Reconnectez-vous avec un moyen déjà lié pour accéder à votre historique fiscal privé.</Text> : <>
        <Input label="Année fiscale à consulter" value={yearText} onChangeText={setYearText} keyboardType="number-pad" maxLength={4}/>
        <Button disabled={!validYear || !context.focused} onPress={() => {try {context.capture(); if (validYear && year !== null) setSelectedYear(year);} catch {/* Current SDK owner only. */}}}>Lire cette année pour mon compte</Button>
        {selectedYear === null ? <SellerTaxCommandJournal uid={uid}/> : <SellerTaxDossierPanel key={`${uid}:${generation}:${selectedYear}`} uid={uid}
          scope={{access: 'owner', subject: 'seller', ownerId: uid, year: selectedYear}}/>}
      </>}
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Aide et recours</Button>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
