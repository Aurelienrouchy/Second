/**
 * `prepareImageForUpload` — le point d'entrée unique de compression.
 * Vit dans tests/jest/ : Jest le ramasse, Vitest l'ignore.
 */
const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...a: unknown[]) => mockManipulate(...a),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));
jest.mock('expo-image', () => ({ Image: { generateBlurhashAsync: jest.fn() } }));
const mockSize = jest.fn();
jest.mock('@/utils/imageSize', () => ({ getImageSize: (...a: unknown[]) => mockSize(...a) }));

import { Image } from 'expo-image';
import { prepareImageForUpload, processImageWithBlurhash } from '@/utils/imageUtils';

beforeEach(() => {
  mockManipulate.mockReset();
  mockSize.mockReset();
  mockManipulate.mockResolvedValue({ uri: 'file:///out.jpg' });
  (Image.generateBlurhashAsync as jest.Mock).mockReset().mockResolvedValue('synthetic-blurhash');
});

describe('prepareImageForUpload', () => {
  it('lève si la compression échoue, au lieu de renvoyer l’original brut', async () => {
    // L'original partait tel quel : pleine résolution, géolocalisation EXIF
    // conservée, HEIC nommé .jpg.
    mockSize.mockResolvedValue({ width: 4032, height: 3024 });
    mockManipulate.mockRejectedValue(new Error('decode failed'));
    await expect(prepareImageForUpload('file:///in.heic')).rejects.toThrow();
  });

  it('borne une photo portrait par sa hauteur', async () => {
    mockSize.mockResolvedValue({ width: 3024, height: 4032 });
    await prepareImageForUpload('file:///in.jpg');
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { height: 1200 } }]);
  });

  it('n’agrandit pas une petite photo', async () => {
    mockSize.mockResolvedValue({ width: 640, height: 480 });
    await prepareImageForUpload('file:///in.jpg');
    expect(mockManipulate.mock.calls[0][1]).toEqual([]);
  });

  it('passe le couple entier natif du SDK56 et le JPEG préparé au calcul du blurhash', async () => {
    mockSize.mockResolvedValue({ width: 4032, height: 3024 });
    await expect(processImageWithBlurhash('file:///in.heic')).resolves.toEqual({
      compressedUri: 'file:///out.jpg', blurhash: 'synthetic-blurhash',
    });
    expect(Image.generateBlurhashAsync).toHaveBeenCalledWith('file:///out.jpg', [4, 3]);
    expect(mockManipulate).toHaveBeenCalledWith('file:///in.heic', [{ resize: { width: 1200 } }], { compress: 0.75, format: 'jpeg' });
  });

  it.each(['dimensions', 'compression'] as const)('ne propage aucun chemin natif ou jeton lorsque la préparation échoue (%s)', async step => {
    const secretUri = 'file:///private/mobile/Containers/synthetic-photo.heic?token=synthetic-private-token';
    const nativeError = new Error(`Native decoding failed at ${secretUri}`);
    mockSize.mockResolvedValue({ width: 4032, height: 3024 });
    if (step === 'dimensions') mockSize.mockRejectedValue(nativeError);
    else mockManipulate.mockRejectedValue(nativeError);
    const caught = await prepareImageForUpload(secretUri).then(() => null, (error: unknown) => error);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message.length).toBeGreaterThan(0);
    expect((caught as Error).message).not.toMatch(/file:\/\/|\/private\/|synthetic-photo|synthetic-private-token/);
    expect(Image.generateBlurhashAsync).not.toHaveBeenCalled();
  });

  it('garde un JPEG préparé sans blurhash et ne journalise pas l’URI contenue dans une erreur native', async () => {
    mockSize.mockResolvedValue({ width: 640, height: 480 });
    (Image.generateBlurhashAsync as jest.Mock).mockRejectedValue(new Error('decode file:///private/synthetic-photo.jpg?token=synthetic-private-token'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(processImageWithBlurhash('file:///in.heic')).resolves.toEqual({ compressedUri: 'file:///out.jpg', blurhash: undefined });
      const diagnostic = log.mock.calls.flat().map(value => value instanceof Error ? value.message : String(value)).join('\n');
      expect(diagnostic).not.toMatch(/file:\/\/|\/private\/|synthetic-photo|synthetic-private-token/);
      expect(mockManipulate).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
});
