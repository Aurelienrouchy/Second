import {Ionicons} from '@expo/vector-icons';
import {useRouter} from 'expo-router';
import React from 'react';
import {ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {Button, Checkbox, ScreenHeader, Skeleton, Text} from '@/components/ui';
import {colors, radius, spacing, typography} from '@/constants/theme';
import {BANK_OWNERSHIP_STATEMENT} from '@/functions/src/shared/bankConsent';
import {useBankAccountsManagement} from '../hooks/useBankAccountsManagement';
import type {PaymentBankAccount, StripeAccountStatus} from '../utils/stripeRequirements';

interface Props {contextKey: string; onCompleted?: (status: StripeAccountStatus) => void}
const blockedMessages: Record<NonNullable<PaymentBankAccount['deleteBlockedReason']>, string> = {
  selected_bank: 'Ce compte reçoit actuellement vos retraits.',
  default_bank: 'Choisissez un autre compte pour vos retraits avant de le supprimer.',
  withdrawal_in_progress: 'Un retrait est en cours sur ce compte.',
  operation_in_progress: 'Une modification bancaire est en cours.',
  unavailable: 'Actualisez les comptes bancaires avant de les modifier.',
};

/** Mounted only for an existing payment account, so heavy inventory is opt-in. */
export function PaymentBankAccounts({contextKey, onCompleted}: Props) {
  const bank = useBankAccountsManagement(contextKey, onCompleted);
  const router = useRouter();
  const showMenu = (account: PaymentBankAccount) => {
    if (bank.loading || !bank.inventoryReady || bank.unresolvedRequest || bank.supportRequired || bank.bankChangesBlockedReason) return;
    const title = `${account.bankName || 'Compte bancaire'} · •••• ${account.last4}`;
    const options: Parameters<typeof Alert.alert>[2] = [];
    if ((account.isSelected || account.isDefault) && !bank.bankChangesBlockedReason) options.push({text: 'Remplacer', onPress: () => bank.open('replace', account)});
    if (account.canSelect) options.push({text: 'Utiliser pour mes retraits', onPress: () => bank.open('select_existing', account)});
    if (account.isSelected && bank.status?.bankDeclarationRequired) options.push({text: 'Confirmer le titulaire', onPress: () => bank.open('declare_current', account)});
    if (account.canDelete) options.push({text: 'Supprimer', style: 'destructive', onPress: () => bank.open('delete_existing', account)});
    options.push({text: 'Fermer', style: 'cancel'});
    Alert.alert(title, bank.bankChangesBlockedReason ? blockedMessages[bank.bankChangesBlockedReason]
      : account.deleteBlockedReason ? blockedMessages[account.deleteBlockedReason] : undefined, options);
  };
  const modalTitle = bank.conditionsVisible ? 'Conditions du compte'
    : bank.draft?.mode === 'delete_existing' ? 'Supprimer ce compte ?'
      : bank.draft?.mode === 'select_existing' ? 'Compte pour vos retraits'
        : bank.draft?.mode === 'declare_current' ? 'Titulaire du compte'
          : bank.draft?.mode === 'replace' ? 'Remplacer le compte' : 'Ajouter un compte';
  const adding = bank.draft?.mode === 'add' || bank.draft?.mode === 'replace';
  const deleting = bank.draft?.mode === 'delete_existing';
  const currentBank = bank.draft?.bank;
  return <View style={styles.section}>
    <Text style={styles.title}>Comptes bancaires</Text>
    {bank.restoreError ? <>
      <Text accessibilityRole="alert" style={styles.message}>Impossible de charger votre dernière modification.</Text>
      <Button variant="secondary" onPress={bank.restore}>Réessayer</Button>
    </> : bank.isLoading ? <Skeleton width="100%" height={spacing['3xl']} borderRadius={radius.lg} />
      : <>
        {bank.inventoryVisible ? bank.accounts.map(account => <View key={account.id} style={styles.card}>
          <View style={styles.icon}><Ionicons name="business-outline" size={24} color={colors.primary} /></View>
          <View style={styles.bankDetails}>
            <Text style={styles.bankName}>{account.bankName || 'Compte bancaire'}</Text>
            <Text style={styles.bankNumber}>•••• {account.last4}</Text>
            {account.isSelected ? <Text style={styles.selected}>Pour vos retraits</Text> : null}
            {account.status === 'verification_failed' || account.status === 'errored' ? <Text style={styles.error}>Coordonnées à corriger</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Gérer ${account.bankName || 'le compte bancaire'} finissant par ${account.last4}`}
            disabled={!bank.inventoryReady || bank.loading || !!bank.unresolvedRequest || bank.supportRequired || !!bank.bankChangesBlockedReason}
            hitSlop={spacing.sm} style={styles.menu} onPress={() => showMenu(account)}>
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.foreground} />
          </Pressable>
        </View>) : bank.isFetching ? <Skeleton width="100%" height={spacing['3xl']} borderRadius={radius.lg} /> : <View style={styles.card}>
          <View style={styles.bankDetails}>
            <Text style={styles.bankName}>{bank.status?.bankAccountLast4 ? `•••• ${bank.status.bankAccountLast4}` : 'Comptes indisponibles'}</Text>
            <Text style={styles.hint}>Impossible de charger vos comptes bancaires.</Text>
          </View>
          <Button variant="ghost" loading={bank.isFetching} onPress={bank.refresh}>Réessayer</Button>
        </View>}
        {bank.inventoryVisible && bank.isFetching ? <ActivityIndicator color={colors.primary} accessibilityLabel="Actualisation des comptes bancaires" /> : null}
        {bank.inventoryVisible && bank.accounts.length === 0 ? <Text style={styles.hint}>Ajoutez un compte bancaire pour recevoir vos retraits.</Text> : null}
        {bank.message ? <Text accessibilityRole="alert" style={styles.message}>{bank.message}</Text> : null}
        {bank.bankChangesBlockedReason ? <Text style={styles.hint}>{blockedMessages[bank.bankChangesBlockedReason]}</Text> : null}
        {bank.supportRequired ? <Button variant="secondary" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button> : null}
        {bank.unresolvedRequest ? <View style={styles.pending}>
            {!bank.message ? <Text style={styles.hint}>Une modification bancaire est en cours.</Text> : null}
            {bank.resumeNeedsAuth && bank.passwordProvider ? <TextInput accessibilityLabel="Mot de passe pour terminer la modification bancaire"
              style={styles.input} value={bank.password} onChangeText={bank.setPassword} secureTextEntry autoCapitalize="none"
              placeholder="Mot de passe" placeholderTextColor={colors.muted} editable={!bank.loading} /> : null}
            <Button variant="secondary" loading={bank.loading} disabled={!bank.readReady || bank.loading ||
              bank.resumeNeedsAuth && (!bank.canReauth || bank.passwordProvider && !bank.password)} onPress={bank.resume}>
              {bank.resumeNeedsAuth ? 'Confirmer mon identité' : 'Actualiser la modification'}</Button>
          </View>
            : !bank.supportRequired ? <Button variant="ghost" disabled={!bank.inventoryReady || bank.loading || !!bank.bankChangesBlockedReason} onPress={() => bank.open('add')}
              leftIcon={<Ionicons name="add" size={20} color={colors.primary} />}>Ajouter un compte bancaire</Button> : null}
      </>}
    <Modal visible={bank.draft !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={bank.close}>
      <View style={styles.modal}>
        <ScreenHeader title={modalTitle} onBack={bank.conditionsVisible ? bank.closeConditions : bank.close} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {bank.conditionsVisible ? <>
              <Checkbox checked={bank.accepted} onToggle={bank.toggleAcceptance} disabled={bank.loading} accessibilityLabel={BANK_OWNERSHIP_STATEMENT}>
                <Text style={styles.body}>{BANK_OWNERSHIP_STATEMENT}</Text>
              </Checkbox>
              {bank.message ? <Text accessibilityRole="alert" style={styles.error}>{bank.message}</Text> : null}
              {bank.bankChangesBlockedReason ? <Text style={styles.hint}>{blockedMessages[bank.bankChangesBlockedReason]}</Text> : null}
              <Button fullWidth loading={bank.loading} disabled={bank.loading || !bank.accepted || !bank.readReady || !!bank.bankChangesBlockedReason} onPress={bank.confirm}>Confirmer</Button>
            </> : <>
              {currentBank ? <View style={styles.card}>
                <View style={styles.bankDetails}><Text style={styles.bankName}>{currentBank.bankName || 'Compte bancaire'}</Text>
                  <Text style={styles.bankNumber}>•••• {currentBank.last4}</Text></View>
              </View> : null}
              {deleting ? <Text style={styles.body}>Ce compte sera retiré de vos comptes bancaires enregistrés.</Text>
                : adding ? <Text style={styles.hint}>Ce compte sera utilisé pour vos prochains retraits.</Text>
                  : bank.draft?.mode === 'select_existing' ? <Text style={styles.body}>Vos prochains retraits seront envoyés sur ce compte.</Text> : null}
              {bank.requiresDeclaration ? <View style={styles.field}>
                <Text style={styles.label}>Titulaire ou cotitulaire</Text>
                <TextInput accessibilityLabel="Nom du titulaire ou cotitulaire du compte bancaire" style={styles.input}
                  value={bank.holderName} onChangeText={bank.changeHolder} maxLength={200} autoCapitalize="words"
                  placeholder="Nom figurant sur le compte" placeholderTextColor={colors.muted} editable={!bank.loading} />
              </View> : null}
              {adding ? <>
                <View style={styles.field}><Text style={styles.label}>Numéro de transit</Text>
                  <TextInput accessibilityLabel="Numéro de transit bancaire, 5 chiffres" style={styles.input} value={bank.transitNumber} onChangeText={bank.changeTransit}
                    keyboardType="number-pad" maxLength={5} placeholder="12345" placeholderTextColor={colors.muted} editable={!bank.loading} /></View>
                <View style={styles.field}><Text style={styles.label}>Numéro d’institution</Text>
                  <TextInput accessibilityLabel="Numéro d’institution bancaire, 3 chiffres" style={styles.input} value={bank.institutionNumber} onChangeText={bank.changeInstitution}
                    keyboardType="number-pad" maxLength={3} placeholder="001" placeholderTextColor={colors.muted} editable={!bank.loading} /></View>
                <View style={styles.field}><Text style={styles.label}>Numéro de compte</Text>
                  <TextInput accessibilityLabel="Numéro de compte bancaire" style={styles.input} value={bank.accountNumber} onChangeText={bank.changeAccount}
                    keyboardType="number-pad" maxLength={12} placeholder="1234567" placeholderTextColor={colors.muted} editable={!bank.loading} /></View>
              </> : null}
              {bank.passwordProvider ? <View style={styles.field}><Text style={styles.label}>Confirmer votre identité</Text>
                <TextInput accessibilityLabel="Mot de passe pour confirmer mon identité avant la modification bancaire" style={styles.input}
                  value={bank.password} onChangeText={bank.setPassword} secureTextEntry autoCapitalize="none" placeholder="Mot de passe"
                  placeholderTextColor={colors.muted} editable={!bank.loading} /></View> : null}
              {bank.message ? <Text accessibilityRole="alert" style={styles.error}>{bank.message}</Text> : null}
              {bank.bankChangesBlockedReason ? <Text style={styles.hint}>{blockedMessages[bank.bankChangesBlockedReason]}</Text> : null}
              <Button fullWidth loading={bank.loading} variant={deleting ? 'danger' : 'primary'} disabled={bank.loading || !bank.readReady || !bank.canReauth || !!bank.bankChangesBlockedReason}
                onPress={bank.continue}>{deleting ? 'Supprimer ce compte' : bank.requiresDeclaration ? 'Continuer' : 'Utiliser pour mes retraits'}</Button>
              <Button variant="ghost" disabled={bank.loading} onPress={bank.close}>Annuler</Button>
            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  section: {marginTop: spacing.lg, gap: spacing.md},
  title: {...typography.h3, color: colors.foreground},
  card: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surfaceWarm, borderRadius: radius.lg},
  icon: {alignSelf: 'flex-start', paddingTop: spacing.xs},
  bankDetails: {flex: 1, gap: spacing.xs},
  bankName: {...typography.label, color: colors.foreground},
  bankNumber: {...typography.body, color: colors.foreground},
  selected: {...typography.caption, color: colors.primary},
  menu: {padding: spacing.sm},
  hint: {...typography.caption, color: colors.muted},
  message: {...typography.body, color: colors.foreground},
  error: {...typography.body, color: colors.danger},
  body: {...typography.body, color: colors.foreground},
  pending: {gap: spacing.md},
  modal: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  form: {padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl']},
  field: {gap: spacing.sm},
  label: {...typography.label, color: colors.foreground},
  input: {...typography.body, color: colors.foreground, backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border},
});
