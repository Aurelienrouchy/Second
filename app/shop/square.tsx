import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';

import { Button, Input, ScreenHeader } from '@/components/ui';
import { SQUARE_INVENTORY_PILOT_ENABLED } from '@/config/featureFlags';
import { functions } from '@/config/firebaseConfig';
import { APP_LOCALE } from '@/constants/locale';
import { colors, components, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid, useIsLoading, useUser } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { readScopedQuery } from '@/utils/readScopedQuery';

type SquareStatus = {
  status: 'unconfigured' | 'disconnected' | 'pending' | 'connected' | 'expired' | 'failed';
  locations?: { id: string; name: string }[];
  expiresAt?: string;
};
type SquareInventory = {
  items: { id: string; name: string; sku?: string; quantity: string | null }[];
  sampledAt: string;
  truncated: boolean;
};
type ShopRequest = { expectedUid: string; shopId: string };
type SquareRequests = {
  prepare: { request: { expectedUid: string }; response: { shopId: string } };
  status: { request: ShopRequest; response: SquareStatus };
  start: { request: ShopRequest; response: { authorizationUrl: string } };
  inventory: { request: ShopRequest & { locationId: string; query?: string }; response: SquareInventory };
  disconnect: { request: ShopRequest; response: { status: 'disconnected' } };
};

async function squarePilot<A extends keyof SquareRequests>(action: A, request: SquareRequests[A]['request']) {
  const call = httpsCallable<SquareRequests[A]['request'] & { action: A }, SquareRequests[A]['response']>(
    functions, 'squareInventoryPilot',
  );
  return (await call({ ...request, action })).data;
}

function isShopId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value === value.trim() && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

function isSandboxAuthorization(value: unknown): value is string {
  // Match the exact HTTPS prefix on React Native too, whose URL parser differs
  // from browsers. The original query is sent only to this fixed endpoint.
  return typeof value === 'string' && value.length <= 4096 &&
    /^https:\/\/connect\.squareupsandbox\.com\/oauth2\/authorize\?[^#\s\\]+$/.test(value);
}

function localDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(APP_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}

function readError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'functions/not-found' || code === 'functions/permission-denied') {
    return 'Cette boutique n’est pas accessible pour ce test.';
  }
  if (code === 'functions/unauthenticated') return 'Reconnectez-vous à Seconde Dev, puis réessayez.';
  return 'Impossible de vérifier la connexion Square. Réessayez.';
}

type Action = Exclude<keyof SquareRequests, 'status'>;
type LocalView = {
  frame: symbol;
  focus: number;
  busy: Action | null;
  error: string | null;
  locationId: string | null;
  query: string;
  inventory: { locationId: string; result: SquareInventory } | null;
};

const ACTION_FAILURE: Record<Action, string> = {
  prepare: 'Impossible de préparer la boutique d’essai. Réessayez.',
  start: 'Impossible d’ouvrir la page d’autorisation Square. Vérifiez l’état de la connexion avant de réessayer.',
  inventory: 'Impossible de lire le stock. Vérifiez la connexion Square, puis réessayez.',
  disconnect: 'La déconnexion reste à vérifier. Actualisez l’état de la connexion.',
};

