module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'MAILGUN_API_KEY not configured' });
  }

  try {
    const when = new Date().toLocaleString();
    const formData = new FormData();
    formData.append('from', 'Dream App Lab <lab@inbound.dreamapplab.com>');
    formData.append('to', 'eddieskehan@gmail.com');
    formData.append('subject', `Mission Control Login — ${when}`);
    formData.append(
      'html',
      `<p>Mission Control was accessed at ${when}.</p>` +
        `<p>If this was not you, change your password immediately at ` +
        `<a href="https://dal-tracker.vercel.app">dal-tracker.vercel.app</a></p>`
    );
    formData.append('h:Reply-To', 'lab@dreamapplab.com');

    const response = await fetch(
      'https://api.mailgun.net/v3/inbound.dreamapplab.com/messages',
      {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res
        .status(response.status)
        .json({ error: text || 'Mailgun send failed', success: false });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message, success: false });
  }
};
