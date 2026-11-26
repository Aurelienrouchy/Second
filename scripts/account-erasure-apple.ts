/** Standalone first-party portal. Compile with tsc (module none); no Expo or
 * Firebase SDK, persistence, analytics, custom token or session handoff. */
(() => {
  const protocol = 'account_erasure_apple_web_v1';
  type Link = {capability: typeof protocol; challengeId: string; cap: string};
  type Configuration = {capability: typeof protocol; challengeId: string; expiresAt: string;
    apple: {clientId: string; redirectURI: string; state: string; nonce: string; usePopup: true}};
  type AppleSDK = {auth: {init: (options: Configuration['apple'] & {scope: string}) => void; signIn: () => Promise<unknown>}};
  const appleWindow = window as Window & {AppleID?: AppleSDK};
  const origins = {
    'https://seconde-b47a6.firebaseapp.com': {projectId: 'seconde-b47a6', clientId: 'com.seconde.app.auth', scheme: 'seconde'},
    'https://seconde-dev.firebaseapp.com': {projectId: 'seconde-dev', clientId: 'com.seconde.app.dev.auth', scheme: 'seconde-dev'},
  };
  const location = window.location;
  // Executed synchronously before any await, network or provider SDK. Never put
  // the fragment into DOM, exceptions, storage, history state or query strings.
  let fragment = location.hash, link: Link | null = null, active = true;
  let bootstrapValid = !location.search && fragment.length <= 300 && ['/account-erasure-apple', '/account-erasure-apple.html'].includes(location.pathname);
  try {window.history.replaceState(null, '', location.pathname);} catch {bootstrapValid = false;}
  try {
    if (!bootstrapValid) throw new Error('Lien invalide.');
    const params = new URLSearchParams(fragment.slice(1));
    const challengeId = params.get('challengeId'), cap = params.get('cap');
    if (bootstrapValid && [...params.keys()].sort().join(',') === 'cap,challengeId' && challengeId &&
        /^[A-Za-z0-9_-]{16,128}$/.test(challengeId) && cap && /^[A-Za-z0-9_-]{43}$/.test(cap)) {
      link = {capability: protocol, challengeId, cap};
    }
  } catch {/* The original fragment is never surfaced. */}
  fragment = '';
  window.addEventListener('pagehide', () => {active = false; link = null;});
  const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const exact = (v: Record<string, unknown>, keys: string) => Object.keys(v).sort().join(',') === keys;
  const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
  const failure = () => new Error('Autorisation à vérifier dans Seconde.');
  function assertCurrent(expected: Link) {if (!active || link !== expected) throw failure();}
  async function readJson(url: string, data?: unknown): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {method: data ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal, headers: data ? {'Content-Type': 'application/json'} : {},
        ...(data ? {body: JSON.stringify({data})} : {})});
      const raw = await response.text(); if (!response.ok || raw.length > 16_000) throw failure();
      let value: unknown; try {value = JSON.parse(raw);} catch {throw failure();} return value;
    } catch {throw failure();} finally {clearTimeout(timer);}
  }
  function callableResult(value: unknown): unknown {
    if (!plain(value) || !exact(value, 'result')) throw failure(); return value.result;
  }
  function appleAuthorization(configuration: Configuration, reference: Link): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false, popup: Window | null = null;
      const originalOpen = window.open;
      const captureOpen: typeof window.open = (...args) => {
        const opened = originalOpen.apply(window, args); if (opened && !popup) popup = opened; return opened;
      };
      const cleanup = () => {
        clearTimeout(timer); window.removeEventListener('message', onMessage); window.removeEventListener('pagehide', onHide);
        if (window.open === captureOpen) window.open = originalOpen;
      };
      const finish = (value: unknown, failed = false) => {
        if (settled) return; settled = true; cleanup(); failed ? reject(failure()) : resolve(value);
      };
      const onHide = () => finish(null, true);
      const onMessage = (event: MessageEvent<unknown>) => {
        // The registered first-party callback can receive Apple's form_post.
        // SDK promise and callback race into this SINGLE settlement path.
        if (event.origin !== location.origin || !event.source || event.source === window ||
            popup && event.source !== popup || !plain(event.data) || !exact(event.data, 'authorization,type') ||
            event.data.type !== 'account_erasure_apple_authorization_v1' || !plain(event.data.authorization) ||
            !exact(event.data.authorization, 'code,id_token,state') || event.data.authorization.state !== configuration.apple.state) return;
        try {assertCurrent(reference);} catch {finish(null, true); return;}
        // When the SDK keeps its popup reference private, exact origin + the
        // server's unpredictable state still bind this fallback. The signed
        // Apple sub/aud/nonce must also pass the server before ANY effect.
        finish({authorization: event.data.authorization});
      };
      const timer = setTimeout(() => finish(null, true), Math.max(0, Date.parse(configuration.expiresAt) - Date.now()));
      window.addEventListener('message', onMessage); window.addEventListener('pagehide', onHide, {once: true});
      try {
        window.open = captureOpen;
        if (!appleWindow.AppleID) {finish(null, true); return;}
        // Invoke synchronously from the click; no pre-popup await loses the
        // user's browser gesture. Callback and promise can never submit twice.
        void appleWindow.AppleID.auth.signIn().then(value => finish(value), () => finish(null, true));
      } catch {finish(null, true);}
    });
  }
  const domReady = document.readyState === 'loading' ? new Promise<void>(resolve => {
    document.addEventListener('DOMContentLoaded', () => resolve(), {once: true});
  }) : Promise.resolve();
  async function run() {
    await domReady;
    const status = document.getElementById('portal-status'), button = document.getElementById('portal-authorize'), back = document.getElementById('portal-return');
    if (!(status instanceof HTMLElement) || !(button instanceof HTMLButtonElement) || !(back instanceof HTMLAnchorElement)) return;
    const message = (text: string) => {status.textContent = text;};
    try {
      if (!link || !Object.prototype.hasOwnProperty.call(origins, location.origin)) throw failure();
      const reference = link, environment = origins[location.origin as keyof typeof origins];
      back.href = `${environment.scheme}://account-deletion`; back.hidden = false;
      const init = await readJson('/__/firebase/init.json'); assertCurrent(reference);
      if (!plain(init) || init.projectId !== environment.projectId || init.authDomain !== `${environment.projectId}.firebaseapp.com`) throw failure();
      const endpoint = (name: string) => `https://northamerica-northeast1-${environment.projectId}.cloudfunctions.net/${name}`;
      const raw = callableResult(await readJson(endpoint('prepareAccountErasureAppleWeb'), reference)); assertCurrent(reference);
      if (!plain(raw) || !exact(raw, 'apple,capability,challengeId,expiresAt') || raw.capability !== protocol ||
          raw.challengeId !== reference.challengeId || typeof raw.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= Date.now() ||
          Date.parse(raw.expiresAt) > Date.now() + 360_000 || !plain(raw.apple) ||
          !exact(raw.apple, 'clientId,nonce,redirectURI,state,usePopup') || raw.apple.clientId !== environment.clientId ||
          raw.apple.redirectURI !== `${location.origin}/account-erasure-apple/callback` || !id(raw.apple.state) || !id(raw.apple.nonce) ||
          raw.apple.usePopup !== true) throw failure();
      const configuration = raw as unknown as Configuration;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(failure()), 25_000);
        const script = document.createElement('script'); script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
        script.referrerPolicy = 'no-referrer'; script.onload = () => {clearTimeout(timer); resolve();}; script.onerror = () => {clearTimeout(timer); reject(failure());};
        document.head.appendChild(script);
      });
      assertCurrent(reference); if (!appleWindow.AppleID) throw failure();
      // No name/email scope. Apple proves the linked identity; the server checks
      // signed sub/aud/nonce/birth before exchanging or revoking anything.
      appleWindow.AppleID.auth.init({...configuration.apple, scope: ''});
      let busy = false;
      message('Choisissez le même compte Apple pour autoriser cette étape de votre demande de suppression.'); button.disabled = false;
      const expiry = setTimeout(() => {button.disabled = true; link = null;
        message('Ce lien a expiré. Rouvrez cette même demande dans l’application.');}, Math.max(0, Date.parse(configuration.expiresAt) - Date.now()));
      window.addEventListener('pagehide', () => clearTimeout(expiry), {once: true});
      button.addEventListener('click', async () => {
        if (busy) return;
        try {
          assertCurrent(reference); if (Date.parse(configuration.expiresAt) <= Date.now() || !appleWindow.AppleID) throw failure();
          busy = true; button.disabled = true;
          // First async action from the click preserves the popup gesture.
          let result = await appleAuthorization(configuration, reference); assertCurrent(reference);
          if (!plain(result) || !plain(result.authorization)) throw failure();
          const authorization = result.authorization; result = null;
          if (typeof authorization.code !== 'string' || authorization.code.length < 8 || authorization.code.length > 4096 ||
              /[\r\n\0]/.test(authorization.code) || typeof authorization.id_token !== 'string' ||
              authorization.id_token.length < 32 || authorization.id_token.length > 16_000 ||
              !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization.id_token) ||
              authorization.state !== configuration.apple.state || Date.parse(configuration.expiresAt) <= Date.now()) throw failure();
          const payload = {...reference, code: authorization.code, id_token: authorization.id_token, state: authorization.state};
          // Code/JWT stay in this stack, never URL, storage or logs. There is no
          // client retry after an unknown outcome; the app observes its order.
          const done = callableResult(await readJson(endpoint('completeAccountErasureAppleWeb'), payload)); assertCurrent(reference);
          if (!plain(done) || !exact(done, 'authorizationReceived,capability,challengeId') ||
              done.capability !== protocol || done.challengeId !== reference.challengeId || done.authorizationReceived !== true) throw failure();
          clearTimeout(expiry); link = null;
          message('Autorisation Apple reçue. Revenez dans Seconde et vérifiez l’avancement de cette même demande. Cela ne confirme pas encore la fin de tous les effacements.');
        } catch {
          clearTimeout(expiry); link = null;
          message('Le résultat de l’autorisation reste à vérifier. Revenez dans Seconde et consultez cette même demande. Aucune nouvelle demande de suppression n’est créée ici.');
        }
      });
    } catch {button.disabled = true; link = null; message('Ce lien ne peut pas être vérifié. Rouvrez cette même demande depuis l’application Seconde.');}
  }
  void run();
})();
