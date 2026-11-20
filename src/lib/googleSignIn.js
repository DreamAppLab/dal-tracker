import { GoogleAuthProvider } from 'firebase/auth';

// The only account allowed into Mission Control (mirrors api/_lib/allowlist.js).
// Public value: it only pre-selects the account in Google's chooser.
export const ADMIN_GOOGLE_ACCOUNT = 'lab@dreamapplab.com';
const ADMIN_GOOGLE_DOMAIN = 'dreamapplab.com';

// Google provider for signing in to Mission Control. Without these parameters
// Google silently reuses whichever account the browser is already signed in to
// (e.g. a personal Gmail), which is never allowed here and leaves no way to pick
// another. select_account always shows the chooser; login_hint and hd point it
// at the Dream App Lab Workspace account.
export function adminGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
    login_hint: ADMIN_GOOGLE_ACCOUNT,
    hd: ADMIN_GOOGLE_DOMAIN,
  });
  return provider;
}
