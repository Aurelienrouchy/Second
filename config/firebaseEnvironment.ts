/** The emulator build must never inherit the canonical production fallback. */
export function resolveFirebaseEnvironment(options: {
  test: boolean;
  useEmulators?: string;
  emulatorHost?: string;
}) {
  const useEmulators = options.test || options.useEmulators === '1';
  return {
    useEmulators,
    emulatorHost: options.emulatorHost || '127.0.0.1',
    emulatorProjectId: 'demo-second',
  };
}
