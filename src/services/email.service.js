const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

async function sendInvitation(to, event) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITATION_FROM_EMAIL;
  if (!apiKey || !from) return { configured: false };
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${String(event.event_date).slice(0, 10)}T12:00:00Z`));
  const time = String(event.start_time || '').slice(0, 5) || 'To be announced';
  const place = event.venue_name ? `${event.venue_name}${event.venue_address ? `, ${event.venue_address}` : ''}` : 'Location to be announced';
  const name = htmlEscape(event.name);
  const pageUrl = `${process.env.APP_BASE_URL || 'http://localhost:5000'}/login?role=invitee`;
  const text = `You're invited to ${event.name} (${event.event_type}) on ${date} at ${time}. Location: ${place}. Open Gather to view the invitation and RSVP: ${pageUrl}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `You're invited: ${event.name}`, text,
      html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#14362a"><p style="color:#ee6c4d;text-transform:uppercase;letter-spacing:.15em">You're invited</p><h1>${name}</h1><p>${htmlEscape(event.event_type || 'Gathering')}</p><p><strong>When:</strong> ${htmlEscape(date)} at ${htmlEscape(time)}</p><p><strong>Where:</strong> ${htmlEscape(place)}</p><p><a href="${htmlEscape(pageUrl)}">Open Gather and RSVP</a></p></main>` })
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.message || `Email provider returned ${response.status}`);
  }
  return { configured: true, sent: true };
}

module.exports = { sendInvitation };
