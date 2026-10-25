// Requirement-driven unit tests. Each test title starts with the requirement IDs it verifies
// (HUS/VUS/IUS user stories, BR business rules, AC acceptance criteria, FR/NFR from the SRS).
// scripts/requirements-report.js reads those IDs to build REQUIREMENTS_TEST_REPORT.md.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repositories = require('../src/repositories');
const ApplicationRepository = require('../src/repositories/application.repository');
const Entity = require('../src/domain/entities');
const auth = require('../src/services/auth.service');
const events = require('../src/services/event.service');
const bookings = require('../src/services/booking.service');
const marketplace = require('../src/services/marketplace.service');
const invitations = require('../src/services/invitation.service');
const budget = require('../src/services/budget.service');
const availability = require('../src/services/availability.service');
const emailService = require('../src/services/email.service');
const reminders = require('../src/services/reminder.service');
const { authenticate, allowRoles } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errors');

const targets = [repositories.users, repositories.events, repositories.venues, repositories.vendorOfferings,
  repositories.vendorProfiles, repositories.availabilitySlots, repositories.expenses, repositories.queries, emailService];
const originals = new Map();
const originalFetch = globalThis.fetch;
function stub(target, key, value) {
  if (!originals.has(target)) originals.set(target, {});
  if (!(key in originals.get(target))) originals.get(target)[key] = target[key];
  target[key] = value;
}
afterEach(() => {
  for (const [target, methods] of originals) for (const [key, value] of Object.entries(methods)) target[key] = value;
  originals.clear();
  globalThis.fetch = originalFetch;
  for (const key of ['JWT_SECRET', 'NODE_ENV', 'RESEND_API_KEY', 'INVITATION_FROM_EMAIL']) delete process.env[key];
});

// A pool that records SQL so query-level rules can be asserted without MySQL.
function fakePool(rowsFor = () => []) {
  const log = [];
  const run = async (sql, params = []) => { log.push({ sql, params }); return [rowsFor(sql, params), {}]; };
  return { log, execute: run, query: run };
}
const bookingTimes = { start_datetime: '2026-06-01 18:00:00', end_datetime: '2026-06-01 21:00:00' };
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

// ---------- Host stories ----------

test('[HUS01 FR-01 NFR-01] registration hashes passwords, rejects weak input, and bad logins get a clear message', async () => {
  process.env.JWT_SECRET = '01234567890123456789012345678901';
  let created;
  stub(repositories.users, 'create', async value => { created = value; return { user_id: 1, ...value }; });
  stub(repositories.queries, 'findUserByEmail', async email => email === 'h@x.io' ? { user_id: 1, email, role: 'HOST', password_hash: created.password_hash } : null);
  await assert.rejects(auth.register({ name: 'H', email: 'h@x.io', password: 'weak', role: 'HOST', age: 30 }), { status: 400 });
  await assert.rejects(auth.register({ name: 'H', email: 'h@x.io', password: 'StrongPass1!', role: 'ADMIN', age: 30 }), { status: 400 });
  const done = await auth.register({ name: 'H', email: 'H@X.io', password: 'StrongPass1!', role: 'HOST', age: 30 });
  assert.equal(done.status, 201);
  assert.notEqual(created.password_hash, 'StrongPass1!');
  assert.ok(done.body.token);
  assert.equal((await auth.login({ email: 'h@x.io', password: 'StrongPass1!' })).status, 200);
  await assert.rejects(auth.login({ email: 'h@x.io', password: 'nope' }), { status: 401, message: 'Invalid email or password' });
});

test('[HUS02 FR-02] event creation validates type, budget, attendees, date, time and duration', () => {
  const ok = { name: 'Gala', event_type: 'Wedding', event_date: '2026-06-01', start_time: '18:00', duration_hours: 3, attendee_count: 80, budget: 5000 };
  assert.equal(Entity.Event.validate(ok), null);
  assert.ok(Entity.Event.validate({ ...ok, event_type: '' }));
  assert.ok(Entity.Event.validate({ ...ok, event_date: '' }));
  assert.match(Entity.Event.validate({ ...ok, duration_hours: 0 }), /duration/);
  assert.match(Entity.Event.validate({ ...ok, attendee_count: 0 }), /attendee_count/);
  assert.match(Entity.Event.validate({ ...ok, budget: -5 }), /budget/);
});

