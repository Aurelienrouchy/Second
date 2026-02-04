import { Shop } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

interface ShopMapProps {
  shops: Shop[];
  onShopPress: (shop: Shop) => void;
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
}

export default function ShopMap({ shops, onShopPress, initialRegion }: ShopMapProps) {
  const defaultRegion = {
    latitude: 48.8566, // Paris par défaut
    longitude: 2.3522,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion || defaultRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {shops.map((shop) => (
          <Marker
            key={shop.id}
            coordinate={{
              latitude: shop.location.latitude,
              longitude: shop.location.longitude,
            }}
            onPress={() => onShopPress(shop)}
          >
            <View style={styles.markerContainer}>
              <View style={styles.marker}>
                <Ionicons name="storefront" size={16} color="#FFFFFF" />
              </View>
              <View style={styles.markerArrow} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Info overlay */}
      <View style={styles.overlay}>
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color="#007AFF" />
          <Text style={styles.infoText}>
            {shops.length} boutique{shops.length > 1 ? 's' : ''} trouvée
            {shops.length > 1 ? 's' : ''} à proximité
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 300,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    alignItems: 'center',
  },
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F79F24',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  markerArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#F79F24',
    marginTop: -2,
  },
  overlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});

