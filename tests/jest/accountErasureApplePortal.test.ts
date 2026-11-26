import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {ModuleKind, ScriptTarget, transpileModule} from 'typescript';

const protocol = 'account_erasure_apple_web_v1', challengeId = 'synthetic-challenge-123', cap = 'c'.repeat(43);
const state = 'synthetic-state-123', nonce = 'synthetic-nonce-123';
const idToken = `${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`;
const compiled = readFileSync(join(process.cwd(), 'public/account-erasure-apple.js'), 'utf8');
const source = readFileSync(join(process.cwd(), 'scripts/account-erasure-apple.ts'), 'utf8');
const flush = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};
it('serves exactly the JavaScript generated from the checked standalone TypeScript source', () => {
  expect(compiled).toBe(transpileModule(source, {compilerOptions: {target: ScriptTarget.ES2020, module: ModuleKind.None, strict: true}}).outputText);
});
function portal({fragment = `#challengeId=${challengeId}&cap=${cap}`, origin = 'https://seconde-b47a6.firebaseapp.com', project = 'seconde-b47a6'} = {}) {
  type Event = {origin?: string; source?: unknown; data?: unknown};
  const trace: string[] = [], listeners = new Map<string, ((event?: Event) => void)[]>(), timers = new Map<number, () => void>(); let clock = 0;
  class Element {textContent = ''; hidden = false;}
  class Button extends Element {disabled = true; onClick: (() => Promise<void>) | null = null;
    addEventListener(_event: string, fn: () => Promise<void>) {this.onClick = fn;}}
  class Anchor extends Element {href = '';}
  const status = new Element(), button = new Button(), back = new Anchor();
  const apple = {auth: {init: jest.fn(), signIn: jest.fn(async () => ({authorization: {code: 'synthetic-apple-code', id_token: idToken, state}}))}};
  const scripts: {src: string; onload?: () => void}[] = [];
  const location = {origin, pathname: '/account-erasure-apple', hash: fragment, search: ''};
  const history = {replaceState: jest.fn(() => {trace.push('history'); location.hash = '';})};
  const configuration = {capability: protocol, challengeId, expiresAt: new Date(Date.now() + 240_000).toISOString(),
    apple: {clientId: 'com.seconde.app.auth', redirectURI: `${origin}/account-erasure-apple/callback`, state, nonce, usePopup: true}};
  const fetch = jest.fn(async (url: string, _options: RequestInit) => {
    trace.push(url);
    const result = url === '/__/firebase/init.json' ? {projectId: project, authDomain: `${project}.firebaseapp.com`}
      : url.endsWith('/prepareAccountErasureAppleWeb') ? {result: configuration}
        : {result: {capability: protocol, challengeId, authorizationReceived: true}};
    return {ok: true, text: async () => JSON.stringify(result)};
  });
  const persistence = {getItem: jest.fn(() => {throw new Error('Persistence forbidden');}), setItem: jest.fn(() => {throw new Error('Persistence forbidden');})};
  const popup = {};
  const window = {location, history, AppleID: apple, localStorage: persistence, sessionStorage: persistence, open: jest.fn(() => popup),
    addEventListener: (name: string, fn: (event?: Event) => void) => {listeners.set(name, [...listeners.get(name) ?? [], fn]);},
    removeEventListener: (name: string, fn: (event?: Event) => void) => {listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== fn));}};
  const document = {readyState: 'complete', getElementById: (id: string) => id === 'portal-status' ? status : id === 'portal-authorize' ? button : back,
    createElement: () => ({src: '', onload: undefined}), head: {appendChild: (script: typeof scripts[number]) => {
      scripts.push(script); void Promise.resolve().then(() => script.onload?.());
    }}};
  runInNewContext(compiled, {window, document, fetch, HTMLElement: Element, HTMLButtonElement: Button, HTMLAnchorElement: Anchor,
    URLSearchParams, URL, Date, AbortController, Promise,
    setTimeout: (fn: () => void) => {timers.set(++clock, fn); return clock;}, clearTimeout: (id: number) => {timers.delete(id);}});
  return {trace, listeners, timers, status, button, back, apple, scripts, fetch, persistence, history, location, configuration, window, popup};
}
it('removes the fragment before network/SDK work, and authorizes only after an explicit click without any Firebase session', async () => {
  const page = portal(); expect(page.location.hash).toBe(''); expect(page.trace).toEqual(['history']); await flush();
  expect(page.apple.auth.init).toHaveBeenCalledWith(expect.objectContaining({clientId: 'com.seconde.app.auth', scope: '', usePopup: true, state, nonce}));
  expect(page.scripts).toHaveLength(1); expect(page.scripts[0].src).toBe('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  expect(page.apple.auth.signIn).not.toHaveBeenCalled(); expect(page.fetch).toHaveBeenCalledTimes(2);
  await page.button.onClick?.(); await flush();
  expect(page.apple.auth.signIn).toHaveBeenCalledTimes(1); expect(page.fetch).toHaveBeenCalledTimes(3);
  const options = page.fetch.mock.calls[2][1];
  expect(JSON.parse(String(options.body))).toEqual({data: {capability: protocol, challengeId, cap, code: 'synthetic-apple-code', id_token: idToken, state}});
  expect(options).toMatchObject({credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: {'Content-Type': 'application/json'}});
  expect(page.status.textContent).toContain('Autorisation Apple reçue'); expect(page.status.textContent).toContain('ne confirme pas encore');
  expect(page.back.href).toBe('seconde://account-deletion');
  expect(page.persistence.getItem).not.toHaveBeenCalled(); expect(page.persistence.setItem).not.toHaveBeenCalled();
  await page.button.onClick?.(); expect(page.fetch).toHaveBeenCalledTimes(3);
});
it.each([
  '#challengeId=synthetic-challenge-123&cap=' + 'd'.repeat(64),
  `#challengeId=${challengeId}&cap=${cap}&uid=unexpected`,
  `#challengeId=${challengeId}&cap=${cap}&cap=${cap}`,
  '#broken',
])('rejects malformed or overly broad fragments before any network request (%s)', async fragment => {
  const page = portal({fragment}); await flush(); expect(page.location.hash).toBe(''); expect(page.fetch).not.toHaveBeenCalled(); expect(page.button.disabled).toBe(true);
});
it('rejects a foreign origin before fetching configuration', async () => {
  const page = portal({origin: 'https://foreign.example'}); await flush(); expect(page.fetch).not.toHaveBeenCalled(); expect(page.apple.auth.init).not.toHaveBeenCalled();
});
it('rejects a Dev config served on the Prod origin before loading the Apple SDK', async () => {
  const page = portal({project: 'seconde-dev'}); await flush(); expect(page.fetch).toHaveBeenCalledTimes(1); expect(page.scripts).toHaveLength(0);
});
it('does not send an Apple response whose state differs from the server challenge', async () => {
  const page = portal(); await flush(); page.apple.auth.signIn.mockResolvedValueOnce({authorization: {code: 'synthetic-code', id_token: idToken, state: 'wrong-state'}});
  await page.button.onClick?.(); expect(page.fetch).toHaveBeenCalledTimes(2); expect(page.status.textContent).toContain('reste à vérifier');
});
it('rejects an authorization if its page was closed while Apple was returning', async () => {
  const page = portal(); await flush(); let finish!: (value: unknown) => void;
  page.apple.auth.signIn.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}) as never);
  const pending = page.button.onClick?.(); for (const listener of page.listeners.get('pagehide') ?? []) listener();
  finish({authorization: {code: 'synthetic-code', id_token: idToken, state}}); await pending;
  expect(page.fetch).toHaveBeenCalledTimes(2);
});
it('does not claim authorization received after a lost server response, and never automatically retries a code', async () => {
  const page = portal(); await flush(); page.fetch.mockRejectedValueOnce(new Error('synthetic lost reply with sensitive provider data'));
  await page.button.onClick?.(); expect(page.status.textContent).toContain('reste à vérifier'); expect(page.status.textContent).not.toContain('sensitive');
  const count = page.fetch.mock.calls.length; await page.button.onClick?.(); expect(page.fetch).toHaveBeenCalledTimes(count);
});
it('accepts only the exact first-party popup callback and deduplicates it against a later SDK promise', async () => {
  const page = portal(); await flush(); let finish!: (value: unknown) => void;
  page.apple.auth.signIn.mockImplementationOnce(() => {
    page.window.open(); return new Promise(resolve => {finish = resolve;}) as never;
  });
  const originalOpen = page.window.open, pending = page.button.onClick?.();
  const dispatch = (overrides: {origin?: string; source?: unknown; data?: unknown} = {}) => {
    const event = {origin: page.location.origin, source: page.popup,
      data: {type: 'account_erasure_apple_authorization_v1', authorization: {code: 'synthetic-callback-code', id_token: idToken, state}}, ...overrides};
    for (const listener of [...page.listeners.get('message') ?? []]) listener(event);
  };
  dispatch({origin: 'https://foreign.example'}); dispatch({source: {}});
  dispatch({data: {type: 'wrong', authorization: {code: 'synthetic-callback-code', id_token: idToken, state}}});
  dispatch({data: {type: 'account_erasure_apple_authorization_v1', authorization: {code: 'synthetic-callback-code', id_token: idToken, state: 'wrong-state'}}});
  await flush(); expect(page.fetch).toHaveBeenCalledTimes(2);
  dispatch(); await pending; expect(page.fetch).toHaveBeenCalledTimes(3); expect(page.window.open).toBe(originalOpen);
  expect(JSON.parse(String(page.fetch.mock.calls[2][1].body)).data.code).toBe('synthetic-callback-code');
  finish({authorization: {code: 'synthetic-sdk-code', id_token: idToken, state}}); await flush(); dispatch();
  expect(page.fetch).toHaveBeenCalledTimes(3); expect(page.status.textContent).toContain('Autorisation Apple reçue');
});
it('does not use a callback after page closure, even when its state is correct', async () => {
  const page = portal(); await flush();
  page.apple.auth.signIn.mockImplementationOnce(() => {page.window.open(); return new Promise(() => undefined) as never;});
  const pending = page.button.onClick?.();
  const listeners = [...page.listeners.get('message') ?? []];
  for (const listener of [...page.listeners.get('pagehide') ?? []]) listener();
  for (const listener of listeners) listener({origin: page.location.origin, source: page.popup,
    data: {type: 'account_erasure_apple_authorization_v1', authorization: {code: 'synthetic-callback-code', id_token: idToken, state}}});
  await pending; expect(page.fetch).toHaveBeenCalledTimes(2);
});
it('contains no Firebase auth mint/sign-in, browser persistence or logging path', () => {
  expect(source).not.toMatch(/console\.|localStorage|sessionStorage|signInWithCustomToken|signInWithPopup|initializeAuth|SecureStore/);
});
