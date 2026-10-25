// Builds the isolated test-data pool for one run through the real API (so every record obeys real business rules).
// Accounts use the reserved domain loadtest.gather.test and never collide with real users.
'use strict';
const { createRng } = require('../shared/prng');

const DOMAIN = 'loadtest.gather.test';
const CATEGORIES = ['Catering', 'Decoration', 'Photography', 'Music', 'Event Management'];
const TYPES = ['SERVICE', 'PRODUCT', 'PACKAGE'];
const email = (prefix, n) => `lt-${prefix}-${String(n).padStart(4, '0')}@${DOMAIN}`;

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await fn(items[i], i); }
  }));
  return results;
}

function client(baseUrl) {
  return async function api(method, url, body, token) {
    const response = await fetch(baseUrl + url, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
}

// plan: { hosts, vendors, invitees } account counts; config.data.eventsPerHost; returns the data file contents.
async function seedData({ baseUrl, password, seed, plan, eventsPerHost, onLog }) {
  const api = client(baseUrl);
  const rng = createRng(seed, 'seed-data');
  const log = message => onLog && onLog(message);
  const stats = { accounts: 0, venues: 0, offerings: 0, events: 0, bookings: 0, invitations: 0, expenses: 0, rsvps: 0 };

  async function account(prefix, n, role) {
    const address = email(prefix, n);
    let result = await api('POST', '/api/auth/register', { name: `LT ${prefix} ${n}`, email: address, password, role, age: 30 });
    if (result.status === 409) result = await api('POST', '/api/auth/login', { email: address, password });
    if (!result.body.token) throw new Error(`Could not create or log in ${address}: ${result.status} ${JSON.stringify(result.body)}`);
    stats.accounts += 1;
    return { email: address, token: result.body.token, id: result.body.user.user_id };
  }

  log(`Creating ${plan.vendors} vendor, ${plan.hosts} host and ${plan.invitees} invitee accounts...`);
  const vendors = await pool(Array.from({ length: plan.vendors }, (_, i) => i + 1), 6, n => account('vendor', n, 'VENDOR'));
  const hosts = await pool(Array.from({ length: plan.hosts }, (_, i) => i + 1), 6, n => account('host', n, 'HOST'));
  const invitees = await pool(Array.from({ length: plan.invitees }, (_, i) => i + 1), 6, n => account('invitee', n, 'INVITEE'));

  log('Creating vendor profiles, venues, offerings and availability...');
  const venues = []; const offerings = [];
  const vendorByVenue = new Map(); const vendorById = new Map();
  await pool(vendors, 8, async (vendor, index) => {
    vendorById.set(vendor.id, vendor);
    await api('POST', '/api/vendors/profile', { business_name: `LT Vendor ${index + 1}`, business_location: 'Pune' }, vendor.token);
    for (let v = 0; v < 2; v += 1) {
      const r = createRng(seed, `venue:${index}:${v}`);
      const body = { name: `LT Venue ${index + 1}-${v + 1}`, address: `${r.int(1, 99)} ${r.pick(['Main', 'Garden', 'Hall', 'Lake'])} Street, Pune`, capacity: r.int(20, 400), base_price: r.int(200, 5000), facilities: ['Parking', 'Stage'] };
      const created = await api('POST', '/api/venues', body, vendor.token);
      if (created.status !== 201) continue;
      await api('POST', '/api/availability', { venue_id: created.body.venue_id, start_datetime: '2030-01-01 00:00:00', end_datetime: '2030-12-31 23:59:59', availability_status: 'AVAILABLE' }, vendor.token);
      venues.push({ venue_id: created.body.venue_id, capacity: body.capacity, base_price: body.base_price });
      vendorByVenue.set(created.body.venue_id, vendor); stats.venues += 1;
    }
    for (let o = 0; o < 3; o += 1) {
      const r = createRng(seed, `offering:${index}:${o}`);
      const min = r.int(1, 40);
      const body = { category: r.pick(CATEGORIES), offering_type: r.pick(TYPES), name: `LT Offering ${index + 1}-${o + 1}`, description: 'Load test listing', price: r.int(10, 2500),
        pricing_unit: r.pick(['per person', 'flat', 'per hour']), min_capacity: min, max_capacity: min + r.int(20, 300) };
      const created = await api('POST', '/api/offerings', body, vendor.token);
      if (created.status !== 201) continue;
      await api('POST', '/api/availability', { offering_id: created.body.offering_id, start_datetime: '2030-01-01 00:00:00', end_datetime: '2030-12-31 23:59:59', availability_status: 'AVAILABLE' }, vendor.token);
      offerings.push({ offering_id: created.body.offering_id, category: body.category, min_capacity: body.min_capacity, max_capacity: body.max_capacity, price: body.price });
      vendorByVenue.set(`o${created.body.offering_id}`, vendor); stats.offerings += 1;
    }
  });

  const inviteeEmails = invitees.map(item => item.email);
  log(`Creating ${eventsPerHost} events per host with bookings, expenses and invitations...`);
  await pool(hosts, 10, async (host, hostIndex) => {
    for (let e = 0; e < eventsPerHost; e += 1) {
      const r = createRng(seed, `event:${hostIndex}:${e}`);
      const month = String(r.int(1, 12)).padStart(2, '0'); const day = String(r.int(1, 28)).padStart(2, '0');
      const body = { name: `LT Event ${hostIndex + 1}-${e + 1}`, event_type: r.pick(['Birthday', 'Wedding', 'Reunion', 'Corporate']), event_date: `2030-${month}-${day}`,
        start_time: `${String(r.int(9, 17)).padStart(2, '0')}:00`, duration_hours: r.int(2, 6), attendee_count: r.int(10, 150), budget: r.int(1000, 20000) };
      const created = await api('POST', '/api/events', body, host.token);
      if (created.status !== 201) continue;
      stats.events += 1;
      const eventId = created.body.event_id;
      const start = `${body.event_date} ${body.start_time}:00`;
      const endHour = Number(body.start_time.slice(0, 2)) + body.duration_hours;
      const end = `${body.event_date} ${String(endHour).padStart(2, '0')}:00:00`;
      if (venues.length && r.chance(0.6)) {
        const fits = venues.filter(v => v.capacity >= body.attendee_count);
        const venue = fits.length ? r.pick(fits) : null;
        if (venue) {
          const booking = await api('POST', '/api/bookings', { event_id: eventId, venue_id: venue.venue_id, start_datetime: start, end_datetime: end }, host.token);
          if (booking.status === 201) {
            stats.bookings += 1;
            const vendor = vendorByVenue.get(venue.venue_id);
            const roll = r.next();
            if (roll < 0.4) await api('PATCH', `/api/bookings/${booking.body.booking_id}/confirm`, {}, vendor.token);
            else if (roll < 0.55) await api('PATCH', `/api/bookings/${booking.body.booking_id}/reject`, {}, vendor.token);
            else if (roll < 0.65) await api('PATCH', `/api/bookings/${booking.body.booking_id}/cancel`, {}, host.token);
          }
        }
      }
      for (let x = 0; x < r.int(0, 3); x += 1) {
        const expense = await api('POST', `/api/events/${eventId}/expenses`, { description: r.pick(['Flowers', 'Cake', 'Music', 'Lighting']), amount: r.int(20, 600) }, host.token);
        if (expense.status === 201) stats.expenses += 1;
      }
      if (inviteeEmails.length) {
        const chosen = r.shuffle(inviteeEmails).slice(0, Math.min(inviteeEmails.length, r.int(3, 8)));
        const invited = await api('POST', `/api/events/${eventId}/invitations`, { invitees: chosen.map(address => ({ name: address.split('@')[0], email: address })) }, host.token);
        if (invited.status === 201) stats.invitations += chosen.length;
      }
    }
  });

  log('Recording some RSVP answers...');
  await pool(invitees, 10, async (invitee, index) => {
    const r = createRng(seed, `rsvp:${index}`);
    const mine = await api('GET', '/api/invitations/mine', null, invitee.token);
    if (!Array.isArray(mine.body)) return;
    for (const invitation of mine.body) {
      if (!r.chance(0.5)) continue;
      const answered = await api('PATCH', `/api/invitations/${invitation.invitation_id}/rsvp`, { rsvp_status: r.chance(0.7) ? 'ACCEPTED' : 'DECLINED' }, invitee.token);
      if (answered.status === 200) stats.rsvps += 1;
    }
  });

  const strip = list => list.map(item => ({ email: item.email }));
  return { accounts: { HOST: strip(hosts), VENDOR: strip(vendors), INVITEE: strip(invitees) }, venues, offerings, inviteeEmails, stats };
}

module.exports = { seedData, DOMAIN };
