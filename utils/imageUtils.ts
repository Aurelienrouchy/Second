import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';

import { boundedResize } from './imageResize';
import { getImageSize } from './imageSize';

const DEFAULT_MAX_DIMENSION = 1200;
const DEFAULT_QUALITY = 0.75;

/**
 * Prépare une image pour l'upload : HEIC→JPEG, resize en préservant le ratio, compression.
 * Point d'entrée unique — tous les écrans doivent passer par ici avant upload.
 */
export async function prepareImageForUpload(
  uri: string,
  options?: { maxDimension?: number; quality?: number }
): Promise<string> {
  const maxDim = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  try {
    const size = await getImageSize(uri);
    // A failed preparation never returns the uncompressed original.
    const result = await ImageManipulator.manipulateAsync(
      uri,
      boundedResize(size?.width ?? 0, size?.height ?? 0, maxDim),
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    // Native errors can contain absolute sandbox paths or source capabilities.
    throw new Error('Cette photo ne peut pas être préparée. Sélectionnez-la de nouveau.');
  }
}

/**
 * @deprecated Utiliser `prepareImageForUpload` à la place.
 */
async function compressImage(
  uri: string,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number }
): Promise<string> {
  return prepareImageForUpload(uri, {
    maxDimension: options?.maxWidth ?? DEFAULT_MAX_DIMENSION,
    quality: options?.quality ?? DEFAULT_QUALITY,
  });
}

/**
 * Génère un blurhash pour une image.
 */
async function generateBlurhash(uri: string): Promise<string | undefined> {
  try {
    const blurhash = await Image.generateBlurhashAsync(uri, [4, 3]);
    return blurhash ?? undefined;
  } catch {
    if (__DEV__) console.error('Error generating blurhash');
    return undefined;
  }
}

/**
 * Traite une image complète : compression + blurhash.
 */
export async function processImageWithBlurhash(
  uri: string,
  compressionOptions?: { maxWidth?: number; maxHeight?: number; quality?: number }
): Promise<{ compressedUri: string; blurhash?: string }> {
  try {
    const compressedUri = await compressImage(uri, compressionOptions);
    const blurhash = await generateBlurhash(compressedUri);
    return { compressedUri, blurhash };
  } catch (error) {
    if (__DEV__) console.error('Error processing image with blurhash');
    try {
      const compressedUri = await compressImage(uri, compressionOptions);
      return { compressedUri, blurhash: undefined };
    } catch {
      if (__DEV__) console.error('Fallback image preparation failed');
      throw error;
    }
  }
}
