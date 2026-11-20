import { apiFetch } from '../lib/apiClient';

export const INTRO_SMS =
  "Hey, it's Eddie! Save this number — I'll be sending you app links to check out and review 🙂";

export function getReviewRequestSms(appName) {
  return `Hey! Please go to the app store and download "${appName}". After a few uses it will ask for a review. I need your review! Do it now! Haha, thank you!`;
}

// Twilio requires E.164 (+15551234567). Contacts are often stored as
// "(904) 555-1212"; assume US/Canada when no country code is given.
export function toE164(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return raw;
}

export async function sendSms(to, body) {
  const res = await apiFetch('/api/twilio/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: toE164(to), body }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.success) {
    throw new Error(data.error || `SMS send failed (${res.status})`);
  }

  return data;
}
