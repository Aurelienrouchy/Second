/**
 * Profile Details Settings
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';

export default function ProfileDetailsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
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
      });

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner l\'image');
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      Alert.alert('Erreur', 'Le nom d\'affichage ne peut pas être vide');
      return;
    }

    setIsSaving(true);
    try {
      await UserService.updateUserProfile(user.id, {
        displayName: displayName.trim(),
        bio: bio.trim(),
        profileImage: profileImage || undefined,
      });

      Alert.alert('Succès', 'Votre profil a été mis à jour', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Erreur', 'Une erreur est survenue lors de la mise à jour du profil');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text variant="body" style={styles.headerButton}>Enregistrer</Text>
            )}
          </TouchableOpacity>
        ),
      }} />

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
            <TouchableOpacity onPress={pickImage} style={styles.imageContainer} activeOpacity={0.8}>
              <Image
                source={{ uri: profileImage || 'https://via.placeholder.com/120x120' }}
                style={styles.profileImage}
              />
              <View style={styles.cameraButton}>
                <Ionicons name="camera" size={20} color={colors.white} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={pickImage} activeOpacity={0.7}>
              <Text variant="body" style={styles.changePhotoText}>Changer la photo de profil</Text>
            </TouchableOpacity>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButton: {
    color: colors.primary,
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
