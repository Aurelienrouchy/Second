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
import { useSellActorSource, isSellActorSourceCurrent, type SellActorSource } from '@/features/sell/hooks/useSellActorSource';
import type { User } from '@/types';
import { auth } from '@/config/firebaseConfig';

interface SellAdmissionContext {
  ownerKey: string;
  source: SellActorSource;
  identity: User | null;
  revision: number;
  focusEpoch: number;
}

export default function SellLayout() {
  const router = useRouter();

  const uid = useAuthenticatedUid();
  const identity = useAuthenticatedIdentity();
  const isLoading = useIsLoading();
  const showAdmissionError = useTradeAdmissionError();
  const [refresh, setRefresh] = useState(0);
  const generation = useAuthStore(getAuthSessionGeneration);
  const sdkUser = auth.currentUser;
  const ownerKey = JSON.stringify([uid, generation]);
  const { source: actorSource, getCurrentSource } = useSellActorSource();
  const [failure, setFailure] = useState<(SellAdmissionContext & { error: unknown }) | null>(null);
  const focus = useRef({ active: false, epoch: 0 });
  const [focusState, setFocusState] = useState({ active: false, epoch: 0 });
  const guestPrompt = useRef<{ ownerKey: string; focusEpoch: number } | null>(null);
  const [admittedOwner, setAdmittedOwner] = useState<SellAdmissionContext | null>(null);
  useFocusEffect(useCallback(() => {
    const entered = { active: true, epoch: focus.current.epoch + 1 };
    focus.current = entered; setFocusState(entered); setRefresh(value => value + 1);
    return () => {
      const left = { active: false, epoch: focus.current.epoch + 1 };
      focus.current = left; setFocusState(left);
    };
  }, []));
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
    const source = getCurrentSource();
    const context = { ownerKey, source, identity, revision: refresh, focusEpoch };
    const verify = async () => {
      let session: TradeSession | undefined;
      try {
        session = captureTradeSession(uid);
        const assertCurrent = () => {
          assertTradeSessionCurrent(session!);
          if (!active || !focus.current.active || focus.current.epoch !== focusEpoch ||
            !isSellActorSourceCurrent(getCurrentSource(), source) ||
            useAuthStore.getState().identityUser !== identity) throw staleTradeOperation();
        };
        assertCurrent();
        await assertSalePreparationAdmission(uid, assertCurrent);
        assertCurrent();
        setFailure(null);
        setAdmittedOwner(context);
      } catch (error) {
        if (!active || !focus.current.active || focus.current.epoch !== focusEpoch || !session ||
          !isTradeSessionCurrent(session) || !isSellActorSourceCurrent(getCurrentSource(), source) ||
          useAuthStore.getState().identityUser !== identity) return;
        setFailure({ ...context, error });
        showAdmissionError(error, { isCurrent: () => active && !!session && isTradeSessionCurrent(session) &&
          isSellActorSourceCurrent(getCurrentSource(), source) && useAuthStore.getState().identityUser === identity,
        retry: () => setRefresh(value => value + 1), publication: {uid} });
      }
    };
    void verify();
    return () => { active = false; };
  }, [uid, identity, isLoading, generation, refresh, router, sdkUser]);

  const isCurrentContext = (context: SellAdmissionContext | null) => !!context &&
    context.ownerKey === ownerKey && context.identity === identity && context.revision === refresh &&
    context.focusEpoch === focusState.epoch && focusState.active &&
    isSellActorSourceCurrent(actorSource, context.source);
  const admitted = !isLoading && isCurrentContext(admittedOwner);
  // A fresh foreground check must block interaction, not destroy local media.
  // A different SDK actor/occurrence still unmounts the entire former stack.
  const retainRoutes = !!admittedOwner && isSellActorSourceCurrent(actorSource, admittedOwner.source);
  const admissionGate = () => {
    const ownerFailure = isCurrentContext(failure) ? failure!.error : null;
    const refusal = tradeAdmissionPresentation(ownerFailure, true);
    return <View style={styles.gate} testID="sell-admission-gate" accessibilityViewIsModal>
      {isLoading || !ownerFailure ? <View style={styles.pending}><Skeleton width={48} height={48} borderRadius={radius.md} /></View> : <>
        <Text style={styles.title}>{refusal?.title ?? 'Vente indisponible'}</Text>
        <Text style={styles.message}>{refusal?.message ?? 'Impossible de vérifier vos critères. Votre brouillon est conservé.'}</Text>
        {refusal?.action === 'support' && <Button onPress={() => router.push('/settings/help')}>Contacter l’assistance</Button>}
        <Button onPress={() => setRefresh(value => value + 1)}>Réessayer</Button>
        <Button variant="secondary" onPress={() => router.replace('/(tabs)')}>Voir le catalogue</Button>
      </>}
    </View>;
  };
  if (!retainRoutes) return admissionGate();

  return (
    <View style={styles.container}>
      <View
        style={styles.container}
        testID="sell-admission-routes"
        pointerEvents={admitted ? 'auto' : 'none'}
        accessibilityElementsHidden={!admitted}
        importantForAccessibility={admitted ? 'auto' : 'no-hide-descendants'}
      >
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
      </View>
      {!admitted && <View style={styles.blockingGate}>{admissionGate()}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  blockingGate: { ...StyleSheet.absoluteFill },
  gate: { flex: 1, backgroundColor: colors.cream, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  pending: { alignItems: 'center' },
  title: { ...typography.h3, color: colors.charcoal },
  message: { ...typography.body, color: colors.muted },
});
