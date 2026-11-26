import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CameraMountError, CameraType } from 'expo-camera';

type CaptureSession = { mountKey: string };

/** A lens change remounts the native session, with a retry path if ready never arrives. */
export function useSellCamera(enabled: boolean) {
  const [facing, setFacing] = useState<CameraType>('back');
  const [torchActive, setTorchActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [session, setSession] = useState(0);
  const mountKey = `${facing}-${session}`;
  const currentSession = useRef<string | null>(enabled ? mountKey : null);
  const readySession = useRef<string | null>(null);
  const captureSession = useRef<CaptureSession | null>(null);
  const active = useRef(enabled);
  const wasEnabled = useRef(enabled);
  const failed = useRef(false);

  const invalidate = useCallback(() => {
    currentSession.current = null;
    readySession.current = null;
    captureSession.current = null;
    setReady(false); setTorchActive(false); setIsCapturing(false);
  }, []);

  useLayoutEffect(() => {
    const resuming = enabled && !wasEnabled.current;
    wasEnabled.current = enabled;
    active.current = enabled;
    if (!enabled || resuming) {
      invalidate();
      if (resuming && !failed.current) setSession(current => current + 1);
    } else if (!failed.current) currentSession.current = mountKey;
    return () => {
      active.current = false;
      currentSession.current = null;
      readySession.current = null;
      captureSession.current = null;
    };
  }, [enabled, mountKey, invalidate]);

  const onMountError = useCallback((nativeError?: CameraMountError) => {
    if (!active.current || currentSession.current !== mountKey) return;
    failed.current = true;
    invalidate(); setError(true);
    if (__DEV__) console.warn('[SellCamera] Camera session failed', { facing, mountKey, message: nativeError?.message ?? 'Ready event timed out' });
  }, [facing, mountKey, invalidate]);

  useEffect(() => {
    if (!enabled || ready || error) return;
    const timeout = setTimeout(() => {
      if (readySession.current !== mountKey) onMountError();
    }, 8000);
    return () => clearTimeout(timeout);
  }, [enabled, mountKey, ready, error, onMountError]);

  const onReady = useCallback(() => {
    if (!active.current || currentSession.current !== mountKey) return false;
    readySession.current = mountKey;
    setReady(true);
    return true;
  }, [mountKey]);
  const retry = useCallback(() => {
    if (!active.current) return;
    failed.current = false;
    invalidate();
    setError(false);
    setSession(current => current + 1);
  }, [invalidate]);
  const flip = useCallback(() => {
    if (!active.current || currentSession.current !== mountKey || captureSession.current) return;
    invalidate();
    setFacing(current => current === 'back' ? 'front' : 'back');
    setSession(current => current + 1);
  }, [mountKey, invalidate]);
  const toggleTorch = useCallback(() => {
    if (active.current && currentSession.current === mountKey && readySession.current === mountKey && !captureSession.current && facing === 'back') setTorchActive(current => !current);
  }, [facing, mountKey]);

  const beginCapture = useCallback((): CaptureSession | null => {
    if (!active.current || currentSession.current !== mountKey || readySession.current !== mountKey || captureSession.current) return null;
    const capture = { mountKey };
    captureSession.current = capture;
    setIsCapturing(true);
    return capture;
  }, [mountKey]);
  const isCaptureCurrent = useCallback((capture: CaptureSession) => active.current && captureSession.current === capture &&
    currentSession.current === capture.mountKey && readySession.current === capture.mountKey, []);
  const finishCapture = useCallback((capture: CaptureSession) => {
    if (captureSession.current !== capture) return;
    captureSession.current = null;
    setIsCapturing(false);
  }, []);

  return { facing, torchActive: enabled && ready && !error && torchActive, ready: enabled && ready && !error,
    error, mountKey, isCapturing, flipAvailable: enabled && !error && !isCapturing,
    torchAvailable: enabled && facing === 'back' && ready && !error && !isCapturing,
    onReady, onMountError, retry, flip, toggleTorch, beginCapture, isCaptureCurrent, finishCapture };
}
