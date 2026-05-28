import { describe, it, expect } from 'vitest';
import { fixStorageUrl, isStorageUrl } from './fixStorageUrl';

describe('isStorageUrl', () => {
  it('returns true for Firebase Storage URLs', () => {
    expect(isStorageUrl('https://firebasestorage.googleapis.com/v0/b/bucket/o/path')).toBe(true);
  });

  it('returns false for non-storage URLs', () => {
    expect(isStorageUrl('https://example.com/image.jpg')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isStorageUrl('')).toBe(false);
  });
});

describe('fixStorageUrl', () => {
  const BASE = 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.appspot.com';

  it('returns non-storage URLs unchanged', () => {
    const url = 'https://example.com/image.jpg';
    expect(fixStorageUrl(url)).toBe(url);
  });

  it('returns empty string unchanged', () => {
    expect(fixStorageUrl('')).toBe('');
  });

  it('returns already-encoded URLs unchanged', () => {
    const url = `${BASE}/o/articles%2Fabc123%2Fphoto.jpg?alt=media`;
    expect(fixStorageUrl(url)).toBe(url);
  });

  it('encodes un-encoded path segments', () => {
    const input = `${BASE}/o/articles/abc123/photo.jpg?alt=media`;
    const expected = `${BASE}/o/articles%2Fabc123%2Fphoto.jpg?alt=media`;
    expect(fixStorageUrl(input)).toBe(expected);
  });

  it('handles single path segment', () => {
    const input = `${BASE}/o/photo.jpg?alt=media`;
    const expected = `${BASE}/o/photo.jpg?alt=media`;
    expect(fixStorageUrl(input)).toBe(expected);
  });

  it('encodes special characters in segments', () => {
    const input = `${BASE}/o/articles/my file (1).jpg?alt=media`;
    const expected = `${BASE}/o/articles%2Fmy%20file%20(1).jpg?alt=media`;
    expect(fixStorageUrl(input)).toBe(expected);
  });

  it('handles URL without query params', () => {
    const input = `${BASE}/o/articles/photo.jpg`;
    const expected = `${BASE}/o/articles%2Fphoto.jpg`;
    expect(fixStorageUrl(input)).toBe(expected);
  });

  it('returns URL unchanged if no /o/ path match', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/bucket';
    expect(fixStorageUrl(url)).toBe(url);
  });
});
