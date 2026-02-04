import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

interface ProductLocationMapProps {
  sellerLocation?: {
    latitude: number;
    longitude: number;
    city?: string;
  };
  distance?: number;
  showMap?: boolean;
}

const ProductLocationMap: React.FC<ProductLocationMapProps> = ({
  sellerLocation,
  distance,
  showMap = true,
}) => {
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [calculatedDistance, setCalculatedDistance] = useState<number | null>(distance || null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!distance && sellerLocation) {
      getUserLocation();
    }
  }, [sellerLocation]);

  const getUserLocation = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setIsLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setUserLocation(location);

      if (sellerLocation) {
        const dist = calculateDistance(
          location.coords.latitude,
          location.coords.longitude,
          sellerLocation.latitude,
          sellerLocation.longitude
        );
        setCalculatedDistance(dist);
      }
    } catch (error) {
      console.error('Error getting user location:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    // Haversine formula
    const R = 6371; // Radius of the Earth in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const toRad = (value: number) => {
    return (value * Math.PI) / 180;
  };

  const openInMaps = () => {
    if (!sellerLocation) return;

    const scheme = Platform.select({
      ios: 'maps:0,0?q=',
      android: 'geo:0,0?q=',
    });
    const latLng = `${sellerLocation.latitude},${sellerLocation.longitude}`;
    const label = sellerLocation.city || 'Emplacement du vendeur';
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`,
    });

    if (url) {
      Linking.openURL(url);
    }
  };

  const getStaticMapUrl = () => {
    if (!sellerLocation) return null;
    
    // Using Google Maps Static API (you'll need to add your API key)
    // For now, we'll use a generic map placeholder
    const { latitude, longitude } = sellerLocation;
    const zoom = 13;
    const size = '400x200';
    
    // Note: Replace with your actual Google Maps API key
    // return `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=${zoom}&size=${size}&markers=color:orange%7C${latitude},${longitude}&key=YOUR_API_KEY`;
    
    // Alternative: OpenStreetMap based static map
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-s+f79f24(${longitude},${latitude})/${longitude},${latitude},${zoom}/400x200?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw`;
  };

  const formatDistance = (dist: number | null) => {
    if (dist === null) return null;
    if (dist < 1) {
      return `${Math.round(dist * 1000)} m`;
    }
    return `${dist.toFixed(1)} km`;
  };

  if (!sellerLocation) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="location" size={20} color="#F79F24" />
        <Text style={styles.sectionTitle}>Emplacement</Text>
      </View>

      {/* Distance Info */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Ionicons name="navigate-outline" size={18} color="#666" />
          <Text style={styles.infoText}>
            {isLoading ? (
              <ActivityIndicator size="small" color="#666" />
            ) : calculatedDistance !== null ? (
              `à ${formatDistance(calculatedDistance)}`
            ) : (
              'Distance non disponible'
            )}
          </Text>
        </View>
        {sellerLocation.city && (
          <View style={styles.infoItem}>
            <Ionicons name="location-outline" size={18} color="#666" />
            <Text style={styles.infoText}>{sellerLocation.city}</Text>
          </View>
        )}
      </View>

      {/* Delivery Options */}
      <View style={styles.deliveryOptions}>
        <View style={styles.deliveryOption}>
          <Ionicons name="hand-left-outline" size={20} color="#34C759" />
          <Text style={styles.deliveryText}>Remise en main propre</Text>
        </View>
        <View style={styles.deliveryOption}>
          <Ionicons name="cube-outline" size={20} color="#007AFF" />
          <Text style={styles.deliveryText}>Envoi possible</Text>
        </View>
      </View>

      {/* Static Map */}
      {showMap && (
        <Pressable style={styles.mapContainer} onPress={openInMaps}>
          <Image
            source={{ uri: getStaticMapUrl() || undefined }}
            style={styles.map}
            contentFit="cover"
          />
          <View style={styles.mapOverlay}>
            <Ionicons name="navigate-circle" size={24} color="#FFFFFF" />
            <Text style={styles.mapOverlayText}>Ouvrir dans Plans</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderTopWidth: 8,
    borderTopColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginLeft: 8,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
  deliveryOptions: {
    gap: 12,
    marginBottom: 16,
  },
  deliveryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
  },
  deliveryText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1C1C1E',
    marginLeft: 12,
  },
  mapContainer: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
    position: 'relative',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  mapOverlayText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default ProductLocationMap;

