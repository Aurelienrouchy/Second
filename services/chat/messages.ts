import { randomUUID } from 'expo-crypto';
import { privateMediaUrl, PRIVATE_IMAGE_UPLOAD_METADATA } from '@/utils/privateMedia';
/**
 * Chat — Envoi de messages : texte et image.
 *
 * Éclaté depuis services/chatService.ts (1554 lignes). `ChatService`
 * reste la façade publique : les appels ChatService.x() sont inchangés.
 */

import { ref, uploadBytes } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { auth, storage } from '../../config/firebaseConfig';
import { Chat } from '../../types';
import { sendMessageWithType } from './primitives';
import { assertTradeSessionCurrent, captureTradeSession } from '../tradeOperation';

export async function sendMessage(
  chatId: string,
  senderId: string,
  receiverId: string,
  content: string,
  assertContext: () => void = () => undefined
): Promise<string> {
  return sendMessageWithType(chatId, senderId, receiverId, 'text', content, undefined, assertContext);
}


export async function sendImage(
    chatId: string,
    senderId: string,
    receiverId: string,
    imageUri: string,
    assertContext: () => void = () => undefined
  ): Promise<string> {
    try {
      const session = captureTradeSession(senderId);
      const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
      assertCurrent();
      if (!auth.currentUser || auth.currentUser.uid !== senderId) {
        throw new Error('Session invalide pour envoyer une photo');
      }
      // Compress and resize image
      const manipulatedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      assertCurrent();

      // Create thumbnail
      const thumbnail = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 200 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
      );
      assertCurrent();

      // Upload to Firebase Storage using web SDK
      const timestamp = randomUUID();
      const imageName = `chat_images/${chatId}/${senderId}/${timestamp}.jpg`;
      const thumbnailName = `chat_images/${chatId}/${senderId}/${timestamp}_thumb.jpg`;

      const imageRef = ref(storage, imageName);
      const thumbnailRef = ref(storage, thumbnailName);

      // Read files as blobs and upload using web SDK
      const [imageResponse, thumbnailResponse] = await Promise.all([
        fetch(manipulatedImage.uri),
        fetch(thumbnail.uri),
      ]);
      const [imageBlob, thumbnailBlob] = await Promise.all([
        imageResponse.blob(),
        thumbnailResponse.blob(),
      ]);
      assertCurrent();
      const [imageUpload, thumbnailUpload] = await Promise.all([
        uploadBytes(imageRef, imageBlob, PRIVATE_IMAGE_UPLOAD_METADATA),
        uploadBytes(thumbnailRef, thumbnailBlob, PRIVATE_IMAGE_UPLOAD_METADATA),
      ]);
      assertCurrent();
      const generation = imageUpload?.metadata?.generation, thumbnailGeneration = thumbnailUpload?.metadata?.generation;
      if (![generation, thumbnailGeneration].every(value => typeof value === 'string' && /^[1-9][0-9]{0,31}$/.test(value))) {
        throw new Error('Le stockage ne confirme pas la version de cette photo.');
      }

      // Persist only tokenless references; reads require participant auth.
      const imageUrl = privateMediaUrl(imageRef.bucket, imageRef.fullPath);
      const thumbnailUrl = privateMediaUrl(thumbnailRef.bucket, thumbnailRef.fullPath);

      // Send message with image metadata
      return await sendMessageWithType(
        chatId,
        senderId,
        receiverId,
        'image',
        'Photo',
        {
          image: {
            url: imageUrl,
            thumbnail: thumbnailUrl,
            generation,
            thumbnailGeneration,
            width: manipulatedImage.width,
            height: manipulatedImage.height,
          },
        },
        assertCurrent
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de l'envoi de l'image: ${message}`);
    }
  }
