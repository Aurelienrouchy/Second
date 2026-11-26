import { View, Text, StyleSheet } from 'react-native';
import { Button, Skeleton } from '@/components/ui';
import { colors, typography, spacing, radius } from '@/constants/theme';
import { tradeAdmissionPresentation } from '@/utils/tradeAdmissionPresentation';
import type { TradeSession } from '@/services/tradeOperation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useAuthenticatedUid, useAuthenticatedIdentity, useIsLoading } from '@/hooks/useAuth';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { assertSalePreparationAdmission } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { captureTradeSession, assertTradeSessionCurrent, isTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';

export default function SellLayout() {
  const router = useRouter();

  const uid = useAuthenticatedUid();
  const identity = useAuthenticatedIdentity();
  const isLoading = useIsLoading();
  const showAdmissionError = useTradeAdmissionError();
  const [refresh, setRefresh] = useState(0);
  const generation = useAuthStore(getAuthSessionGeneration);
  const ownerKey = JSON.stringify([uid, generation]);
  const [failure, setFailure] = useState<{ ownerKey: string; error: unknown } | null>(null);
  const focus = useRef({ active: false, epoch: 0 });
  const guestPrompt = useRef<{ ownerKey: string; focusEpoch: number } | null>(null);
  const [admittedOwner, setAdmittedOwner] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { focus.current.active = true; focus.current.epoch++; setRefresh(value => value + 1); return () => { focus.current.active = false; focus.current.epoch++; }; }, []));
  useEffect(() => {
    if (isLoading || !focus.current.active) return;
    if (!uid) {
      if (guestPrompt.current?.ownerKey === ownerKey && guestPrompt.current.focusEpoch === focus.current.epoch) return;
      guestPrompt.current = { ownerKey, focusEpoch: focus.current.epoch };
      useAuthSheetStore.getState().show('Connectez-vous pour vendre un article', () => router.replace('/(tabs)/sell'));
      router.replace('/(tabs)');
      return;
    }
    guestPrompt.current = null;
    let active = true;
    const focusEpoch = focus.current.epoch;
    const verify = async () => {
      let session: TradeSession | undefined;
      try {
        session = captureTradeSession(uid);
        const assertCurrent = () => { assertTradeSessionCurrent(session!); if (!active || !focus.current.active || focus.current.epoch !== focusEpoch) throw staleTradeOperation(); };
        await assertSalePreparationAdmission(uid, assertCurrent);
        assertCurrent();
        setFailure(null);
        setAdmittedOwner(ownerKey);
      } catch (error) {
        if (!active || !focus.current.active || focus.current.epoch !== focusEpoch || !session || !isTradeSessionCurrent(session)) return;
        setFailure({ ownerKey, error });
        showAdmissionError(error, { isCurrent: () => active && !!session && isTradeSessionCurrent(session), retry: () => setRefresh(value => value + 1), publication: {uid} });
      }
    };
    void verify();
    return () => { active = false; };
  }, [uid, identity, isLoading, generation, refresh, router]);

  // Once entered, keep the route's draft mounted while criteria are corrected.
  if (admittedOwner !== ownerKey) {
    const ownerFailure = failure?.ownerKey === ownerKey ? failure.error : null;
    const refusal = tradeAdmissionPresentation(ownerFailure, true);
    return <View style={styles.gate}>
      {isLoading || !ownerFailure ? <View style={styles.pending}><Skeleton width={48} height={48} borderRadius={radius.md} /></View> : <>
        <Text style={styles.title}>{refusal?.title ?? 'Vente indisponible'}</Text>
        <Text style={styles.message}>{refusal?.message ?? 'Impossible de vérifier vos critères. Votre brouillon est conservé.'}</Text>
        {refusal?.action === 'support' && <Button onPress={() => router.push('/settings/help')}>Contacter l’assistance</Button>}
        <Button onPress={() => setRefresh(value => value + 1)}>Réessayer</Button>
        <Button variant="secondary" onPress={() => router.replace('/(tabs)')}>Voir le catalogue</Button>
      </>}
    </View>;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="capture" options={{ headerShown: false }} />
      <Stack.Screen name="photos-review" options={{ headerShown: false }} />
      <Stack.Screen name="details" options={{ headerShown: false }} />
      <Stack.Screen name="pricing" options={{ headerShown: false }} />
      <Stack.Screen name="preview" options={{ headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: colors.cream, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  pending: { alignItems: 'center' },
  title: { ...typography.h3, color: colors.charcoal },
  message: { ...typography.body, color: colors.muted },
});