test('[HUS03 AC-01 BR-01 BR-25 FR-03] recommendations use the event budget, guests, date and duration and report no-results', async () => {
  const event = { event_id: 4, host_id: 5, event_date: '2026-06-01', start_time: '18:00:00', duration_hours: 3, attendee_count: 80, budget: '1000' };
  stub(repositories.events, 'findById', async () => event);
  let venueCriteria;
  stub(repositories.queries, 'searchVenues', async c => { venueCriteria = c; return []; });
  stub(repositories.queries, 'searchOfferings', async () => []);
  const result = await marketplace.recommendForEvent(5, 4);
  assert.deepEqual(venueCriteria, { attendees: 80, max_price: '1000', start_datetime: '2026-06-01 18:00:00', end_datetime: '2026-06-01 21:00:00' });
  assert.match(result.message, /No venues or vendors match/);
  await assert.rejects(marketplace.recommendForEvent(99, 4), { status: 404 });
});

test('[HUS04 HUS05 HUS06 FR-04 FR-05 FR-06 VUS02 BR-04 BR-05 BR-06 BR-25 AC-03] venue and offering search show details and exclude unavailable, blocked, over-capacity or inactive listings', async () => {
  const pool = fakePool();
  const repo = new ApplicationRepository(pool);
  await repo.searchVenues({ attendees: 50, max_price: 900, ...bookingTimes });
  await repo.searchOfferings({ category: 'Catering', attendees: 50, max_price: 40, ...bookingTimes });
  const [venueSql, offeringSql] = pool.log.map(entry => entry.sql);
  for (const column of ['v.address', 'v.capacity', 'v.facilities', 'v.base_price']) assert.ok(venueSql.includes(column), `venue search returns ${column}`);
  assert.match(venueSql, /v\.capacity >= \?/);
  assert.match(venueSql, /availability_status = 'AVAILABLE'/);
  assert.match(venueSql, /b\.status = 'CONFIRMED'\s+AND b\.start_datetime < \? AND b\.end_datetime > \?/);
  assert.match(venueSql, /availability_status = 'BLOCKED'/);
  for (const column of ['vo.description', 'vo.price', 'vo.pricing_unit', 'vo.min_capacity', 'vo.max_capacity']) assert.ok(offeringSql.includes(column), `offering search returns ${column}`);
  assert.match(offeringSql, /vo\.is_active = TRUE/);
  assert.match(offeringSql, /vo\.category = \?/);
  assert.ok(pool.log[1].params.includes('Catering'));
  await assert.rejects(marketplace.searchVenues({ start_datetime: '2026-06-01 10:00:00' }), { status: 400 });
  await assert.rejects(marketplace.searchVenues({ start_datetime: '2026-06-02', end_datetime: '2026-06-01' }), { status: 400 });
});

test('[HUS07 FR-07 BR-02 BR-03 AC-02] bookings over venue/service capacity, or under a service minimum, are refused at request and confirmation', async () => {
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'isBookableListing', async () => true);
  stub(repositories.queries, 'createBooking', async () => 9);
  stub(repositories.queries, 'notifyBookingParties', async () => {});
  stub(repositories.queries, 'isPendingBookingForVendor', async () => true);
  let check = { attendee_count: 120, venue_name: 'Hall', venue_capacity: 100 };
  stub(repositories.queries, 'getCapacityCheck', async () => check);
  const venueRequest = { event_id: 1, venue_id: 2, ...bookingTimes };
  await assert.rejects(bookings.create(5, venueRequest), { status: 409, message: /holds 100/ });
  await assert.rejects(bookings.confirm({ role: 'VENDOR', user_id: 7 }, 1), { status: 409, message: /holds 100/ });
  check = { attendee_count: 300, offering_name: 'Buffet', max_capacity: 200 };
  await assert.rejects(bookings.create(5, { event_id: 1, offering_id: 3, ...bookingTimes }), { status: 409, message: /up to 200/ });
  check = { attendee_count: 10, offering_name: 'Buffet', min_capacity: 50 };
  await assert.rejects(bookings.create(5, { event_id: 1, offering_id: 3, ...bookingTimes }), { status: 409, message: /at least 50/ });
  check = { attendee_count: 90, venue_name: 'Hall', venue_capacity: 100 };
  assert.equal(await bookings.create(5, venueRequest), 9);
});

