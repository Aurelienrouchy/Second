/**
 * Geohash utility functions
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode latitude/longitude to geohash string
 */
export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision: number = 7
): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90.0;
  let latMax = 90.0;
  let lonMin = -180.0;
  let lonMax = 180.0;

  while (geohash.length < precision) {
    if (evenBit) {
      // longitude
      const mid = (lonMin + lonMax) / 2;
      if (longitude >= mid) {
        idx = (idx << 1) + 1;
        lonMin = mid;
      } else {
        idx = idx << 1;
        lonMax = mid;
      }
    } else {
      // latitude
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        idx = (idx << 1) + 1;
        latMin = mid;
      } else {
        idx = idx << 1;
        latMax = mid;
      }
    }

    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

/**
 * Get neighboring geohash cells for radius queries
 */
export function getGeohashNeighbors(geohash: string): string[] {
  // Simplified neighbor calculation - returns adjacent cells
  const neighbors: string[] = [geohash];

  // For now, return just the geohash itself
  // Full implementation would calculate all 8 surrounding cells
  return neighbors;
}
