import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CameraType } from 'expo-camera';

/** A lens change remounts the native session, with a retry path if ready never arrives. */
export function useSellCamera(enabled: boolean) {
  const [facing, setFacing] = useState<CameraType>('back');
  const [torchActive, setTorchActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [session, setSession] = useState(0);
  const mountKey = `${facing}-${session}`;
  const currentSession = useRef(mountKey);
  useLayoutEffect(() => { currentSession.current = mountKey; }, [mountKey]);

  useEffect(() => {
    if (!enabled || ready || error) return;
    const timeout = setTimeout(() => setError(true), 8000);
    return () => clearTimeout(timeout);
  }, [enabled, session, ready, error]);

  const onReady = useCallback(() => {
    if (currentSession.current !== mountKey) return false;
    setReady(true); setError(false);
    return true;
  }, [mountKey]);
  const onMountError = useCallback(() => {
    if (currentSession.current !== mountKey) return;
    setReady(false); setError(true);
  }, [mountKey]);
  const retry = useCallback(() => {
    currentSession.current = '';
    setReady(false);
    setError(false);
    setTorchActive(false);
    setSession(current => current + 1);
  }, []);
  const flip = useCallback(() => {
    currentSession.current = '';
    setReady(false);
    setError(false);
    setTorchActive(false);
    setFacing(current => current === 'back' ? 'front' : 'back');
    setSession(current => current + 1);
  }, []);
  const toggleTorch = useCallback(() => {
    if (facing === 'back' && ready) setTorchActive(current => !current);
  }, [facing, ready]);

  return { facing, torchActive, ready, error, mountKey, onReady, onMountError, retry, flip, toggleTorch };
}
