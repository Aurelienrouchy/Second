import {useRouter} from 'expo-router';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, ScreenHeader, Text} from '@/components/ui';
import {SHIPPING_LISTINGS_ENABLED} from '@/config/featureFlags';
import {colors, spacing, typography} from '@/constants/theme';
import {useUser} from '@/hooks/useAuth';

export default function ShippingOptionsScreen() {
  const router = useRouter();
  const user = useUser();
  return <View style={styles.container}>
    <ScreenHeader title="Options de livraison" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Les modes de livraison se choisissent pour chaque annonce.</Text>
      <Button disabled={!user} onPress={() => router.push('/my-articles')}>Gérer mes annonces</Button>
      {SHIPPING_LISTINGS_ENABLED ? <Button variant="secondary" disabled={!user}
        onPress={() => router.push({pathname: '/settings/address', params: {purpose: 'shipping_origin'}})}>Mon adresse d’expédition</Button> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  content: {padding: spacing.lg, gap: spacing.lg},
  body: {...typography.body, color: colors.foregroundSecondary},
});
