export const INTRO_SMS =
  "Hey, it's Eddie! Save this number — I'll be sending you app links to check out and review 🙂";

export function getReviewRequestSms(appName) {
  return `Hey! Please go to the app store and download "${appName}". After a few uses it will ask for a review. I need your review! Do it now! Haha, thank you!`;
}

export async function sendSms(to, body) {
  const res = await fetch('/api/twilio/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, body }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.success) {
    throw new Error(data.error || `SMS send failed (${res.status})`);
  }

  return data;
}
