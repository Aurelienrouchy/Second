import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, type BottomSheetBackdropProps} from '@gorhom/bottom-sheet';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import {router} from 'expo-router';
import {Button, Checkbox, Text} from '@/components/ui';
import {colors, components, spacing, typography} from '@/constants/theme';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useEligibilityOperation} from '@/hooks/useEligibility';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {EligibilityService} from '@/services/eligibilityService';
import {getAuthSessionGeneration} from '@/store/authStore';
import type {DeclareSellerActivityInput, OwnerEligibility} from '@/types/eligibility';
import {eligibilityErrorMessage} from '@/utils/eligibilityPresentation';
import {readScopedQuery} from '@/utils/readScopedQuery';

interface SwapLaunchAdmissionSheetProps {
  visible: boolean;
  onClose: () => void;
  onAllowed: () => void;
}
type Declaration = Omit<DeclareSellerActivityInput, 'requestId'>;
const DECLARATION_REASONS = new Set(['quebec_residence_declaration_required', 'activity_missing', 'activity_version_required']);
const renderBackdrop = (props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />;

/** An explicit, owner-scoped confirmation. Merely opening this sheet is read-only. */
export function SwapLaunchAdmissionSheet({visible, onClose, onAllowed}: SwapLaunchAdmissionSheetProps) {
  const uid = useAuthenticatedUid();
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheetModal>(null);
  const visibleRef = useRef(visible);
  const closing = useRef(false);
  const submitting = useRef(false);
  const [readRevision, setReadRevision] = useState(0);
  const [opening, setOpening] = useState({visible, revision: 0});
  if (opening.visible !== visible) {
    setOpening({visible, revision: opening.revision + 1});
  }
  const context = useLabelLifecycleContext(JSON.stringify(['swap-launch-confirmation', visible, opening.revision]), uid);
  const eligibility = useQuery({
    queryKey: ['swap-launch-confirmation', uid, getAuthSessionGeneration(), opening.revision, context.focusRevision, readRevision],
    enabled: visible && !!uid && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => {context.assertCurrent(operation); if (!visibleRef.current || closing.current) throw new Error('Cette fenêtre est fermée.');};
    }, async assertCurrent => {const result = await EligibilityService.getMine(uid!); assertCurrent(); return result;}),
  });
  const dto = visible && context.focused && eligibility.isSuccess && !eligibility.isFetching ? eligibility.data : null;
  const source = JSON.stringify([dto?.version, dto?.statementVersion, dto?.statements?.personal, dto?.quebecResidenceStatementVersion,
    dto?.quebecResidenceStatement, dto?.swapLaunch, opening.revision, context.focusRevision, uid, getAuthSessionGeneration()]);
  const sourceRef = useRef(source);
  useLayoutEffect(() => {sourceRef.current = source;}, [source]);
  useLayoutEffect(() => {visibleRef.current = visible; closing.current = !visible;}, [visible]);
  const [choice, setChoice] = useState({source, residence: false, personal: false});
  const [notice, setNotice] = useState({source, text: ''});
  const checked = choice.source === source ? choice : {source, residence: false, personal: false};
  const declaration = useEligibilityOperation<Declaration>(EligibilityService.declareActivity, 'declare', false, visible);
  const reasons = dto?.swapLaunch?.reasons ?? [];
  const supported = !!dto?.swapLaunch && dto.swapLaunch.allowed !== true && reasons.length > 0 && reasons.every(reason => DECLARATION_REASONS.has(reason)) &&
    dto.activityDeclaration?.kind !== 'professional' && dto.quebecResidenceStatementVersion === '2026-10-17.v1' && !!dto.quebecResidenceStatement &&
    typeof dto.statementVersion === 'string' && !!dto.statements?.personal && /^[a-f0-9]{64}$/.test(dto.version);
  const needsResidence = reasons.includes('quebec_residence_declaration_required');
  const needsPersonal = reasons.some(reason => reason === 'activity_missing' || reason === 'activity_version_required');
  const pending = declaration.pendingPayload;
  const compatiblePending = !!pending && pending.kind === 'personal' && pending.personalDeclarationAccepted === true &&
    pending.expectedUid === uid && pending.statementVersion === dto?.statementVersion &&
    (needsResidence ? pending.quebecResidenceDeclaration?.version === dto?.quebecResidenceStatementVersion && pending.quebecResidenceDeclaration?.accepted === true &&
      pending.quebecResidenceDeclaration.country === 'CA' && pending.quebecResidenceDeclaration.province === 'QC' : pending.quebecResidenceDeclaration === undefined);
  const busy = declaration.isPending;
  const ready = !!uid && supported && (!needsResidence || checked.residence) && (!needsPersonal || checked.personal) &&
    !busy && !declaration.isRestoring && !declaration.restoreError && (!declaration.hasPendingOperation || compatiblePending);

  useEffect(() => {if (visible) sheet.current?.present(); else sheet.current?.dismiss();}, [visible]);
  const close = () => {closing.current = true; onClose();};
  const navigate = (path: '/complete-profile' | '/settings/eligibility' | '/settings/account-security' | '/settings/help') => {
    try {context.capture(); if (!visibleRef.current || closing.current) return;} catch {return;}
    close(); router.push(path as never);
  };
  const refresh = () => {if (!submitting.current) setReadRevision(value => value + 1);};
  const confirm = async () => {
    if (submitting.current || !dto || !uid) return;
    if (dto.swapLaunch?.allowed !== true && !ready) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    const originalSource = source;
    const current = () => {
      context.assertCurrent(operation);
      if (!visibleRef.current || closing.current || sourceRef.current !== originalSource) throw new Error('Cette confirmation a changé.');
    };
    submitting.current = true;
    setNotice({source, text: ''});
    try {
      current();
      if (dto.swapLaunch?.allowed !== true) {
        // A previously confirmed personal activity is preserved. A missing or
        // obsolete one always requires its own, initially unchecked choice.
        const payload: Declaration = {kind: 'personal', statementVersion: dto.statementVersion, personalDeclarationAccepted: true,
          expectedUid: uid, expectedVersion: dto.version,
          ...(needsResidence ? {quebecResidenceDeclaration: {version: '2026-10-17.v1', country: 'CA', province: 'QC', accepted: true}} : {})};
        const result = await declaration.send(payload, {assertCurrent: current});
        current();
        if (!result) return;
      }
      const fresh: OwnerEligibility = await EligibilityService.getMine(uid);
      current();
      if (fresh.swapLaunch?.allowed === true) onAllowed();
      else {
        setNotice({source, text: 'Vos renseignements ont été enregistrés. Un autre élément reste à compléter.'});
        setReadRevision(value => value + 1);
      }
    } catch (error) {
      try {current();} catch {return;}
      setNotice({source, text: eligibilityErrorMessage(error)});
    } finally {submitting.current = false;}
  };
  const blockedCopy = reasons.includes('underage') ? 'Le Troc est réservé aux membres de 18 ans et plus.'
    : reasons.includes('professional_declared') ? 'Le Troc est actuellement réservé aux particuliers.'
      : reasons.includes('account_security_contained') ? 'Sécurisez votre compte pour proposer un nouveau Troc.'
        : reasons.some(reason => reason === 'age_missing' || reason === 'age_invalid') ? 'Complétez votre date de naissance pour accéder au Troc.'
          : 'Un renseignement de votre compte doit être complété avant votre premier Troc.';
  const destination = reasons.includes('account_security_contained') ? '/settings/account-security'
    : reasons.includes('age_missing') ? '/complete-profile'
      : reasons.some(reason => reason === 'account_closing' || reason === 'account_unavailable') ? '/settings/help' : '/settings/eligibility';
  if (!visible) return null;
  return <BottomSheetModal accessible={false} ref={sheet} enableDynamicSizing enablePanDownToClose topInset={insets.top}
    backdropComponent={renderBackdrop} backgroundStyle={styles.background} handleIndicatorStyle={styles.handle}
    onAnimate={(_from, to) => {if (to === -1) closing.current = true;}}
    onDismiss={() => {if (visibleRef.current) close();}}>
    <BottomSheetScrollView>
      <SafeAreaView edges={['bottom']} style={styles.content}>
        <View style={styles.header}><Text style={styles.title}>Avant votre premier Troc</Text><Button variant="ghost" size="small" onPress={close}>Fermer</Button></View>
        {!uid ? <><Text style={styles.body}>Connectez-vous pour ajouter vos pièces au Troc.</Text><Button variant="secondary" onPress={close}>Fermer</Button></>
          : !context.focused || eligibility.isPending || eligibility.isFetching ? <ActivityIndicator color={colors.primary} accessibilityLabel="Chargement du Troc" />
            : eligibility.isError ? <><Text style={styles.body}>Vos renseignements ne sont pas disponibles pour le moment.</Text><Button onPress={refresh}>Réessayer</Button></>
              : dto?.swapLaunch?.allowed === true ? <><Text style={styles.body}>Tout est prêt pour ajouter vos pièces.</Text><Button onPress={() => {void confirm();}}>Continuer</Button></>
                : supported ? <>
                  {needsResidence ? <><Text style={styles.body}>Le Troc s’ouvre d’abord aux membres du Québec.</Text>
                    <Checkbox checked={checked.residence} disabled={busy} accessibilityLabel="J’habite au Québec" onToggle={() => {if (!submitting.current) setChoice({...checked, residence: !checked.residence});}}><Text style={styles.body}>J’habite au Québec</Text></Checkbox></> : null}
                  {needsPersonal ? <Checkbox checked={checked.personal} disabled={busy} accessibilityLabel="J’échange mes affaires personnelles, sans activité professionnelle" onToggle={() => {if (!submitting.current) setChoice({...checked, personal: !checked.personal});}}><Text style={styles.body}>J’échange mes affaires personnelles, sans activité professionnelle.</Text></Checkbox> : null}
                  {declaration.restoreError ? <><Text style={styles.body}>Votre dernière confirmation ne peut pas encore être relue.</Text><Button variant="secondary" onPress={declaration.retryRestore}>Réessayer</Button></> : null}
                  {declaration.hasPendingOperation && !compatiblePending ? <><Text style={styles.body}>Une autre confirmation de votre compte est à terminer.</Text><Button variant="secondary" onPress={() => navigate('/settings/eligibility')}>Reprendre ma confirmation</Button></> : null}
                  <Button disabled={!ready} loading={busy} onPress={() => {void confirm();}}>{declaration.hasPendingOperation && compatiblePending ? 'Reprendre ma confirmation' : 'Continuer'}</Button>
                </> : <><Text style={styles.body}>{blockedCopy}</Text><Button onPress={() => navigate(destination)}>Compléter mon compte</Button></>}
        {notice.source === source && notice.text ? <Text style={styles.notice} accessibilityRole="alert">{notice.text}</Text> : null}
      </SafeAreaView>
    </BottomSheetScrollView>
  </BottomSheetModal>;
}

const styles = StyleSheet.create({
  background: {backgroundColor: colors.background, borderRadius: components.troc.sheetRadius},
  handle: {backgroundColor: colors.borderStrong},
  content: {paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.lg},
  header: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  title: {...typography.h2, color: colors.foreground, flex: 1},
  body: {...typography.body, color: colors.foreground},
  notice: {...typography.bodySmall, color: colors.muted},
});
