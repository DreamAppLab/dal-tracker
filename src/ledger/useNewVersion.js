// Detects that a newer build of the app was deployed while this tab stayed
// open (a single-page app keeps running the code it first loaded). Books
// writes accounting rules into the data, so an old tab must not keep
// writing with old rules: show a "Reload" banner instead.
import { useEffect, useState } from 'react';

const CHECK_MS = 5 * 60 * 1000;

/** The main bundle this page is running (e.g. /static/js/main.1a2b3c.js), or null in development. */
export function loadedMainBundle(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const s = [...doc.querySelectorAll('script[src]')].map((x) => x.getAttribute('src')).find((src) => /\/static\/js\/main\.[^/]+\.js$/.test(src || ''));
  return s ? s.replace(/^https?:\/\/[^/]+/, '') : null;
}

/** Is the deployed bundle (from asset-manifest.json) different from the loaded one? */
export function isNewer(manifest, loaded) {
  const deployed = manifest && manifest.files && manifest.files['main.js'];
  return !!(loaded && deployed && deployed !== loaded);
}

export default function useNewVersion() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const loaded = loadedMainBundle();
    if (!loaded) return undefined; // development server: nothing to compare
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('/asset-manifest.json', { cache: 'no-store' });
        if (!r.ok) return;
        if (!stop && isNewer(await r.json(), loaded)) setStale(true);
      } catch (_) { /* offline: try again later */ }
    };
    check();
    const timer = setInterval(check, CHECK_MS);
    const onFocus = () => { if (document.visibilityState !== 'hidden') check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
  return stale;
}
