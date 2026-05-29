/**
 * Profile Details Settings
 */

import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { updateProfile } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useUser, useAuthActions } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';

export default function ProfileDetailsScreen() {
  const router = useRouter();
  const user = useUser();
  const { refreshUser } = useAuthActions();

  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setBio(user.bio || '');
      setProfileImage(user.profileImage || null);
    }
  }, [user]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
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

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking image:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner l\'image');
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (isSaving) return;
    setIsSaving(true);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      Alert.alert('Erreur', 'Le nom d\'affichage ne peut pas être vide');
      setIsSaving(false);
      return;
    }

    // Only allow letters (unicode), spaces, hyphens, apostrophes
    const nameRegex = /^[\p{L}\s\-']+$/u;
    if (!nameRegex.test(trimmedName)) {
      Alert.alert('Erreur', 'Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes');
      setIsSaving(false);
      return;
    }
    try {
      // Upload profile image to Firebase Storage if it is a new local file
      let imageUrl = profileImage;
      if (
        profileImage &&
        profileImage.startsWith('file://') &&
        profileImage !== user.profileImage
      ) {
        imageUrl = await UserService.uploadProfileImage(user.id, profileImage);
      }

      const profileData: Record<string, unknown> = {
        displayName: displayName.trim(),
        bio: bio.trim(),
      };
      if (imageUrl != null) {
        profileData.profileImage = imageUrl;
      }

      await UserService.updateUserProfile(user.id, profileData as Partial<import('@/types').User>);

      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      }

      await refreshUser();

      queryClient.invalidateQueries({ queryKey: ['users', 'stats', user.id] });
      queryClient.invalidateQueries({ queryKey: ['users', user.id] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user.id] });

      Alert.alert('Succès', 'Votre profil a été mis à jour', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error updating profile:', error);
      const code = error != null && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;
      const message = code === 'permission-denied'
        ? 'Permission refusée. Veuillez vous reconnecter et réessayer.'
        : code === 'not-found'
          ? 'Profil introuvable. Veuillez vous reconnecter.'
          : 'Une erreur est survenue lors de la mise à jour du profil';
      Alert.alert('Erreur', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Détails du profil"
        onBack={() => router.back()}
        rightContent={
          <Pressable onPress={handleSave} disabled={isSaving}>
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
            <Pressable onPress={pickImage} style={({ pressed }) => [styles.imageContainer, pressed && { opacity: 0.8 }]}>
              <Image
                source={profileImage ? { uri: profileImage } : undefined}
                style={styles.profileImage}
              />
              <View style={styles.cameraButton}>
                <Ionicons name="camera" size={20} color={colors.white} />
              </View>
            </Pressable>
            <Pressable onPress={pickImage} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <Text variant="body" style={styles.changePhotoText}>Changer la photo de profil</Text>
            </Pressable>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Nom d'affichage</Label>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
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
                onChangeText={setBio}
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
              Un profil complet avec une photo et une bio attire plus d'acheteurs potentiels.
            </Text>
          </View>
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
