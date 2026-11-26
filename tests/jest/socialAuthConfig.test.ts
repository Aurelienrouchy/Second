import firebaseProjects from '@/config/firebaseProjects.json';
import { resolveGoogleSignInConfiguration, socialAuthBundleId } from '@/config/socialAuthConfig';

jest.mock('@/config/firebase/development/oauth.json', () => {
  const project = require('@/config/firebaseProjects.json').development.messagingSenderId;
  return {
    googleWebClientId: `${project}-canonical-web.apps.googleusercontent.com`,
    googleIosClientId: `${project}-canonical-ios.apps.googleusercontent.com`,
  };
});

it('ships the canonical public dev OAuth IDs without depending on local env files', () => {
  const result = resolveGoogleSignInConfiguration({environment: 'development', platform: 'ios'});
  expect(result?.webClientId).toBe(`${firebaseProjects.development.messagingSenderId}-canonical-web.apps.googleusercontent.com`);
  expect(result?.iosClientId).toBe(`${firebaseProjects.development.messagingSenderId}-canonical-ios.apps.googleusercontent.com`);
  expect(result?.offlineAccess).toBe(false);
});

it('allows an explicit dev override only from the same Firebase project', () => {
  const options = {environment: 'development', platform: 'ios'} as const;
  expect(resolveGoogleSignInConfiguration({...options, webClientId: `${firebaseProjects.development.messagingSenderId}-override.apps.googleusercontent.com`})?.webClientId)
    .toContain('-override.apps.');
  expect(resolveGoogleSignInConfiguration({...options, webClientId: '628214013296-production.apps.googleusercontent.com'})).toBeNull();
  expect(resolveGoogleSignInConfiguration({...options, iosClientId: '628214013296-production.apps.googleusercontent.com'})).toBeNull();
});

it('preserves production OAuth and keeps native app identifiers distinct', () => {
  const result = resolveGoogleSignInConfiguration({environment: 'production', platform: 'ios', webClientId: 'ignored'});
  expect(result?.webClientId).toBe('628214013296-pggun4ig3j52v6r2me4k33ljsh5rc4tg.apps.googleusercontent.com');
  expect(socialAuthBundleId('development')).toBe('com.seconde.app.dev');
  expect(socialAuthBundleId('production')).toBe('com.seconde.app');
});
