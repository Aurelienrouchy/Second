import firebaseProjects from './firebaseProjects.json';
import developmentOAuth from './firebase/development/oauth.json';
import type { AppEnvironment } from './firebaseEnvironment';

export interface GoogleSignInConfiguration {
  webClientId: string;
  iosClientId?: string;
  offlineAccess: false;
}

/** Public client IDs travel with the app; secrets and cross-project fallbacks never do. */
export function resolveGoogleSignInConfiguration(options: {
  environment: AppEnvironment;
  platform: string;
  webClientId?: string;
  iosClientId?: string;
}): GoogleSignInConfiguration | null {
  if (options.environment === 'production') {
    return {
      webClientId: '628214013296-pggun4ig3j52v6r2me4k33ljsh5rc4tg.apps.googleusercontent.com',
      iosClientId: '628214013296-fspuqlslcg8tln3aonhce95c435oauts.apps.googleusercontent.com',
      offlineAccess: false,
    };
  }
  const webClientId = options.webClientId || developmentOAuth.googleWebClientId;
  const iosClientId = options.iosClientId || developmentOAuth.googleIosClientId;
  const prefix = `${firebaseProjects.development.messagingSenderId}-`;
  const ownedClient = (value: string): boolean => value.startsWith(prefix) &&
    /^[0-9]+-[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(value);
  if (!ownedClient(webClientId) || (iosClientId && !ownedClient(iosClientId)) ||
    (options.platform === 'ios' && !iosClientId)) return null;
  return { webClientId, ...(iosClientId ? { iosClientId } : {}), offlineAccess: false };
}

export function socialAuthBundleId(environment: AppEnvironment): string {
  return environment === 'production' ? 'com.seconde.app' : 'com.seconde.app.dev';
}