test('[HUS07 BR-11 BR-04 BR-05 NFR-03] confirmation goes through the sp_confirm_booking procedure and blocking over confirmed bookings is refused', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).confirmBooking(7, 250);
  assert.match(pool.log[0].sql, /CALL sp_confirm_booking\(\?, \?\)/);
  assert.deepEqual(pool.log[0].params, [7, 250]);
  stub(repositories.queries, 'findAvailabilityForVendor', async () => ({ slot_id: 1 }));
  stub(repositories.availabilitySlots, 'findById', async () => ({ venue_id: 2, offering_id: null, start_datetime: '2026-06-01 10:00:00', end_datetime: '2026-06-01 22:00:00', availability_status: 'AVAILABLE' }));
  stub(repositories.queries, 'confirmedBookingOverlaps', async () => true);
  await assert.rejects(availability.update(7, 1, { availability_status: 'BLOCKED' }), { status: 409 });
  await assert.rejects(availability.remove(7, 1), { status: 409 });
});

test('[HUS08 BR-07 BR-09 AC-04 FR-08] host sees listed/agreed prices per booking and a budget summary only for their own event', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).listEventBookingsForHost(3, 5);
  assert.match(pool.log[0].sql, /COALESCE\(b\.agreed_price, v\.base_price, vo\.price\) AS estimated_price/);
  assert.deepEqual(pool.log[0].params, [3, 5]);
  stub(repositories.queries, 'findBudgetForEvent', async (userId, eventId) => userId === 5 ? { event_id: eventId, budget: 5000, budget_remaining: 1200 } : null);
  assert.equal((await budget.forEvent(5, 3)).budget_remaining, 1200);
  await assert.rejects(budget.forEvent(6, 3), { status: 404 });
});

test('[HUS09 HUS12 BR-10 BR-23 AC-07 FR-09 FR-12] bookings move between PENDING, REJECTED and CANCELLED only through permitted transitions', async () => {
  const updates = [];
  let record = { booking_id: 1, status: 'PENDING', host_id: 5, venue_vendor_id: 7, event_id: 1 };
  stub(repositories.queries, 'findBookingForCancel', async () => record);
  stub(repositories.queries, 'findBookingForReject', async () => record);
  stub(repositories.queries, 'updateBookingStatus', async (...args) => updates.push(args));
  stub(repositories.queries, 'notifyBookingParties', async () => {});
  stub(repositories.queries, 'getConfirmedEventLocation', async () => '[]');
  await bookings.reject(7, 1);
  await bookings.cancel({ role: 'HOST', user_id: 5 }, 1);
  assert.deepEqual(updates, [[1, 'REJECTED'], [1, 'CANCELLED']]);
  await assert.rejects(bookings.cancel({ role: 'HOST', user_id: 6 }, 1), { status: 403 });
  record = { ...record, status: 'CANCELLED' };
  await assert.rejects(bookings.cancel({ role: 'HOST', user_id: 5 }, 1), { status: 400 });
  record = { ...record, status: 'CONFIRMED' };
  await assert.rejects(bookings.reject(7, 1), { status: 400 });
  await assert.rejects(bookings.updatePending({ role: 'HOST', user_id: 5 }, 1, { agreed_price: 10 }), { status: 409 });
  await assert.rejects(bookings.updatePending({ role: 'VENDOR', user_id: 7 }, 1, { agreed_price: 10 }), { status: 403 });
});

test('[HUS10 BR-16 FR-10] invitations carry event name, date, time and location, and delivery failures are recorded', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.INVITATION_FROM_EMAIL = 'hi@gather.test';
  let sent;
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; };
  await emailService.sendInvitation('g@x.io', { name: 'Summer Gala', event_type: 'Party', event_date: '2026-06-01', start_time: '18:30:00', venue_name: 'Grand Hall', venue_address: '1 Main St' });
  assert.match(sent.text, /Summer Gala/);
  assert.match(sent.text, /June 1, 2026/);
  assert.match(sent.text, /18:30/);
  assert.match(sent.text, /Grand Hall, 1 Main St/);
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await emailService.sendInvitation('g@x.io', {}), { configured: false });

  const deliveries = [];
  stub(repositories.queries, 'hostOwnsEvent', async () => true);
  stub(repositories.queries, 'createInvitations', async () => [{ invitation_id: 1, email: 'g@x.io', delivery_status: 'MANUAL_SHARE' }]);
  stub(repositories.queries, 'findInvitationEventDetails', async () => ({ name: 'Gala' }));
  stub(repositories.queries, 'updateInvitationDelivery', async (...args) => deliveries.push(args));
  stub(emailService, 'sendInvitation', async () => { throw new Error('provider down'); });
  const [result] = await invitations.createForEvent(5, 1, [{ email: ' G@X.io ' }]);
  assert.equal(result.delivery_status, 'FAILED');
  assert.equal(result.delivery_error, 'provider down');
  await assert.rejects(invitations.createForEvent(5, 1, [{ email: 'nope' }]), { status: 400 });
  await assert.rejects(invitations.createForEvent(5, 1, []), { status: 400 });
});

