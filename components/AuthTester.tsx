import { useAuth } from '@/contexts/AuthContext';
import { AuthTestSuite } from '@/scripts/test-auth-methods';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * Composant de test pour l'authentification Firebase
 * Utilise ce composant pour tester toutes les méthodes d'authentification
 */
export const AuthTester = () => {
  const { user, signOut } = useAuth();
  const [email, setEmail] = useState('test@example.com');
  const [password, setPassword] = useState('password123');
  const [username, setUsername] = useState('Test User');
  const [loading, setLoading] = useState(false);

  const showResult = (title: string, result: any) => {
    if (result.success) {
      Alert.alert(
        `✅ ${title} - Succès`,
        result.user ? `Utilisateur: ${result.user.displayName}` : 'Opération réussie'
      );
    } else {
      Alert.alert(`❌ ${title} - Erreur`, result.error);
    }
  };

  const testEmailAuth = async () => {
    setLoading(true);
    try {
      const result = await AuthTestSuite.testEmailAuth(email, password, username);
      showResult('Authentification Email', result);
    } catch (error: any) {
      Alert.alert('Erreur', error.message);
    } finally {
      setLoading(false);
    }
  };

  const testGoogleAuth = async () => {
    setLoading(true);
    try {
      const result = await AuthTestSuite.testGoogleAuth();
      showResult('Authentification Google', result);
    } catch (error: any) {
      Alert.alert('Erreur', error.message);
    } finally {
      setLoading(false);
    }
  };

  const testFacebookAuth = async () => {
    setLoading(true);
    try {
      const result = await AuthTestSuite.testFacebookAuth();
      showResult('Authentification Facebook', result);
    } catch (error: any) {
      Alert.alert('Erreur', error.message);
    } finally {
      setLoading(false);
    }
  };

  const testSignOut = async () => {
    setLoading(true);
    try {
      const result = await AuthTestSuite.testSignOut();
      showResult('Déconnexion', result);
    } catch (error: any) {
      Alert.alert('Erreur', error.message);
    } finally {
      setLoading(false);
    }
  };

  const runFullTest = async () => {
    setLoading(true);
    try {
      const results = await AuthTestSuite.runFullTestSuite();
      Alert.alert(
        '📊 Tests complets',
        `Configuration: ${results.config.emailPassword === 'Ready' ? '✅' : '❌'}\\nUtilisateur actuel: ${results.currentUser.success ? '✅' : '❌'}`
      );
    } catch (error: any) {
      Alert.alert('Erreur', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🔥 Test d'Authentification Firebase</Text>
      
      {/* État actuel */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>État Actuel</Text>
        <Text style={styles.info}>
          Utilisateur: {user ? `${user.displayName} (${user.email})` : 'Non connecté'}
        </Text>
      </View>

      {/* Test Email/Password */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Email/Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="Nom d'utilisateur"
          value={username}
          onChangeText={setUsername}
        />
        <TouchableOpacity
          style={[styles.button, styles.emailButton]}
          onPress={testEmailAuth}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Test en cours...' : 'Test Email/Password'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Test Google */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Google Sign-In</Text>
        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={testGoogleAuth}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Test en cours...' : 'Test Google Auth'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Test Facebook */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Facebook Login</Text>
        <TouchableOpacity
          style={[styles.button, styles.facebookButton]}
          onPress={testFacebookAuth}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Test en cours...' : 'Test Facebook Auth'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <TouchableOpacity
          style={[styles.button, styles.signOutButton]}
          onPress={testSignOut}
          disabled={loading || !user}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Déconnexion...' : 'Test Déconnexion'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.fullTestButton]}
          onPress={runFullTest}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Tests en cours...' : 'Suite Complète de Tests'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        💡 Ce composant est uniquement pour les tests de développement.
        Supprimez-le avant la production.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  section: {
    backgroundColor: 'white',
    padding: 15,
    marginVertical: 8,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  info: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginVertical: 5,
    borderRadius: 8,
    fontSize: 16,
  },
  button: {
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emailButton: {
    backgroundColor: '#4CAF50',
  },
  googleButton: {
    backgroundColor: '#db4437',
  },
  facebookButton: {
    backgroundColor: '#3b5998',
  },
  signOutButton: {
    backgroundColor: '#ff6b6b',
  },
  fullTestButton: {
    backgroundColor: '#6c5ce7',
  },
  note: {
    textAlign: 'center',
    fontStyle: 'italic',
    color: '#666',
    marginTop: 20,
    fontSize: 12,
  },
});