import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import {CancelledError, useQuery, useQueryClient} from '@tanstack/react-query';

import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import {OrdinaryShippingAddressChoice} from '@/components/OrdinaryShippingAddressChoice';
import { useUser, useAuthActions, useAuthenticatedUid } from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import { track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import {SellerShippingAddressService} from '@/services/sellerShippingAddressService';
import {getAuthSessionGeneration} from '@/store/authStore';
import { validateCanadianAddress, CanadianAddressInput } from '@/utils/addressValidation';
import {createOrdinaryAddressInteraction, hasCurrentOrdinaryShippingDeclaration, ordinaryPhysicalAddress, ordinaryShippingAddressDeclaration} from '@/utils/ordinaryShippingAddress';
import type {OrdinaryShippingAddressKind, SellerShippingAddressObservation, ShippingPurchaseAddress} from '@/types/shippingPurchase';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import {
  AddressSuggestion,
  searchCanadianAddresses,
} from '@/services/addressAutocompleteService';

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface PlaceDetails {
  address_components: AddressComponent[];
  formatted_address?: string;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
}
type AddressOperation = ReturnType<ReturnType<typeof useLabelLifecycleContext>['capture']>;

const PLACES_STYLES = {
  container: { flex: 0 },
  textInputContainer: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  textInput: {
    height: 44,
    color: colors.foreground,
    fontSize: 16,
    fontFamily: fonts.sans,
  },
  listView: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
};


export default function AddressSettingsScreen() {
  const googlePlacesApiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string; from?: string; articleId?: string }>();
  const shippingPreparation = params.purpose === 'shipping_origin' && params.from === 'shipping-preparation' &&
    typeof params.articleId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(params.articleId);
  const user = useUser();
  const uid = useAuthenticatedUid(), context = useLabelLifecycleContext(JSON.stringify(['settings-ordinary-address', params.purpose, params.from, params.articleId]), uid);
  const contextRef = useRef(context);
  useLayoutEffect(() => {contextRef.current = context;}, [context]);
  const client = useQueryClient(), originKey = ['seller-shipping-address', uid, getAuthSessionGeneration(), context.focusRevision];
  const originQuery = useQuery({queryKey: originKey, enabled: params.purpose === 'shipping_origin' && !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async ({signal}) => {
      const op = context.capture();
      try {return await SellerShippingAddressService.read(uid!, () => {if (signal.aborted) throw new CancelledError(); context.assertCurrent(op);});}
      catch (error) {if (signal.aborted || !context.isCurrent(op)) throw new CancelledError(); throw error;}
    }});
  const originReady = context.focused && originQuery.isSuccess && originQuery.fetchStatus === 'idle' && !originQuery.isError && client.getQueryState(originKey)?.isInvalidated === false;
  const { refreshUser } = useAuthActions();
  const addressRef = useRef<GooglePlacesAutocompleteRef>(null);
  const profileAddress = params.purpose !== 'shipping_origin' && user?.id === uid ? user?.address : undefined;
  const profileLine2 = profileAddress && 'line2' in profileAddress && typeof profileAddress.line2 === 'string' ? profileAddress.line2 : '';

  // Saisie manuelle (fallback si Google Places échoue ou est indisponible)
  const [manualMode, setManualMode] = useState(Boolean(profileAddress));
  const [manualStreet, setManualStreet] = useState(profileAddress?.street ?? '');
  const [manualCity, setManualCity] = useState(profileAddress?.city ?? '');
  const [manualProvince, setManualProvince] = useState(profileAddress?.province ?? 'QC');
  const [manualPostalCode, setManualPostalCode] = useState(profileAddress?.postalCode ?? '');
  const [manualLine2, setManualLine2] = useState(profileLine2);
  const [manualName, setManualName] = useState('');
  const [addressPurpose, setAddressPurpose] = useState<'profile' | 'shipping_origin'>(() => params.purpose === 'shipping_origin' ? 'shipping_origin' : 'profile');
  const [editingOrigin, setEditingOrigin] = useState<SellerShippingAddressObservation | null>(null);
  const [addressKind, setAddressKind] = useState<OrdinaryShippingAddressKind | null>(null);
  const [addressAccepted, setAddressAccepted] = useState(false);
  const inputRevision = useRef(0), saving = useRef(false);
  useLayoutEffect(() => {inputRevision.current = 0;}, [uid]);
  const [inputInteraction] = useState(createOrdinaryAddressInteraction);
  const [inputRenderRevision, setInputRenderRevision] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [fallbackSuggestions, setFallbackSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [googleUnavailable, setGoogleUnavailable] = useState(false);
  const useGoogle = Boolean(googlePlacesApiKey) && !googleUnavailable;
  const [inputOwner, setInputOwner] = useState({uid, frame: context.frame, focus: context.focusRevision});
  if (inputOwner.uid !== uid || inputOwner.frame !== context.frame || inputOwner.focus !== context.focusRevision) {
    inputInteraction.invalidate(); setInputOwner({uid, frame: context.frame, focus: context.focusRevision});
    setAddressKind(null); setAddressAccepted(false); setIsSaving(false); setIsSearching(false); setFallbackSuggestions([]); setSearchFeedback(null);
    setEditingOrigin(null);
    if (inputOwner.uid !== uid) {setManualStreet(profileAddress?.street ?? ''); setManualCity(profileAddress?.city ?? ''); setManualProvince(profileAddress?.province ?? 'QC'); setManualPostalCode(profileAddress?.postalCode ?? ''); setManualLine2(profileLine2); setManualName(''); setSearchText(''); setFallbackSuggestions([]); setManualMode(Boolean(profileAddress));}
  }
  const inputGuard = inputInteraction.capture();
  const advanceInput = () => {inputInteraction.invalidate(); inputRevision.current++; setInputRenderRevision(n => n + 1); setIsSearching(false); setFallbackSuggestions([]); setSearchFeedback(null);};

  useEffect(() => {
    if (useGoogle || !uid || !context.focused || searchText.trim().length < 3) {
      return;
    }
    let operation: AddressOperation;
    try {inputGuard(); operation = contextRef.current.capture();} catch {return;}
    const controller = new AbortController();
    let disposed = false;
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    const current = () => {contextRef.current.assertCurrent(operation); inputGuard(); if (controller.signal.aborted) throw new Error('Recherche annulée.');};
    const timeout = setTimeout(async () => {
      try {
        current(); setIsSearching(true);
        requestTimeout = setTimeout(() => controller.abort(), 8000);
        const suggestions = await searchCanadianAddresses(searchText, controller.signal); current();
        setFallbackSuggestions(suggestions);
        setSearchFeedback(suggestions.length ? null : 'Aucune adresse trouvée. Précisez la rue et la ville ou complétez les champs ci-dessous.');
      } catch (error) {
        if (disposed) return;
        try {contextRef.current.assertCurrent(operation); inputGuard();} catch {return;}
        if ((error as Error).name !== 'AbortError' && __DEV__) {
          console.warn('Address fallback autocomplete failed:', error);
        }
        setFallbackSuggestions([]);
        setSearchFeedback('Recherche indisponible. Vous pouvez compléter l’adresse ci-dessous.');
        setManualMode(true);
      } finally {
        if (requestTimeout) clearTimeout(requestTimeout);
        if (disposed) return;
        try {contextRef.current.assertCurrent(operation); inputGuard(); setIsSearching(false);} catch { /* A stale request cannot clear a newer spinner. */ }
      }
    }, 300);

    return () => {
      disposed = true;
      clearTimeout(timeout);
      if (requestTimeout) clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [searchText, useGoogle, uid, context.frame, context.focusRevision, context.focused, inputRenderRevision]);

  const handleSearchTextChange = (value: string) => {
    try {inputGuard(); context.capture();} catch {return;}
    advanceInput(); setAddressKind(null); setAddressAccepted(false);
    setSearchText(value);
    if (value.trim().length < 3) setFallbackSuggestions([]);
  };
  const changePhysical = (apply: () => void) => {
    try {inputGuard(); context.capture();} catch {return;}
    advanceInput(); setAddressKind(null); setAddressAccepted(false); apply();
  };
  const prepareAddress = (input: CanadianAddressInput & {line2?: string}, purpose = addressPurpose) => {
    try {inputGuard(); context.capture();} catch {return;}
    advanceInput(); setAddressKind(null); setAddressAccepted(false);
    setManualStreet(input.street); setManualCity(input.city); setManualProvince(input.province);
    setManualPostalCode(input.postalCode); setManualLine2(input.line2 ?? ''); setAddressPurpose(purpose); setManualMode(true);
  };
  const originMatchesEditing = originReady && editingOrigin !== null && originQuery.data.ownerId === editingOrigin.ownerId &&
    originQuery.data.sourceHash === editingOrigin.sourceHash && originQuery.data.selectedIndex === editingOrigin.selectedIndex;
  const assertOrigin = () => {
    const state = client.getQueryState(originKey);
    if (!originMatchesEditing || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== originQuery.data || state.dataUpdatedAt !== originQuery.dataUpdatedAt) throw new Error('Relisez l’adresse d’expédition sélectionnée avant de l’enregistrer.');
  };
  const beginShippingAddress = () => {
    try {inputGuard(); context.capture(); if (!originReady || !originQuery.data.canEdit) return;
      const native = originQuery.data, physical = ordinaryPhysicalAddress(native.selected);
      if (inputRevision.current > 0) {setEditingOrigin(native); setManualName(name => name || (typeof native.selected?.name === 'string' ? native.selected.name : '')); setAddressPurpose('shipping_origin'); setManualMode(true); return;}
      setEditingOrigin(native); setManualName(typeof native.selected?.name === 'string' ? native.selected.name : '');
      prepareAddress(physical ?? {street: '', city: '', province: 'QC', postalCode: '', country: 'CA'}, 'shipping_origin');
    } catch { /* No old native source selects an address. */ }
  };
  const requestedOrigin = useRef<string | null>(null);
  useEffect(() => {
    const requestKey = JSON.stringify([uid, params.purpose, context.focusRevision]);
    if (params.purpose !== 'shipping_origin' || !originReady || requestedOrigin.current === requestKey) return;
    requestedOrigin.current = requestKey;
    beginShippingAddress();
  }, [uid, params.purpose, originReady, context.focusRevision, beginShippingAddress]);

  const persistAddress = async (
    input: CanadianAddressInput,
    meta: { mode: 'autocomplete' | 'manual'; hasGeo: boolean },
  ) => {
    if (!user || !uid || user.id !== uid || saving.current) return;
    try {inputGuard();} catch {return;}
    if (addressPurpose === 'shipping_origin' && (!addressKind || !addressAccepted)) {Alert.alert('Type d’adresse à confirmer', 'Choisissez le type ordinaire de cette adresse exacte, puis confirmez votre déclaration.'); return;}
    let operation; try {operation = context.capture();} catch {return;}
    const revision = inputRevision.current, kind = addressKind;
    const current = () => {context.assertCurrent(operation); inputGuard(); if (inputRevision.current !== revision) throw new Error('L’adresse ou sa déclaration a changé.');};
    const validation = validateCanadianAddress(input);
    if (!validation.valid) {
      setManualStreet(input.street);
      setManualCity(input.city);
      setManualProvince(input.province || 'QC');
      setManualPostalCode(input.postalCode);
      setManualMode(true);
      track('address_saved', {
        mode: meta.mode,
        province: input.province,
        success: false,
        validation_error: validation.error,
      });
      Alert.alert('Adresse à compléter', 'Vérifiez la rue, la ville, une province canadienne et le code postal avant de sauvegarder.');
      return;
    }
    const { address } = validation;
    saving.current = true; setIsSaving(true);
    try {
      const normalized = ordinaryPhysicalAddress({...address, country: 'CA', ...(manualLine2.trim() ? {line2: manualLine2.trim()} : {})});
      if (!normalized) throw new Error('Vérifiez la cohérence de la province, du code postal et de l’adresse.');
      if (addressPurpose === 'shipping_origin') {
        assertOrigin();
        if (!kind || !manualName.trim() || manualName.trim().length > 100 || normalized.province !== 'QC') throw new Error('Indiquez un nom de destinataire et une adresse de départ au Québec.');
        const shippingUseDeclaration = await ordinaryShippingAddressDeclaration(normalized, kind); current();
        const shippingAddress: ShippingPurchaseAddress = {...normalized, shippingUseDeclaration, province: 'QC', name: manualName.trim()};
        await SellerShippingAddressService.save(uid, editingOrigin!, shippingAddress, () => {current(); assertOrigin();}); current();
        const reread = await originQuery.refetch(); current();
        const selected = reread.data?.selected, expectedIndex = editingOrigin!.selectedIndex ?? 0;
        const rawDeclaration = selected?.shippingUseDeclaration;
        const d = rawDeclaration && typeof rawDeclaration === 'object' && !Array.isArray(rawDeclaration) ? rawDeclaration as Record<string, unknown> : null;
        const exactDeclaration = d !== null && Object.keys(d).length === 5 && (['schemaVersion', 'policyVersion', 'kind', 'accepted', 'addressHash'] as const).every(key => d[key] === shippingUseDeclaration[key]);
        if (reread.isError || !reread.data || reread.data.selectedIndex !== expectedIndex || selected?.name !== shippingAddress.name || !exactDeclaration ||
            JSON.stringify(ordinaryPhysicalAddress(selected)) !== JSON.stringify(normalized) || !await hasCurrentOrdinaryShippingDeclaration(selected)) throw new Error('La mise à jour et l’adresse sélectionnée doivent être rapprochées par une nouvelle lecture.'); current();
      } else {await UserService.updateUserProfile(uid, {address: normalized}); current();}

      // Rafraîchir les données utilisateur depuis Firestore
      await refreshUser();
      current();

      track('address_saved', {
        mode: meta.mode,
        province: address.province,
        has_geo: meta.hasGeo,
        success: true,
      });

      if (shippingPreparation && addressPurpose === 'shipping_origin') {
        current(); router.back(); return;
      }
      Alert.alert('Succès', addressPurpose === 'shipping_origin' ? 'Votre adresse d’expédition sélectionnée a été mise à jour. Les autres adresses sont conservées.' : 'Votre adresse de profil a été mise à jour. L’adresse d’expédition vendeur est configurée séparément.', [
        { text: 'OK', onPress: () => {try {current(); router.back();} catch { /* Old save cannot navigate a replacement session. */ }} }
      ]);
    } catch (error) {
      if (!context.isCurrent(operation) || inputRevision.current !== revision) return;
      // A failed CAS can mean another device changed the selected address.
      // Re-read it once so the member can explicitly resume with their input;
      // never repeat the write from this error path.
      if (addressPurpose === 'shipping_origin') {
        await originQuery.refetch();
        if (!context.isCurrent(operation) || inputRevision.current !== revision) return;
      }
      if (__DEV__) console.error('Error updating address:', error);
      track('address_saved', {
        mode: meta.mode,
        province: address.province,
        has_geo: meta.hasGeo,
        success: false,
      });
      Alert.alert('Adresse à vérifier', `${error instanceof Error ? error.message : 'La mise à jour doit être vérifiée.'} Relisez l’adresse enregistrée avant de renouveler une mise à jour dont la réponse est inconnue.`);
    } finally {
      saving.current = false; if (context.isCurrent(operation)) setIsSaving(false);
    }
  };

  const handleUpdateAddress = async (details: PlaceDetails | null) => {
    try {inputGuard(); context.capture();} catch {return;}
    if (!user) return;
    if (!details || !Array.isArray(details.address_components) || !details.address_components.length) {handleGoogleFailure(); return;}

    const streetNumber = details.address_components.find((c: AddressComponent) => c.types.includes('street_number'))?.long_name || '';
    const route = details.address_components.find((c: AddressComponent) => c.types.includes('route'))?.long_name || '';
    const city = details.address_components.find((c: AddressComponent) => c.types.includes('locality'))?.long_name ||
      details.address_components.find((c: AddressComponent) => c.types.includes('postal_town'))?.long_name || '';
    const province = details.address_components.find((c: AddressComponent) => c.types.includes('administrative_area_level_1'))?.short_name || '';
    const postalCode = details.address_components.find((c: AddressComponent) => c.types.includes('postal_code'))?.long_name || '';
    const country = details.address_components.find((c: AddressComponent) => c.types.includes('country'))?.short_name || '';
    const apartment = details.address_components.find((c: AddressComponent) => c.types.includes('subpremise'))?.long_name || '';

    const streetAddress = `${streetNumber} ${route}`.trim();
    if (!['ca', 'canada'].includes(country.trim().toLowerCase())) {Alert.alert('Adresse canadienne requise', 'Choisissez une adresse au Canada.'); return;}
    setSearchText(''); addressRef.current?.setAddressText('');
    prepareAddress({street: streetAddress, city, province, postalCode, country: 'CA', line2: manualLine2 || apartment});
  };

  const handleManualSave = async () => {
    if (!user || isSaving) return;

    const street = manualStreet.trim();
    const city = manualCity.trim();
    const province = manualProvince.trim();
    const postalCode = manualPostalCode.trim();

    if (!street || !city || !province || !postalCode) {
      track('address_saved', {
        mode: 'manual',
        province,
        success: false,
        validation_error: 'missing_fields',
      });
      Alert.alert('Champs manquants', 'Veuillez remplir l\'adresse, la ville, la province et le code postal.');
      return;
    }

    await persistAddress(
      { street, city, province, postalCode, country: 'Canada' },
      { mode: 'manual', hasGeo: false },
    );
  };

  const handleFallbackSuggestion = (suggestion: AddressSuggestion) => {
    try {inputGuard(); context.capture();} catch {return;}
    setSearchText('');
    setFallbackSuggestions([]);
    prepareAddress({street: suggestion.street, city: suggestion.city, province: suggestion.province, postalCode: suggestion.postalCode, country: suggestion.country, line2: manualLine2});
  };
  const handleGoogleFailure = () => {
    try {inputGuard(); context.capture();} catch {return;}
    setGoogleUnavailable(true);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Adresse" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
              <View style={styles.formSection}>
                <Text style={styles.label}>Rechercher une adresse</Text>
                <View style={styles.inputContainer}>
                  {useGoogle ? (
                    <GooglePlacesAutocomplete
                      ref={addressRef}
                      placeholder="Rechercher une adresse..."
                      onPress={(_data, details = null) => {
                        if (!details) {handleGoogleFailure(); return;}
                        void handleUpdateAddress(details as PlaceDetails);
                      }}
                      query={{
                        key: googlePlacesApiKey,
                        language: 'fr',
                        types: 'address',
                        components: 'country:ca',
                      }}
                      fetchDetails
                      GooglePlacesDetailsQuery={{fields: 'address_components'}}
                      textInputProps={{onChangeText: handleSearchTextChange, editable: !isSaving, accessibilityLabel: 'Rechercher une adresse'}}
                      onFail={handleGoogleFailure}
                      onTimeout={handleGoogleFailure}
                      onNotFound={handleGoogleFailure}
                      timeout={8000}
                      debounce={300}
                      minLength={3}
                      styles={PLACES_STYLES}
                      keyboardShouldPersistTaps="handled"
                      enablePoweredByContainer
                    />
                  ) : (
                    <View>
                      <View style={styles.fallbackInputRow}>
                        <Ionicons name="search-outline" size={20} color={colors.muted} />
                        <TextInput
                          testID="address-autocomplete-input"
                          style={styles.fallbackInput}
                          value={searchText}
                          onChangeText={handleSearchTextChange}
                          placeholder="Rechercher une adresse..."
                          placeholderTextColor={colors.muted}
                          autoCapitalize="words"
                          autoCorrect={false}
                          editable={!isSaving}
                          accessibilityLabel="Rechercher une adresse"
                        />
                      </View>
                      {isSearching && <Caption style={styles.searchStatus}>Recherche…</Caption>}
                      {fallbackSuggestions.map((suggestion) => (
                        <Pressable
                          key={suggestion.id}
                          accessibilityRole="button"
                          accessibilityLabel={suggestion.label}
                          style={styles.suggestionRow}
                          onPress={() => handleFallbackSuggestion(suggestion)}
                        >
                          <Ionicons name="location-outline" size={18} color={colors.primary} />
                          <Text style={styles.suggestionText}>{suggestion.label}</Text>
                        </Pressable>
                      ))}
                      {searchFeedback ? <Caption style={styles.searchStatus}>{searchFeedback}</Caption> : null}
                    </View>
                  )}
                </View>
              </View>

              {!manualMode ? <Pressable
                onPress={() => changePhysical(() => setManualMode(true))}
                style={({ pressed }) => [styles.manualToggle, pressed && styles.pressed]}
              >
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <Text style={styles.manualToggleText}>Saisir l&apos;adresse manuellement</Text>
              </Pressable> : null}
          {manualMode ? (
            <View style={styles.formSection}>
              <Text style={styles.label}>{addressPurpose === 'shipping_origin' ? 'Adresse de départ sélectionnée pour les expéditions' : 'Adresse du profil'}</Text>
              {addressPurpose === 'shipping_origin' ? <View style={styles.inputContainer}><Label style={styles.fieldLabel}>Nom pour l’expédition</Label><TextInput style={styles.manualInput} value={manualName} editable={!isSaving} maxLength={100} accessibilityLabel="Nom pour l’adresse de départ des expéditions" onChangeText={value => changePhysical(() => setManualName(value))}/></View> : null}

              <View style={styles.inputContainer}>
                <Label style={styles.fieldLabel}>Adresse</Label>
                <TextInput
                  style={styles.manualInput}
                  value={manualStreet}
                  onChangeText={value => changePhysical(() => setManualStreet(value))}
                  editable={!isSaving}
                  placeholder="123 rue Sainte-Catherine"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  textContentType="streetAddressLine1"
                  autoComplete="street-address"
                />
              </View>

              <View style={styles.inputContainer}>
                <Label style={styles.fieldLabel}>Appartement, bureau ou complément</Label>
                <TextInput style={styles.manualInput} value={manualLine2} editable={!isSaving} maxLength={200}
                  onChangeText={value => changePhysical(() => setManualLine2(value))} accessibilityLabel="Appartement, bureau ou complément d’adresse"
                  placeholder="Facultatif" placeholderTextColor={colors.muted} textContentType="streetAddressLine2"/>
              </View>

              <View style={styles.inputContainer}>
                <Label style={styles.fieldLabel}>Ville</Label>
                <TextInput
                  style={styles.manualInput}
                  value={manualCity}
                  onChangeText={value => changePhysical(() => setManualCity(value))}
                  editable={!isSaving}
                  placeholder="Montréal"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  textContentType="addressCity"
                  autoComplete="postal-address-locality"
                />
              </View>

              <View style={styles.manualRow}>
                <View style={[styles.inputContainer, styles.manualRowItem]}>
                  <Label style={styles.fieldLabel}>Province</Label>
                  <TextInput
                    style={styles.manualInput}
                    value={manualProvince}
                    onChangeText={(value) => changePhysical(() => setManualProvince(value.toUpperCase()))}
                    editable={!isSaving}
                    placeholder="QC"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    maxLength={2}
                    textContentType="addressState"
                    autoComplete="postal-address-region"
                  />
                </View>
                <View style={[styles.inputContainer, styles.manualRowItem]}>
                  <Label style={styles.fieldLabel}>Code postal</Label>
                  <TextInput
                    style={styles.manualInput}
                    value={manualPostalCode}
                    onChangeText={(value) => changePhysical(() => setManualPostalCode(value.toUpperCase()))}
                    editable={!isSaving}
                    placeholder="H2X 1Y4"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    textContentType="postalCode"
                    autoComplete="postal-code"
                  />
                </View>
              </View>

              {addressPurpose === 'shipping_origin' ? <><OrdinaryShippingAddressChoice kind={addressKind} accepted={addressAccepted} disabled={isSaving}
                onKind={kind => {try {inputGuard(); context.capture(); advanceInput(); setAddressKind(kind); setAddressAccepted(false);} catch { /* Inactive address choice. */ }}}
                onAccepted={() => {try {inputGuard(); context.capture(); if (addressKind) {advanceInput(); setAddressAccepted(value => !value);}} catch { /* Inactive declaration. */ }}}/>
              <Caption style={styles.infoText}>Aucun type n’est attribué aux anciennes adresses. Un changement de rue, de complément, de ville, de province ou de code postal exige une nouvelle déclaration.</Caption></> : null}

              {addressPurpose === 'shipping_origin' && originQuery.isError ? <Pressable accessibilityRole="button" style={styles.manualToggle}
                onPress={() => {try {inputGuard(); context.capture(); void originQuery.refetch();} catch { /* Old read. */ }}}>
                <Text style={styles.manualToggleText}>Réessayer de charger l’adresse</Text>
              </Pressable> : null}
              {addressPurpose === 'shipping_origin' && originReady && editingOrigin && originQuery.data.sourceHash !== editingOrigin.sourceHash ?
                <View>
                  <Caption style={styles.infoText}>L’adresse enregistrée a changé. Votre saisie est conservée.</Caption>
                  <Pressable accessibilityRole="button" style={styles.manualToggle} onPress={beginShippingAddress}>
                    <Text style={styles.manualToggleText}>Actualiser</Text>
                  </Pressable>
                </View> : null}

              <Pressable
                accessibilityRole="button"
                onPress={handleManualSave}
                disabled={isSaving || addressPurpose === 'shipping_origin' && (!addressKind || !addressAccepted || !originMatchesEditing)}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
              >
                <Text style={styles.saveButtonText}>
                  {isSaving ? 'Enregistrement...' : 'Enregistrer l\'adresse'}
                </Text>
              </Pressable>

            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  formSection: {
    gap: spacing.md,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  fallbackInputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  fallbackInput: {
    flex: 1,
    minHeight: 46,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  searchStatus: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  suggestionText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  label: {
    fontSize: 16,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  manualInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  manualRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  manualRowItem: {
    flex: 1,
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  manualToggleText: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: fonts.sansMedium,
    color: colors.white,
  },
  pressed: {opacity: 0.8},
});
