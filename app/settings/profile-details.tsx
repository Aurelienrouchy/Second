/**
 * Profile Details Settings
 */

import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { updateProfile } from 'firebase/auth';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';

import { auth } from '@/config/firebaseConfig';
import { useUser, useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { staleTradeOperation } from '@/services/tradeOperation';
import { track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';

export default function ProfileDetailsScreen() {
  const router = useRouter();
  const user = useUser();
  const uid = useAuthenticatedUid();
  const scope = JSON.stringify([uid, getAuthSessionGeneration(), user?.id]);
  const saveContext = useLabelLifecycleContext(`profile-details:${scope}`, uid);
  // A native picker may temporarily make AppState inactive without leaving the route.
  const pickerContext = useShippingPurchaseContext(`profile-image:${scope}`, uid);
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(user?.id === uid ? user.displayName ?? '' : '');
  const [bio, setBio] = useState(user?.id === uid ? user.bio ?? '' : '');
  const [profileImage, setProfileImage] = useState<string | null>(user?.id === uid ? user.profileImage ?? null : null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [formScope, setFormScope] = useState(scope);
  const lock = useRef<symbol | null>(null);
  const form = useRef({scope, mounted: false});
  useLayoutEffect(() => {
    form.current = {scope, mounted: true}; lock.current = null;
    return () => {if (form.current.scope === scope) form.current.mounted = false;};
  }, [scope]);
  const pickerReturns = useRef(new Set<() => void>());
  useEffect(() => {
    const pending = pickerReturns.current;
    return () => {for (const cancel of pending) cancel(); pending.clear();};
  }, []);
  if (formScope !== scope) {
    setFormScope(scope); setDisplayName(user?.id === uid ? user.displayName ?? '' : '');
    setBio(user?.id === uid ? user.bio ?? '' : ''); setProfileImage(user?.id === uid ? user.profileImage ?? null : null);
    setIsSaving(false); setIsPicking(false);
  }
  const ready = !!uid && user?.id === uid && auth.currentUser?.uid === uid && saveContext.focused;

  const pickImage = async () => {
    if (!ready || lock.current || AppState.currentState !== 'active') return;
    const owner = auth.currentUser;
    let operation: ReturnType<typeof pickerContext.capture>;
    try {operation = pickerContext.capture();} catch {return;}
    const ticket = Symbol(); lock.current = ticket; setIsPicking(true);
    const current = () => {
      pickerContext.assertCurrent(operation);
      if (!owner || auth.currentUser !== owner || owner.uid !== uid) throw staleTradeOperation();
    };
    const returned = async () => {
      current();
      if (AppState.currentState !== 'active') await new Promise<void>((resolve, reject) => {
        const cleanup = () => {subscription.remove(); pickerReturns.current.delete(cancel);};
        const cancel = () => {cleanup(); reject(staleTradeOperation());};
        const subscription = AppState.addEventListener('change', state => {if (state === 'active') {cleanup(); resolve();}});
        pickerReturns.current.add(cancel);
        if (AppState.currentState === 'active') {cleanup(); resolve();}
      });
      current();
    };
    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      await returned();
      if (status !== 'granted') {
        track('permission_denied', {
          permission: 'photos',
          context: 'profile_photo',
          can_ask_again: canAskAgain,
          action_taken: 'cancel',
        });
        Alert.alert('Permission requise', 'Nous avons besoin d\'accéder à vos photos pour modifier votre photo de profil');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        exif: false,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      await returned();

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      try {current();} catch {return;}
      if (AppState.currentState !== 'active') return;
      if (__DEV__) console.error('Error picking image:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner l\'image');
    } finally {
      if (lock.current === ticket) {
        lock.current = null;
        if (form.current.mounted && form.current.scope === scope && auth.currentUser === owner) setIsPicking(false);
      }
    }
  };

  const handleSave = async () => {
    if (!ready || !user || lock.current) return;
    const owner = auth.currentUser;
    if (!owner) return;
    let operation: ReturnType<typeof saveContext.capture>;
    try {operation = saveContext.capture();} catch {return;}
    const current = () => {
      saveContext.assertCurrent(operation);
      if (!owner || auth.currentUser !== owner || owner.uid !== uid) throw staleTradeOperation();
    };
    const ticket = Symbol(); lock.current = ticket; setIsSaving(true);

    const photoChanged = profileImage !== (user.profileImage ?? null);
    const bioLength = bio.trim().length;

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      track('profile_updated', {
        success: false,
        validation_error: 'empty_name',
        photo_changed: photoChanged,
        bio_length: bioLength,
      });
      Alert.alert('Erreur', 'Le nom d\'affichage ne peut pas être vide');
      lock.current = null;
      setIsSaving(false);
      return;
    }

    // Only allow letters (unicode), spaces, hyphens, apostrophes
    const nameRegex = /^[\p{L}\s\-']+$/u;
    if (!nameRegex.test(trimmedName)) {
      track('profile_updated', {
        success: false,
        validation_error: 'invalid_name_chars',
        photo_changed: photoChanged,
        bio_length: bioLength,
      });
      Alert.alert('Erreur', 'Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes');
      lock.current = null;
      setIsSaving(false);
      return;
    }
    try {
      current();
      // ImagePicker peut renvoyer file:// (iOS), content:// (Android) ou ph://
      // selon la plateforme. Toute URI non distante différente de l'ancienne
      // photo doit être uploadée avant d'être persistée.
      let imageUrl = profileImage;
      if (
        profileImage &&
        !/^https?:\/\//i.test(profileImage) &&
        profileImage !== user.profileImage
      ) {
        imageUrl = await UserService.uploadProfileImage(owner.uid, profileImage, current);
        current();
      }

      const profileData: Record<string, unknown> = {
        displayName: displayName.trim(),
        bio: bio.trim(),
      };
      if (imageUrl != null) {
        profileData.profileImage = imageUrl;
      }

      await UserService.updateUserProfile(owner.uid, profileData as Partial<import('@/types').User>, current);
      current();
      if (owner) {
        await updateProfile(owner, {
          displayName: displayName.trim(),
          photoURL: imageUrl || null,
        });
        current();
      }

      await useAuthStore.getState().refreshUser();
      current();

      queryClient.invalidateQueries({ queryKey: ['users', 'stats', user.id] });
      queryClient.invalidateQueries({ queryKey: ['users', user.id] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user.id] });

      track('profile_updated', {
        success: true,
        photo_changed: photoChanged,
        bio_length: bioLength,
      });

      Alert.alert('Succès', 'Votre profil a été mis à jour', [
        { text: 'OK', onPress: () => {try {current(); router.back();} catch { /* Superseded owner or route. */ }} }
      ]);
    } catch (error: unknown) {
      try {current();} catch {return;}
      if (__DEV__) console.error('Error updating profile:', error);
      const code = error != null && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;
      track('profile_updated', {
        success: false,
        error_code: code,
        photo_changed: photoChanged,
        bio_length: bioLength,
      });
      const message = code === 'permission-denied'
        ? 'Permission refusée. Veuillez vous reconnecter et réessayer.'
        : code === 'not-found'
          ? 'Profil introuvable. Veuillez vous reconnecter.'
          : 'Une erreur est survenue lors de la mise à jour du profil';
      Alert.alert('Erreur', message);
    } finally {
      if (lock.current === ticket) {
        lock.current = null;
        if (form.current.mounted && form.current.scope === scope && auth.currentUser === owner) setIsSaving(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Détails du profil"
        onBack={() => router.back()}
        rightContent={
          <Pressable onPress={handleSave} disabled={!ready || isSaving || isPicking}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text variant="body" style={styles.saveButton}>Enregistrer</Text>
            )}
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Profile Image */}
          <View style={styles.imageSection}>
            <Pressable onPress={pickImage} disabled={!ready || isSaving || isPicking} style={({ pressed }) => [styles.imageContainer, pressed && styles.pressed]}>
              <Image
                source={profileImage ? { uri: profileImage } : undefined}
                style={styles.profileImage}
              />
              <View style={styles.cameraButton}>
                <Ionicons name="camera" size={20} color={colors.white} />
              </View>
            </Pressable>
            <Pressable onPress={pickImage} disabled={!ready || isSaving || isPicking} style={({ pressed }) => pressed && styles.pressed}>
              <Text variant="body" style={styles.changePhotoText}>Changer la photo de profil</Text>
            </Pressable>
            <View style={styles.visibilityRow}>
              <Ionicons name="eye-outline" size={14} color={colors.muted} />
              <Caption style={styles.visibilityText}>
                Votre photo de profil est visible publiquement sur votre profil.
              </Caption>
            </View>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Nom d&apos;affichage</Label>
              <TextInput
                style={styles.input}
                value={displayName}
                editable={ready && !isSaving && !isPicking}
                onChangeText={value => {if (ready && !lock.current) setDisplayName(value);}}
                placeholder="Votre nom d'utilisateur"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                maxLength={50}
              />
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Bio</Label>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={bio}
                editable={ready && !isSaving && !isPicking}
                onChangeText={value => {if (ready && !lock.current) setBio(value);}}
                placeholder="Parlez-nous un peu de vous..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                maxLength={200}
              />
              <Caption style={styles.charCount}>{bio.length}/200</Caption>
            </View>
          </View>

          {/* Tips */}
          <View style={styles.tipsBox}>
            <Ionicons name="bulb-outline" size={20} color={colors.primary} />
            <Text variant="bodySmall" style={styles.tipsText}>
              Un profil complet avec une photo et une bio attire plus d&apos;acheteurs potentiels.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {opacity: 0.7},
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  saveButton: {
    color: colors.primary,
    fontSize: 16,
    fontFamily: fonts.sansMedium,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  imageSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  imageContainer: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  profileImage: {
    width: sizing.avatarXXL,
    height: sizing.avatarXXL,
    borderRadius: sizing.avatarXXL / 2,
    backgroundColor: colors.borderLight,
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  changePhotoText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  visibilityText: {
    color: colors.muted,
  },
  formSection: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  label: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    alignSelf: 'flex-end',
    color: colors.muted,
  },
  tipsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  tipsText: {
    flex: 1,
    color: colors.foreground,
  },
});
