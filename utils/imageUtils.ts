import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Configuration par défaut pour la compression d'images
 */
const DEFAULT_COMPRESSION_CONFIG = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.8,
  compress: 1,
};

/**
 * Compresse une image pour réduire sa taille
 * @param uri URI locale de l'image à compresser
 * @param options Options de compression (optionnel)
 * @returns URI de l'image compressée
 */
export async function compressImage(
  uri: string, 
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }
): Promise<string> {
  try {
    const config = {
      ...DEFAULT_COMPRESSION_CONFIG,
      ...options,
    };

    const result = await ImageManipulator.manipulateAsync(
      uri,
      [
        {
          resize: {
            width: config.maxWidth,
            height: config.maxHeight,
          },
        },
      ],
      {
        compress: config.quality,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    console.log(`📸 Image compressed: ${uri} -> ${result.uri}`);
    return result.uri;
  } catch (error) {
    console.error('❌ Error compressing image:', error);
    // En cas d'erreur, retourner l'URI originale
    return uri;
  }
}

/**
 * Génère un blurhash pour une image
 * @param uri URI de l'image
 * @returns Le blurhash généré ou undefined en cas d'erreur
 */
export async function generateBlurhash(uri: string): Promise<string | undefined> {
  try {
    console.log(`🎨 Starting blurhash generation for: ${uri}`);

    // generateBlurhashAsync expects: (uri, numberOfComponents as {width, height} or [x, y])
    // On iOS, it requires {width, height} format for the number of components
    const blurhash = await Image.generateBlurhashAsync(uri, { width: 4, height: 3 });

    console.log(`🎨 Blurhash generated for ${uri}: ${blurhash}`);
    return blurhash ?? undefined;
  } catch (error) {
    console.error('❌ Error generating blurhash:', error);
    console.log('🔄 Continuing without blurhash...');
    return undefined;
  }
}

/**
 * Traite un lot d'images: compression + génération de blurhash
 * @param imageUris Liste des URIs d'images à traiter
 * @param compressionOptions Options de compression (optionnel)
 * @returns Liste des URIs compressées
 */
export async function processImages(
  imageUris: string[],
  compressionOptions?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }
): Promise<string[]> {
  try {
    console.log(`🔄 Processing ${imageUris.length} images...`);
    
    const processedImages = await Promise.all(
      imageUris.map(async (uri) => {
        // Compresser l'image
        const compressedUri = await compressImage(uri, compressionOptions);
        return compressedUri;
      })
    );

    console.log('✅ All images processed successfully');
    return processedImages;
  } catch (error) {
    console.error('❌ Error processing images:', error);
    throw error;
  }
}

/**
 * Traite une image complète: compression + blurhash
 * @param uri URI de l'image
 * @param compressionOptions Options de compression (optionnel)
 * @returns Objet ArticleImage avec URI compressée et blurhash
 */
export async function processImageWithBlurhash(
  uri: string,
  compressionOptions?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  }
): Promise<{ compressedUri: string; blurhash?: string }> {
  try {
    console.log(`🔄 Processing image with blurhash: ${uri}`);
    
    // Compresser l'image
    console.log(`🗜️ About to compress image: ${uri}`);
    const compressedUri = await compressImage(uri, compressionOptions);
    console.log(`✅ Image compression completed: ${compressedUri}`);
    
    // Générer le blurhash
    console.log(`🎨 About to generate blurhash for: ${compressedUri}`);
    const blurhash = await generateBlurhash(compressedUri);
    console.log(`✅ Blurhash generation completed: ${blurhash}`);
    
    console.log(`🏁 processImageWithBlurhash completed for ${uri}`);
    return {
      compressedUri,
      blurhash,
    };
  } catch (error) {
    console.error('❌ Error processing image with blurhash:', error);
    // On va continuer même si ça échoue
    console.log(`🔧 Attempting fallback for ${uri}`);
    try {
      const compressedUri = await compressImage(uri, compressionOptions);
      return {
        compressedUri,
        blurhash: undefined,
      };
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError);
      throw error;
    }
  }
}

