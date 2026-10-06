import { describe, expect, it } from 'vitest';
import { privateImageDataUri, privateMediaPath, privateMediaUrl } from './privateMedia';

const bucket = 'demo-second.appspot.com';
const path = 'chat_images/chat-1/image.jpg';

describe('private Storage reference contract', () => {
  it('persists a tokenless canonical reference and round-trips private paths', () => {
    const url = privateMediaUrl(bucket, path);
    expect(url).toBe('https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/chat_images%2Fchat-1%2Fimage.jpg?alt=media');
    expect(new URL(url).searchParams.has('token')).toBe(false);
    expect(privateMediaPath(url, bucket)).toBe(path);
    expect(privateMediaPath(`gs://${bucket}/${path}`, bucket)).toBe(path);
  });
  it('strips legacy tokens without using the bearer URL as a renderer source', () => {
    const old = `${privateMediaUrl(bucket, path)}&token=legacy-test-value`;
    expect(privateMediaPath(old, bucket)).toBe(path);
    expect(privateMediaUrl(bucket, privateMediaPath(old, bucket)!)).not.toContain('token=');
  });
  it('rejects foreign hosts/buckets, credentials, traversal and public images', () => {
    const candidates = [
      `https://example.test/v0/b/${bucket}/o/chat_images%2Fc1%2Fx.jpg?alt=media`,
      privateMediaUrl('foreign.appspot.com', path),
      `gs://foreign.appspot.com/${path}`,
      `https://firebase.test@firebasestorage.googleapis.com/v0/b/${bucket}/o/chat_images%2Fc1%2Fx.jpg`,
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/chat_images%2F..%2Fx.jpg`,
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/articles%2Fa1%2Fx.jpg`,
      'file:///tmp/image.jpg',
    ];
    for (const input of candidates) expect(privateMediaPath(input, bucket)).toBeNull();
  });
  it('supports drafts and proofs and refuses malformed private paths', () => {
    for (const value of ['drafts/u1/d1/image.jpg', 'swaps/s1/photos/u1/image.jpg']) {
      expect(privateMediaPath(privateMediaUrl(bucket, value), bucket)).toBe(value);
    }
    expect(() => privateMediaUrl(bucket, 'swaps/s1/public/image.jpg')).toThrow();
    expect(() => privateMediaUrl(bucket, 'drafts/u1/image.jpg')).toThrow();
    expect(() => privateMediaUrl('bad/bucket', path)).toThrow();
  });
  it('uses the configured emulator endpoint only in emulator/test mode', () => {
    expect(privateMediaPath(`http://127.0.0.1:9199/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`, bucket)).toBe(path);
    expect(privateMediaPath(`http://example.test:9199/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`, bucket)).toBeNull();
  });
});

describe('image bytes for native rendering', () => {
  it('encodes all padding cases without requiring browser btoa or Node Buffer', () => {
    for (const values of [[], [255], [255, 0], [255, 0, 128], [0, 1, 2, 3, 4]]) {
      const bytes = Uint8Array.from(values);
      expect(privateImageDataUri(bytes.buffer, path)).toBe(`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`);
    }
  });
  it('keeps large image encoding correct across output chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 20000 }, (_, index) => index % 256);
    expect(privateImageDataUri(bytes.buffer, 'drafts/u1/d1/photo.png')).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });
});
