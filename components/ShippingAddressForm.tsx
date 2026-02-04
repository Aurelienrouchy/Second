import React, { useRef, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';

import { ShippingAddress } from '@/types';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

interface ShippingAddressFormProps {
  onAddressChange: (address: ShippingAddress | null) => void;
  initialAddress?: ShippingAddress;
}

const ShippingAddressForm: React.FC<ShippingAddressFormProps> = ({
  onAddressChange,
  initialAddress,
}) => {
  const googlePlacesRef = useRef<GooglePlacesAutocompleteRef>(null);

  const [name, setName] = useState(initialAddress?.name || '');
  const [street, setStreet] = useState(initialAddress?.street || '');
  const [city, setCity] = useState(initialAddress?.city || '');
  const [postalCode, setPostalCode] = useState(initialAddress?.postalCode || '');
  const [country, setCountry] = useState(initialAddress?.country || 'CA');
  const [phoneNumber, setPhoneNumber] = useState(initialAddress?.phoneNumber || '');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateAndNotify = (values: {
    name: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phoneNumber: string;
  }) => {
    const allErrors: { [key: string]: string | null } = {
      name: !values.name.trim() ? 'Le nom est requis' : null,
      street: !values.street.trim() ? 'L\'adresse est requise' : null,
      city: !values.city.trim() ? 'La ville est requise' : null,
      postalCode: !values.postalCode.trim() ? 'Le code postal est requis' : null,
      country: !values.country.trim() ? 'Le pays est requis' : null,
    };

    const hasErrors = Object.values(allErrors).some(err => err !== null);

    if (!hasErrors) {
      onAddressChange({
        name: values.name,
        street: values.street,
        city: values.city,
        postalCode: values.postalCode,
        country: values.country,
        phoneNumber: values.phoneNumber || undefined,
      });
    } else {
      onAddressChange(null);
    }
  };

  const handlePlaceSelect = (data: any, details: any) => {
    if (!details?.address_components) return;

    // Close dropdown and clear input
    setIsDropdownOpen(false);
    Keyboard.dismiss();
    googlePlacesRef.current?.setAddressText('');
    googlePlacesRef.current?.blur();

    const getComponent = (type: string) =>
      details.address_components.find((c: any) => c.types.includes(type))?.long_name || '';
    const getShortComponent = (type: string) =>
      details.address_components.find((c: any) => c.types.includes(type))?.short_name || '';

    const streetNumber = getComponent('street_number');
    const route = getComponent('route');
    const newCity = getComponent('locality') || getComponent('sublocality') || getComponent('administrative_area_level_2');
    const newPostalCode = getComponent('postal_code');
    const newCountry = getShortComponent('country') || 'CA';
    const newStreet = `${streetNumber} ${route}`.trim();

    setStreet(newStreet);
    setCity(newCity);
    setPostalCode(newPostalCode);
    setCountry(newCountry);

    setErrors({});

    validateAndNotify({
      name,
      street: newStreet,
      city: newCity,
      postalCode: newPostalCode,
      country: newCountry,
      phoneNumber,
    });
  };

  const handleFieldChange = (field: string, value: string) => {
    const newValues = { name, street, city, postalCode, country, phoneNumber };

    switch (field) {
      case 'name': setName(value); newValues.name = value; break;
      case 'street': setStreet(value); newValues.street = value; break;
      case 'city': setCity(value); newValues.city = value; break;
      case 'postalCode': setPostalCode(value); newValues.postalCode = value; break;
      case 'country': setCountry(value); newValues.country = value; break;
      case 'phoneNumber': setPhoneNumber(value); newValues.phoneNumber = value; break;
    }

    validateAndNotify(newValues);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Adresse de livraison</Text>

      {/* Name */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>
          Nom complet <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.name && styles.inputError]}
          placeholder="Jean Dupont"
          value={name}
          onChangeText={(value) => handleFieldChange('name', value)}
          autoCapitalize="words"
        />
      </View>

      {/* Google Places Search */}
      <View style={styles.googlePlacesWrapper}>
        <Text style={styles.label}>
          Rechercher une adresse <Text style={styles.required}>*</Text>
        </Text>
        <GooglePlacesAutocomplete
          ref={googlePlacesRef}
          placeholder="Tapez pour rechercher..."
          onPress={handlePlaceSelect}
          query={{
            key: GOOGLE_PLACES_API_KEY,
            language: 'fr',
            types: 'address',
          }}
          fetchDetails={true}
          listViewDisplayed={isDropdownOpen}
          keepResultsAfterBlur={false}
          styles={{
            textInputContainer: styles.googleInputContainer,
            textInput: styles.googleInput,
            listView: styles.googleListView,
            row: styles.googleRow,
            description: styles.googleDescription,
          }}
          enablePoweredByContainer={false}
          textInputProps={{
            placeholderTextColor: '#8E8E93',
            onFocus: () => setIsDropdownOpen(true),
            onBlur: () => {
              // Delay to allow onPress to fire before closing
              setTimeout(() => setIsDropdownOpen(false), 200);
            },
          }}
        />
      </View>

      {/* Street - auto-filled */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>
          Adresse <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.street && styles.inputError]}
          placeholder="15 rue de la Paix"
          value={street}
          onChangeText={(value) => handleFieldChange('street', value)}
        />
      </View>

      {/* City and Postal Code */}
      <View style={styles.rowContainer}>
        <View style={[styles.inputContainer, styles.halfWidth]}>
          <Text style={styles.label}>
            Code postal <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, errors.postalCode && styles.inputError]}
            placeholder="H3Z 2Y7"
            value={postalCode}
            onChangeText={(value) => handleFieldChange('postalCode', value)}
            autoCapitalize="characters"
          />
        </View>

        <View style={[styles.inputContainer, styles.halfWidth]}>
          <Text style={styles.label}>
            Ville <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, errors.city && styles.inputError]}
            placeholder="Montréal"
            value={city}
            onChangeText={(value) => handleFieldChange('city', value)}
          />
        </View>
      </View>

      {/* Country */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>
          Pays <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.country && styles.inputError]}
          placeholder="CA"
          value={country}
          onChangeText={(value) => handleFieldChange('country', value.toUpperCase())}
          autoCapitalize="characters"
          maxLength={2}
        />
        <Text style={styles.hint}>Code pays à 2 lettres (ex: CA, US, FR)</Text>
      </View>

      {/* Phone Number */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>
          Téléphone <Text style={styles.optional}>(optionnel)</Text>
        </Text>
        <TextInput
          style={styles.input}
          placeholder="+1 514 123 4567"
          value={phoneNumber}
          onChangeText={(value) => handleFieldChange('phoneNumber', value)}
          keyboardType="phone-pad"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  googlePlacesWrapper: {
    marginBottom: 16,
    zIndex: 1000,
  },
  rowContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 6,
  },
  required: {
    color: '#FF3B30',
  },
  optional: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
  },
  input: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  hint: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
  },
  googleInputContainer: {
    backgroundColor: 'transparent',
  },
  googleInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#1C1C1E',
    height: 48,
  },
  googleListView: {
    backgroundColor: 'white',
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  googleRow: {
    padding: 14,
  },
  googleDescription: {
    fontSize: 14,
    color: '#1C1C1E',
  },
});

export default ShippingAddressForm;