test('[HUS11 IUS05 BR-18 FR-11 FR-28] RSVP accepts only ACCEPTED/DECLINED for the right invitee, notifies the host, and the guest list is host-scoped', async () => {
  const notes = [];
  stub(repositories.queries, 'updateRsvp', async (id, user) => user.user_id === 3);
  stub(repositories.queries, 'findInvitationHost', async () => ({ host_id: 5, event_name: 'Gala' }));
  stub(repositories.queries, 'createNotification', async (...args) => notes.push(args));
  await assert.rejects(invitations.rsvp({ user_id: 3, name: 'Gina' }, 1, 'MAYBE'), { status: 400 });
  await assert.rejects(invitations.rsvp({ user_id: 4, name: 'Other' }, 1, 'ACCEPTED'), { status: 404 });
  await invitations.rsvp({ user_id: 3, name: 'Gina' }, 1, 'ACCEPTED');
  assert.equal(notes[0][0], 5);
  assert.match(notes[0][1], /Gina responded accepted/);
  stub(repositories.queries, 'hostOwnsEvent', async (_event, userId) => userId === 5);
  stub(repositories.queries, 'listInvitationsForEvent', async () => [{ rsvp_status: 'PENDING' }]);
  assert.equal((await invitations.listForEvent(5, 1)).length, 1);
  await assert.rejects(invitations.listForEvent(6, 1), { status: 404 });
});

test('[HUS13 BR-26 FR-13] the host event overview lists venue and vendor bookings with status and cost in one query', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).listEventBookingsForHost(3, 5);
  const sql = pool.log[0].sql;
  for (const part of ['b.status', 'v.name AS venue_name', 'vo.name AS offering_name', 'vp.business_name', 'estimated_price']) assert.ok(sql.includes(part), part);
  assert.match(sql, /e\.host_id = \?/);
});

test('[BR-15 BR-20 AC-05] hosts own their events: others are refused, and only hosts can create or change them', async () => {
  stub(repositories.queries, 'findEventById', async () => ({ event_id: 1, host_id: 8 }));
  await assert.rejects(events.getForUser(1, { role: 'HOST', user_id: 9 }), { status: 403 });
  await assert.rejects(events.list({ role: 'VENDOR' }), { status: 403 });
  for (const role of ['VENDOR', 'INVITEE']) {
    let outcome; allowRoles('HOST')({ user: { role } }, {}, error => { outcome = error; });
    assert.equal(outcome.status, 403);
  }
  let allowed = 'unset'; allowRoles('HOST')({ user: { role: 'HOST' } }, {}, error => { allowed = error; });
  assert.equal(allowed, undefined);
});

// ---------- Vendor stories ----------

test('[VUS01 VUS02 BR-20 FR-14] vendors create then update a profile with a category-bearing business name, and only the VENDOR role may', async () => {
  const saved = [];
  stub(repositories.vendorProfiles, 'findById', async () => saved.length ? { vendor_id: 7 } : null);
  stub(repositories.vendorProfiles, 'create', async v => { saved.push(['create', v]); return v; });
  stub(repositories.vendorProfiles, 'update', async (id, v) => { saved.push(['update', v]); return v; });
  await assert.rejects(marketplace.saveVendorProfile(7, { business_name: '  ' }), { status: 400 });
  await marketplace.saveVendorProfile(7, { business_name: ' Tasty Bites ', description: 'Catering' });
  await marketplace.saveVendorProfile(7, { business_name: 'Tasty Bites Co' });
  assert.deepEqual(saved.map(entry => entry[0]), ['create', 'update']);
  assert.equal(saved[0][1].business_name, 'Tasty Bites');
  let outcome; allowRoles('VENDOR')({ user: { role: 'HOST' } }, {}, error => { outcome = error; });
  assert.equal(outcome.status, 403);
});