export default function SquareInventoryScreen() {
  const router = useRouter();
  const { shopId: routeShopId } = useLocalSearchParams<{ shopId?: string | string[] }>();
  const shopId = isShopId(routeShopId) ? routeShopId : null;
  const user = useUser();
  const uid = useAuthenticatedUid();
  const authLoading = useIsLoading();
  const generation = useAuthStore(getAuthSessionGeneration);
  const expectedUid = SQUARE_INVENTORY_PILOT_ENABLED && !authLoading && uid && user?.id === uid ? uid : null;
  const context = useShippingPurchaseContext(`square-inventory:${shopId ?? 'prepare'}`, expectedUid);
  const [savedView, setSavedView] = useState<LocalView | null>(null);
  const view: LocalView = savedView?.frame === context.frame && savedView.focus === context.focusRevision
    ? savedView
    : {
        frame: context.frame, focus: context.focusRevision, busy: null, error: null,
        locationId: null, query: '', inventory: null,
      };

  const statusQuery = useQuery({
    queryKey: ['square-inventory-pilot', expectedUid, generation, shopId, context.focusRevision],
    enabled: !!expectedUid && !!shopId && context.focused,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, () => squarePilot('status', { expectedUid: expectedUid!, shopId: shopId! })),
  });
  const status = context.focused && !statusQuery.isError ? statusQuery.data : undefined;
  const connected = status?.status === 'connected';
  const locations = connected ? status.locations ?? [] : [];
  const locationId = locations.find(location => location.id === view.locationId)?.id ??
    (locations.length === 1 ? locations[0].id : null);
  const expiresAt = localDate(status?.expiresAt);
  const inventory = view.inventory?.locationId === locationId ? view.inventory.result : null;
  const sampledAt = localDate(inventory?.sampledAt);

  const update = (values: Partial<LocalView>) => setSavedView({ ...view, ...values });
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/settings');

  const runAction = async (action: Action) => {
    if (!expectedUid || !context.focused || (action !== 'prepare' && !shopId)) return;
    let operation: ReturnType<typeof context.start> = null;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    update({ busy: action, error: null, inventory: null });
    let error: string | null = null;
    let inventory: LocalView['inventory'] = null;
    try {
      if (action === 'prepare') {
        const result = await squarePilot('prepare', { expectedUid });
        context.assertCurrent(operation);
        if (!isShopId(result.shopId)) throw new Error('Identifiant de boutique invalide.');
        router.setParams({ shopId: result.shopId });
        return;
      }
      if (!shopId) return;
      const request = { expectedUid, shopId };
      if (action === 'start') {
        const { authorizationUrl } = await squarePilot('start', request);
        context.assertCurrent(operation);
        if (!isSandboxAuthorization(authorizationUrl)) throw new Error('Adresse d’autorisation invalide.');
        await Linking.openURL(authorizationUrl);
      } else if (action === 'disconnect') {
        await squarePilot('disconnect', request);
      } else if (locationId) {
        const query = view.query.trim();
        const result = await squarePilot('inventory', { ...request, locationId, ...(query ? { query } : {}) });
        inventory = { locationId, result };
      }
    } catch {
      error = ACTION_FAILURE[action];
    } finally {
      if (context.isCurrent(operation)) {
        update({ busy: null, error, inventory });
        // The browser can foreground Seconde before Square processes its return.
        // This refresh supplements the explicit check and the next foreground read.
        if (shopId && (action === 'start' || action === 'disconnect')) void statusQuery.refetch();
      }
      context.finish(operation);
    }
  };

  const verifyConnection = () => {
    if (!context.focused || view.busy || !shopId) return;
    update({ error: null, inventory: null });
    void statusQuery.refetch();
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Inventaire Square" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!SQUARE_INVENTORY_PILOT_ENABLED ? (
          <Text style={styles.body}>Ce test est disponible dans Seconde Dev.</Text>
        ) : authLoading ? (
          <ActivityIndicator accessibilityLabel="Vérification de la session" color={colors.primaryDark} />
        ) : !expectedUid ? (
          <Text style={styles.body}>Connectez-vous à Seconde Dev pour tester Square.</Text>
        ) : routeShopId !== undefined && !shopId ? (
          <Text style={styles.body}>Le lien vers la boutique est invalide.</Text>
        ) : (
          <>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>Square Sandbox</Text>
              <Text style={styles.title}>Inventaire de test</Text>
              <Text style={styles.body}>
                Reliez un compte Square de test pour consulter le stock d’un emplacement en lecture seule.
              </Text>
            </View>

            {view.error && <Text accessibilityRole="alert" style={styles.error}>{view.error}</Text>}

            {!shopId ? (
              <Button onPress={() => void runAction('prepare')} loading={view.busy === 'prepare'} disabled={!context.focused}>
                Préparer la boutique d’essai
              </Button>
            ) : (
              <>
                {statusQuery.isError ? (
                  <Text accessibilityRole="alert" style={styles.error}>{readError(statusQuery.error)}</Text>
                ) : statusQuery.isFetching || !status ? (
                  <ActivityIndicator accessibilityLabel="Vérification de la connexion Square" color={colors.primaryDark} />
                ) : status.status === 'unconfigured' ? (
                  <Text style={styles.body}>Le Sandbox Square n’est pas encore configuré sur Seconde Dev.</Text>
                ) : status.status === 'pending' ? (
                  <View style={styles.panel}>
                    <Text style={styles.heading}>Autorisation en attente</Text>
                    <Text style={styles.body}>
                      Terminez l’autorisation dans votre navigateur. Revenez ici et vérifiez la connexion.
                    </Text>
                    <Button variant="ghost" onPress={() => void runAction('disconnect')} loading={view.busy === 'disconnect'} disabled={!!view.busy}>
                      Annuler la tentative
                    </Button>
                  </View>
                ) : connected ? (
                  <>
                    <View style={styles.panel}>
                      <Text style={styles.heading}>Compte Square de test connecté</Text>
                      {expiresAt && <Text style={styles.body}>Connexion temporaire jusqu’au {expiresAt}.</Text>}
                    </View>
                    <View style={styles.inventory}>
                      <Text style={styles.heading}>Emplacement</Text>
                      {locations.length === 0 && <Text style={styles.body}>Aucun emplacement disponible.</Text>}
                      {locations.map(location => (
                        <Button
                          key={location.id}
                          variant={location.id === locationId ? 'secondary' : 'ghost'}
                          onPress={() => update({ locationId: location.id, inventory: null, error: null })}
                          disabled={!!view.busy}
                          accessibilityLabel={location.id === locationId ? `${location.name}, sélectionné` : location.name}
                        >
                          {location.name}
                        </Button>
                      ))}
                      {!!locationId && (
                        <>
                          <Input
                            accessibilityLabel="Nom de l’article ou référence"
                            placeholder="Nom de l’article ou référence"
                            value={view.query}
                            maxLength={80}
                            disabled={!!view.busy}
                            onChangeText={query => update({ query, inventory: null, error: null })}
                          />
                          <Button onPress={() => void runAction('inventory')} loading={view.busy === 'inventory'} disabled={!!view.busy}>
                            {inventory ? 'Actualiser le stock' : 'Lire le stock'}
                          </Button>
                        </>
                      )}
                      {inventory && (
                        <View style={styles.inventory}>
                          <Text style={styles.heading}>Aperçu du stock</Text>
                          {sampledAt && <Text style={styles.body}>Lecture du {sampledAt}</Text>}
                          {inventory.items.length === 0 && <Text style={styles.body}>Aucun article trouvé.</Text>}
                          {inventory.items.map(item => (
                            <View key={item.id} style={styles.item}>
                              <Text style={styles.itemName}>{item.name}</Text>
                              {item.sku && <Text style={styles.body}>Référence {item.sku}</Text>}
                              <Text style={styles.body}>
                                {item.quantity === null ? 'Quantité non fournie' : `En stock : ${item.quantity.replace('.', ',')}`}
                              </Text>
                            </View>
                          ))}
                          {inventory.truncated && (
                            <Text style={styles.body}>L’aperçu est limité. Affinez la recherche pour trouver un article précis.</Text>
                          )}
                        </View>
                      )}
                    </View>
                    <Button variant="ghost" onPress={() => void runAction('disconnect')} loading={view.busy === 'disconnect'} disabled={!!view.busy}>
                      Déconnecter de Seconde Dev
                    </Button>
                  </>
                ) : (
                  <View style={styles.panel}>
                    {status.status === 'expired' && <Text style={styles.heading}>Connexion expirée</Text>}
                    {status.status === 'failed' && <Text style={styles.heading}>Autorisation incomplète</Text>}
                    <Text style={styles.body}>
                      Ouvrez d’abord le tableau de bord de votre compte de test Square dans le navigateur par défaut.
                      Revenez ensuite ici pour autoriser Seconde Dev dans ce même navigateur.
                    </Text>
                    <Button onPress={() => void runAction('start')} loading={view.busy === 'start'} disabled={!!view.busy}>
                      Autoriser dans Square
                    </Button>
                  </View>
                )}
                <Button
                  variant="secondary"
                  onPress={verifyConnection}
                  disabled={!context.focused || !!view.busy || statusQuery.isFetching}
                >
                  Vérifier la connexion
                </Button>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  intro: { gap: spacing.sm },
  eyebrow: { ...typography.labelUppercase, color: colors.primaryDark, textTransform: 'uppercase' },
  title: { ...typography.h1, color: colors.foreground },
  heading: { ...typography.h2, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary },
  error: { ...typography.body, color: colors.dangerDark },
  panel: { ...components.card, backgroundColor: colors.surfaceWarm, gap: spacing.md },
  inventory: { gap: spacing.md },
  item: { ...components.card, backgroundColor: colors.surface, gap: spacing.xs },
  itemName: { ...typography.label, color: colors.foreground },
});