test('[VUS03 VUS04 VUS06 FR-15 FR-16 BR-13 AC-04] offerings validate price and capacity, are editable only by their owner, and keep booking history', async () => {
  assert.equal(Entity.VendorOffering.validate({ category: 'Catering', name: 'Buffet', offering_type: 'PACKAGE', price: 25, min_capacity: 20, max_capacity: 200 }), null);
  assert.match(Entity.VendorOffering.validate({ category: 'Catering', name: 'Buffet', offering_type: 'PACKAGE', price: -1 }), /price/);
  assert.match(Entity.VendorOffering.validate({ category: 'Catering', name: 'Buffet', offering_type: 'PACKAGE', min_capacity: 300, max_capacity: 200 }), /min_capacity/);
  stub(repositories.vendorOfferings, 'findById', async () => ({ offering_id: 1, vendor_id: 7, category: 'Catering', name: 'Buffet', offering_type: 'PACKAGE', price: 25 }));
  stub(repositories.queries, 'hasOpenBookingForResource', async () => false);
  stub(repositories.queries, 'hasBookingForOffering', async () => true);
  await assert.rejects(marketplace.updateOffering(8, 1, { price: 30 }), { status: 404 });
  await assert.rejects(marketplace.updateOffering(7, 1, { price: -3 }), { status: 400 });
  await assert.rejects(marketplace.deleteOffering(8, 1), { status: 404 });
  await assert.rejects(marketplace.deleteOffering(7, 1), { status: 409, message: /deactivate/ });
});

test('[VUS05 VUS12 BR-14 FR-17] venue details need a positive capacity and cannot change under open bookings', async () => {
  assert.equal(Entity.Venue.validate({ name: 'Hall', address: '1 Main St', capacity: 100, base_price: 500 }), null);
  assert.match(Entity.Venue.validate({ name: 'Hall', address: '1 Main St', capacity: 0 }), /capacity/);
  stub(repositories.venues, 'findById', async () => ({ venue_id: 2, vendor_id: 7, name: 'Hall', address: '1 Main St', capacity: 100 }));
  stub(repositories.queries, 'hasOpenBookingForResource', async () => true);
  await assert.rejects(marketplace.updateVenue(7, 2, { capacity: 50 }), { status: 409 });
  await assert.rejects(marketplace.updateVenue(8, 2, { capacity: 50 }), { status: 404 });
});

test('[VUS08 VUS11 FR-19 FR-22 BR-08 BR-21 BR-09 AC-05] a vendor sees only their own bookings with date, guests and price, and never the host budget', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).listBookingsFor({ role: 'VENDOR', user_id: 7 });
  const { sql, params } = pool.log[0];
  assert.match(sql, /\(v\.vendor_id = \? OR vo\.vendor_id = \?\)/);
  assert.deepEqual(params, [7, 7]);
  for (const part of ['e.attendee_count', 'e.event_date', 'e.duration_hours', 'booking_price', 'host_name']) assert.ok(sql.includes(part), part);
  assert.ok(!/e\.budget|\bbudget\b/.test(sql), 'vendor query must not expose the host budget');
});

test('[VUS09 VUS10 FR-20 FR-21 BR-12 AC-03] vendors accept/reject only pending requests for their own listings', async () => {
  stub(repositories.queries, 'isPendingBookingForVendor', async (_id, userId) => userId === 7);
  stub(repositories.queries, 'findBookingForReject', async () => ({ booking_id: 1, status: 'PENDING', venue_vendor_id: 7 }));
  await assert.rejects(bookings.confirm({ role: 'VENDOR', user_id: 8 }, 1), { status: 404 });
  await assert.rejects(bookings.reject(8, 1), { status: 403 });
  stub(repositories.queries, 'findAvailabilityForVendor', async (_id, userId) => userId === 7 ? { slot_id: 1 } : null);
  await assert.rejects(availability.update(8, 1, { availability_status: 'BLOCKED' }), { status: 404 });
  stub(repositories.queries, 'vendorOwnsResource', async () => false);
  await assert.rejects(availability.create(7, { venue_id: 2, ...bookingTimes }), { status: 404 });
  await assert.rejects(availability.create(7, { venue_id: 2, offering_id: 3, ...bookingTimes }), { status: 400 });
  await assert.rejects(availability.create(7, { venue_id: 2, start_datetime: '2026-06-02', end_datetime: '2026-06-01' }), { status: 400 });
});

test('[VUS13 FR-23] vendor booking history can be limited to upcoming or past bookings', async () => {
  const pool = fakePool();
  const repo = new ApplicationRepository(pool);
  await repo.listBookingsFor({ role: 'VENDOR', user_id: 7 }, 'upcoming');
  await repo.listBookingsFor({ role: 'VENDOR', user_id: 7 }, 'past');
  assert.match(pool.log[0].sql, /b\.end_datetime >= NOW\(\)/);
  assert.match(pool.log[1].sql, /b\.end_datetime < NOW\(\)/);
  stub(repositories.queries, 'listBookingsFor', async () => []);
  await assert.rejects(bookings.list({ role: 'VENDOR', user_id: 7 }, 'someday'), { status: 400 });
});

test('[VUS14 BR-24 FR-24] booking events notify the other party, and only that party', async () => {
  const contact = { booking_id: 1, event_id: 1, event_name: 'Gala', host_id: 5, vendor_id: 7, listing_name: 'Hall' };
  const pool = fakePool(sql => (/FROM booking b JOIN/.test(sql) ? [contact] : []));
  const repo = new ApplicationRepository(pool);
  await repo.notifyBookingParties(1, 'HOST', 'requested');
  await repo.notifyBookingParties(1, 'VENDOR', 'confirmed');
  const inserts = pool.log.filter(entry => /INSERT INTO notification/.test(entry.sql));
  assert.equal(inserts[0].params[0], 7);
  assert.equal(inserts[0].params[2], 'BOOKING_REQUESTED');
  assert.equal(inserts[1].params[0], 5);
  assert.equal(inserts[1].params[2], 'BOOKING_CONFIRMED');
});

// ---------- Invited-user stories ----------

test('[IUS01 IUS07 AC-06 BR-17 BR-22 FR-25] only invited users can open an event; the invitation list is scoped to the signed-in user', async () => {
  stub(repositories.queries, 'findEventById', async () => ({ event_id: 1, host_id: 8, budget: 900, name: 'Gala' }));
  stub(repositories.queries, 'findHostContactForEvent', async () => ({ host_name: 'Hana', host_phone: null }));
  stub(repositories.queries, 'isInviteeForEvent', async () => false);
  await assert.rejects(events.getForUser(1, { role: 'INVITEE', user_id: 3 }), { status: 403 });
  const pool = fakePool();
  await new ApplicationRepository(pool).listInvitationsFor({ user_id: 3, email: 'G@x.io' });
  assert.match(pool.log[0].sql, /invitee_user_id = \? OR LOWER\(invitee_email\) = LOWER\(\?\)/);
  assert.deepEqual(pool.log[0].params, [3, 'G@x.io']);
});

test('[IUS02 IUS04 BR-09 BR-22 FR-26] invitees see the event and host name but never the host budget or id', async () => {
  stub(repositories.queries, 'findEventById', async () => ({ event_id: 1, host_id: 8, budget: 900, name: 'Gala', event_type: 'Party', event_date: '2026-06-01', start_time: '18:00:00', duration_hours: 3 }));
  stub(repositories.queries, 'isInviteeForEvent', async () => true);
  stub(repositories.queries, 'findHostContactForEvent', async () => ({ host_name: 'Hana', host_phone: null }));
  const view = await events.getForUser(1, { role: 'INVITEE', user_id: 3 });
  assert.equal(view.name, 'Gala');
  assert.equal(view.host_name, 'Hana');
  assert.equal('budget' in view, false);
  assert.equal('host_id' in view, false);
});

test('[IUS03 BR-17 FR-27] invitees get only confirmed venue address data, with a map link in the app', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).listEventBookingsForInvitee(1);
  assert.match(pool.log[0].sql, /b\.status = 'CONFIRMED' AND b\.venue_id IS NOT NULL/);
  assert.ok(pool.log[0].sql.includes('v.address AS venue_address'));
  assert.ok(!/agreed_price|budget/.test(pool.log[0].sql), 'invitee venue query must not expose prices');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(appJs, /google\.com\/maps\/search/);
});

test('[IUS06 BR-19 FR-29] invitees are notified when the date or time changes, but not for unrelated edits', async () => {
  const notified = [];
  stub(repositories.queries, 'findEventById', async () => ({ event_id: 1, event_date: '2026-06-01', start_time: '18:00:00' }));
  stub(repositories.events, 'updateWhere', async () => ({ event_id: 1 }));
  stub(repositories.queries, 'notifyEventInvitees', async (...args) => notified.push(args));
  await events.update(1, 8, { name: 'Renamed' });
  await events.update(1, 8, { event_date: '2026-06-01', start_time: '18:00:00' });
  assert.equal(notified.length, 0);
  await events.update(1, 8, { event_date: '2026-06-02' });
  await events.update(1, 8, { start_time: '19:00:00' });
  assert.equal(notified.length, 2);
  assert.match(notified[0][1], /date or time has changed/);
});

test('[IUS09 FR-30] host contact details are shared only when the host opted in', async () => {
  const pool = fakePool();
  await new ApplicationRepository(pool).findHostContactForEvent(1);
  assert.match(pool.log[0].sql, /CASE WHEN h\.share_phone_with_invitees = TRUE THEN h\.phone ELSE NULL END/);
  stub(repositories.users, 'findById', async () => ({ phone: null }));
  await assert.rejects(auth.updateProfile(1, { share_phone_with_invitees: true }), { status: 400, message: /phone number/ });
});

test('[FR-31] a reminder is sent once per registered, non-declined invitee shortly before the event', async () => {
  const sent = [];
  const pool = fakePool();
  await new ApplicationRepository(pool).findDueReminders(24);
  assert.match(pool.log[0].sql, /rsvp_status <> 'DECLINED' AND i\.reminder_sent_at IS NULL/);
  stub(repositories.queries, 'findDueReminders', async () => [
    { invitation_id: 1, invitee_user_id: 8, event_name: 'Gala', event_date: '2026-06-01', start_time: '18:00:00' },
    { invitation_id: 2, invitee_user_id: 9, event_name: 'Gala', event_date: '2026-06-01', start_time: '18:00:00' }]);
  stub(repositories.queries, 'markReminderSent', async id => id === 1);
  stub(repositories.queries, 'createNotification', async (...args) => sent.push(args));
  assert.deepEqual(await reminders.sendDueReminders(24), { sent: 1 });
  assert.equal(sent[0][2], 'EVENT_REMINDER');
});

// ---------- Cross-cutting and non-functional ----------

test('[NFR-01 NFR-02 AC-05 BR-20] protected routes need a valid bearer token, and password hashes never leave the API', async () => {
  const unauthorized = res();
  await authenticate({ headers: {} }, unauthorized, () => assert.fail('must not continue'));
  assert.equal(unauthorized.code, 401);
  const malformed = res();
  await authenticate({ headers: { authorization: 'Token abc' } }, malformed, () => assert.fail('must not continue'));
  assert.equal(malformed.code, 401);
  assert.equal(Entity.User.fromRow({ user_id: 1, email: 'a@b.io', password_hash: 'secret' }).toJSON().password_hash, undefined);
  stub(repositories.users, 'findById', async () => Entity.User.fromRow({ user_id: 1, name: 'A', password_hash: 'secret' }));
  assert.equal('password_hash' in await auth.getProfile(1), false);
});

test('[NFR-04] API errors are consistent and do not leak internals in production', () => {
  const quiet = console.error; console.error = () => {};
  try {
    const clientError = res(); errorHandler({ status: 404, message: 'Event not found' }, {}, clientError);
    assert.deepEqual([clientError.code, clientError.body], [404, { message: 'Event not found' }]);
    const duplicate = res(); errorHandler({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry secret' }, {}, duplicate);
    assert.equal(duplicate.code, 409);
    assert.ok(!/secret/.test(duplicate.body.message));
    process.env.NODE_ENV = 'production';
    const crash = res(); errorHandler(new Error('SELECT * FROM app_user failed'), {}, crash);
    assert.deepEqual([crash.code, crash.body], [500, { message: 'Internal server error' }]);
  } finally { console.error = quiet; }
});

test('[NFR-05 NFR-07] route modules stay thin: they call services and never touch repositories or SQL directly', () => {
  const dir = path.join(__dirname, '../src/routes');
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/require\(['"]\.\.\/repositories/.test(source), `${file} must not require repositories`);
    assert.ok(!/\b(SELECT|INSERT|UPDATE|DELETE)\b\s/.test(source), `${file} must not contain SQL`);
  }
});
