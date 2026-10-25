// Integration + UI test run against a throw-away database and a second copy of the server.
// Usage: node scripts/e2e/run.js      Output: INTEGRATION_UI_TEST_REPORT.html
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./env');
process.env.DB_NAME = env.TEST_DB; // anything required from src/ below talks to the throw-away database
const { launch, newPage, api, signIn, baseUrl } = require('./browser');
const { buildReport } = require('./report');

const PASSWORD = 'Passw0rd!x';
const sections = [];
let currentSection = null;
const S = {}; // state shared between steps of the workflow

function section(title) { currentSection = { title, tests: [] }; sections.push(currentSection); }
// kind: 'UI' tests get a fresh Chrome page, a screenshot, and fail on any uncaught JavaScript error.
function test(kind, name, fn) { currentSection.tests.push({ kind, name, fn }); }

const tokenFor = async email => (await api('POST', '/api/auth/login', { email, password: PASSWORD })).body.token;
async function registerApi(name, email, role) {
  const response = await api('POST', '/api/auth/register', { name, email, password: PASSWORD, role, age: 30 });
  assert.equal(response.status, 201, `register ${email}: ${JSON.stringify(response.body)}`);
  return response.body.token;
}
async function registerUi(page, role, name, email, password = PASSWORD) {
  await page.goto(`${baseUrl}/login?role=${role.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
  await page.click('.form-tab[data-mode=register]');
  await page.fill('input[name=name]', name);
  await page.fill('input[name=age]', '30');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('#submit-button');
}
const visibleNav = page => page.$$eval('.nav-item', els => els.filter(el => el.offsetParent).map(el => el.textContent.trim()));
const toast = async (page, text) => page.waitForFunction(expected => document.querySelector('#toast')?.textContent.includes(expected), text, { timeout: 8000 });
const eventBody = (over = {}) => ({ name: 'Probe Party', event_type: 'Birthday', event_date: '2027-06-01', start_time: '18:00', duration_hours: 4, attendee_count: 60, budget: 2000, ...over });
const slot = (venue_id, day, status = 'AVAILABLE') => ({ venue_id, start_datetime: `${day} 08:00:00`, end_datetime: `${day} 23:00:00`, availability_status: status });

// ================================================================== 1
section('Public pages and sign-in');

test('UI', 'landing page shows the product message and no demo credentials', async ({ page, note }) => {
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  const text = await page.innerText('body');
  assert.match(await page.title(), /Gather/);
  assert.ok(await page.$('a[href*="/login"]'), 'landing page links to the sign-in page');
  assert.ok(!/demo (account|login|credential)|password\s*:/i.test(text), 'no demo credentials are printed on the page');
  note('Title mentions Gather and the page links to /login.', 'No demo email/password text is shown to visitors.');
});

test('UI', 'wrong password is rejected with a message and stays on the sign-in page', async ({ page, note }) => {
  await registerApi('Wrong Pw', 'wrongpw@e2e.test', 'HOST');
  await page.goto(`${baseUrl}/login?role=host`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=email]', 'wrongpw@e2e.test');
  await page.fill('input[name=password]', 'Not-The-Password1!');
  await page.click('#submit-button');
  await page.waitForSelector('#form-error.visible');
  assert.match(await page.textContent('#form-error'), /invalid email or password/i);
  assert.match(page.url(), /\/login/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gather_token')), null);
  note('Clear "Invalid email or password" message shown, no token stored, still on /login.');
});

test('UI', 'role buttons only choose a role; none of them signs anyone in', async ({ page, note }) => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  const authCalls = [];
  page.on('request', request => { if (request.url().includes('/api/auth')) authCalls.push(request.url()); });
  for (const role of ['HOST', 'VENDOR', 'INVITEE']) await page.click(`.role-choice[data-role=${role}]`);
  await page.waitForTimeout(400);
  assert.match(page.url(), /\/login/);
  assert.equal(authCalls.length, 0);
  note('Clicked Host, Vendor and Invitee: no request to /api/auth and no navigation away from the form.');
});

test('UI', 'a weak password is stopped on the create-account form before anything is sent', async ({ page, note }) => {
  const calls = [];
  page.on('request', request => { if (request.url().includes('/api/auth/register')) calls.push(request.url()); });
  await registerUi(page, 'HOST', 'Weak Pw', 'weak@e2e.test', 'password1');
  await page.waitForTimeout(500);
  assert.equal(calls.length, 0);
  assert.match(page.url(), /\/login/);
  note('"password1" (no capital letter or symbol) is refused by the form; no register request was made.');
});

test('UI', 'app pages treat a visitor who is not signed in as signed out, and the API refuses them', async ({ page, note }) => {
  await page.goto(baseUrl + '/app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#auth-action');
  assert.equal((await page.textContent('#auth-action')).trim(), 'Sign in');
  assert.equal(await page.evaluate(() => localStorage.getItem('gather_token')), null);
  for (const url of ['/api/events', '/api/bookings', '/api/notifications', '/api/events/1/budget']) {
    assert.equal((await api('GET', url)).status, 401, url);
  }
  note('Dashboard offers "Sign in" and holds no token.', 'GET /api/events, /api/bookings, /api/notifications and /api/events/1/budget all return 401 without a token.');
});

// ================================================================== 2
section('Accounts and role separation');

test('UI', 'a host creates an account through the form and lands on the host dashboard', async ({ page, note }) => {
  await registerUi(page, 'HOST', 'Hana Host', 'host@e2e.test');
  await page.waitForURL(/\/app/, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#top-user-name:not(:empty)');
  assert.deepEqual(await visibleNav(page), ['Overview', 'My events', 'Find a venue', 'Services', 'Invite guests']);
  assert.equal((await page.textContent('#profile-role')).trim(), 'Event host');
  note('Signed in automatically after registering. Sidebar: Overview, My events, Find a venue, Services, Invite guests.');
});

test('UI', 'a vendor creates an account and sees only vendor navigation', async ({ page, note }) => {
  await registerUi(page, 'VENDOR', 'Vik Vendor', 'vendor@e2e.test');
  await page.waitForURL(/\/app/, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#top-user-name:not(:empty)');
  assert.deepEqual(await visibleNav(page), ['My services', 'My bookings']);
  note('Sidebar shows only My services and My bookings; no event planning, venue search or invite screens.');
});

test('UI', 'an invited guest creates an account and sees only guest navigation (no Invite guests)', async ({ page, note }) => {
  await registerUi(page, 'INVITEE', 'Gina Guest', 'guest@e2e.test');
  await page.waitForURL(/\/app/, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#top-user-name:not(:empty)');
  const nav = await visibleNav(page);
  assert.ok(!nav.includes('Invite guests'), `guests must not see Invite guests, saw: ${nav.join(', ')}`);
  assert.ok(nav.includes('Invitations'));
  note(`Sidebar: ${nav.join(', ')}.`, 'Host-only "Invite guests" is hidden (this was shown to guests before this test run; fixed in public/app.js).');
});

test('API', 'role fences: each role is refused the other roles\' actions by the server too', async ({ note }) => {
  S.hostToken = await tokenFor('host@e2e.test'); S.vendorToken = await tokenFor('vendor@e2e.test'); S.guestToken = await tokenFor('guest@e2e.test');
  const refused = async (label, response) => { assert.equal(response.status, 403, `${label} -> ${response.status} ${JSON.stringify(response.body)}`); };
  await refused('guest creates event', await api('POST', '/api/events', eventBody(), S.guestToken));
  await refused('vendor creates event', await api('POST', '/api/events', eventBody(), S.vendorToken));
  await refused('guest lists bookings', await api('GET', '/api/bookings', null, S.guestToken));
  await refused('host creates venue', await api('POST', '/api/venues', { name: 'X', address: 'Y', capacity: 10 }, S.hostToken));
  await refused('host lists vendor availability', await api('GET', '/api/availability', null, S.hostToken));
  await refused('vendor reads a host budget', await api('GET', '/api/events/1/budget', null, S.vendorToken));
  await refused('host answers an RSVP', await api('PATCH', '/api/invitations/1/rsvp', { rsvp_status: 'ACCEPTED' }, S.hostToken));
  note('Guest/vendor cannot create events; guest cannot list bookings; host cannot create venues, manage availability or RSVP; vendor cannot read a budget. All 403.');
});

test('UI', 'signing out clears the session in the browser', async ({ page, note }) => {
  await signIn(page, 'host@e2e.test', PASSWORD, 'HOST');
  assert.ok(await page.evaluate(() => localStorage.getItem('gather_token')));
  await page.click('#auth-action');
  await page.waitForFunction(() => !localStorage.getItem('gather_token'), null, { timeout: 8000 });
  assert.equal((await page.textContent('#auth-action')).trim(), 'Sign in');
  note('Token removed from the browser and the dashboard returns to its signed-out state.',
    'Limit: tokens are stateless JWTs, so a copied token stays valid until it expires (1 day). There is no server-side revoke.');
});

// ================================================================== 3
section('The workflow, step by step (host books a venue, vendor confirms, guest answers the invitation)');

test('API', 'step 1 - the vendor sets up a profile, two venues and their availability', async ({ note }) => {
  assert.equal((await api('POST', '/api/vendors/profile', { business_name: 'Grand Hall Co', business_location: 'Pune' }, S.vendorToken)).status, 200);
  const big = await api('POST', '/api/venues', { name: 'Grand Hall', address: '1 Main St, Pune', capacity: 100, base_price: 500, facilities: ['Parking'] }, S.vendorToken);
  const small = await api('POST', '/api/venues', { name: 'Tiny Room', address: '2 Side St, Pune', capacity: 20, base_price: 100 }, S.vendorToken);
  assert.equal(big.status, 201); assert.equal(small.status, 201);
  S.bigVenue = big.body.venue_id; S.smallVenue = small.body.venue_id;
  assert.equal((await api('POST', '/api/availability', slot(S.bigVenue, '2027-06-01'), S.vendorToken)).status, 201);
  assert.equal((await api('POST', '/api/availability', slot(S.smallVenue, '2027-06-01'), S.vendorToken)).status, 201);
  assert.equal((await api('POST', '/api/venues', { name: 'Bad', address: 'Y', capacity: 0 }, S.vendorToken)).status, 400);
  note('Grand Hall (100 guests, 500) and Tiny Room (20 guests, 100) are open on 2027-06-01 from 08:00 to 23:00.', 'A venue with capacity 0 is refused (400).');
});

test('UI', 'step 2 - the host creates an event; invalid input is stopped, valid input appears in the list', async ({ page, note }) => {
  await signIn(page, 'host@e2e.test', PASSWORD, 'HOST');
  const created = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/events')) created.push(request.url()); });
  await page.click('#top-create');
  await page.fill('#event-form [name=name]', 'Probe Party'); await page.fill('#event-form [name=event_type]', 'Birthday');
  await page.fill('#event-form [name=event_date]', '2027-06-01'); await page.fill('#event-form [name=start_time]', '18:00');
  await page.fill('#event-form [name=attendee_count]', '0'); await page.fill('#event-form [name=budget]', '2000');
  await page.click('#event-form button[type=submit]'); await page.waitForTimeout(400);
  assert.equal(created.length, 0, '0 guests must be stopped by the form');
  assert.ok(await page.isVisible('#event-modal'), 'dialog stays open while the form is invalid');
  await page.fill('#event-form [name=attendee_count]', '60');
  await page.click('#event-form button[type=submit]');
  await page.waitForSelector('#event-list .event-card');
  await toast(page, 'Your event is on its way');
  const card = await page.innerText('#event-list .event-card');
  assert.match(card, /Probe Party/); assert.match(card, /60 guests/); assert.match(card, /Budget 2,000/);
  note('0 guests: form blocks the submit, no request is sent, dialog stays open.', 'Valid form: toast "Your event is on its way", card shows name, 60 guests and Budget 2,000.');
});

test('API', 'step 3 - the event is stored with the right details', async ({ note }) => {
  const events = (await api('GET', '/api/events', null, S.hostToken)).body;
  assert.equal(events.length, 1);
  const event = events[0]; S.eventId = event.event_id;
  assert.deepEqual([event.name, event.event_type, event.event_date, event.attendee_count, Number(event.budget), Number(event.duration_hours)],
    ['Probe Party', 'Birthday', '2027-06-01', 60, 2000, 4]);
  assert.equal(event.start_time.slice(0, 5), '18:00');
  note(`Event ${event.event_id}: Probe Party, Birthday, 2027-06-01 18:00, 4 hours, 60 guests, budget 2000, status ${event.status}.`);
});

test('UI', 'step 4 - another host cannot see it, in the UI or the API', async ({ page, note }) => {
  S.otherHostToken = await registerApi('Omar Other', 'otherhost@e2e.test', 'HOST');
  assert.equal((await api('GET', `/api/events/${S.eventId}`, null, S.otherHostToken)).status, 403);
  assert.equal((await api('GET', `/api/events/${S.eventId}/bookings`, null, S.otherHostToken)).status, 403);
  assert.equal((await api('GET', `/api/events/${S.eventId}/budget`, null, S.otherHostToken)).status, 404);
  assert.equal((await api('PUT', `/api/events/${S.eventId}`, { name: 'Stolen' }, S.otherHostToken)).status, 404);
  assert.deepEqual((await api('GET', '/api/events', null, S.otherHostToken)).body, []);
  await signIn(page, 'otherhost@e2e.test', PASSWORD, 'HOST');
  await page.waitForSelector('#event-list .empty-state');
  assert.ok(!(await page.innerText('#event-list')).includes('Probe Party'));
  note('API: view 403, bookings 403, budget 404, edit 404, list empty.', 'UI: the second host\'s dashboard shows the empty "Nothing on the calendar yet" state.');
});

test('UI', 'step 5 - the host searches venues: capacity, date and time filters decide what is offered', async ({ page, note }) => {
  await signIn(page, 'host@e2e.test', PASSWORD, 'HOST');
  await page.click('[data-view=venues].nav-item');
  const search = async guests => {
    await page.fill('#browse-filters [name=attendees]', String(guests)); await page.fill('#browse-filters [name=event_date]', '2027-06-01');
    await page.fill('#browse-filters [name=start_time]', '18:00'); await page.fill('#browse-filters [name=duration_hours]', '4');
    await page.click('#browse-form button[type=submit]'); await page.waitForTimeout(900);
    return page.$$eval('#browse-results .result-card strong', els => els.map(el => el.textContent));
  };
  assert.deepEqual(await search(60), ['Grand Hall']);
  assert.deepEqual(await search(200), []);
  assert.deepEqual(await search(10), ['Tiny Room', 'Grand Hall']);
  note('60 guests: only Grand Hall (Tiny Room holds 20).', '200 guests: no venue offered.', '10 guests: both venues, cheapest first.');
});

test('UI', 'step 6 - the host sends a booking request; it is saved as PENDING and the vendor is notified', async ({ page, note }) => {
  await signIn(page, 'host@e2e.test', PASSWORD, 'HOST');
  await page.click('[data-view=venues].nav-item');
  await page.fill('#browse-filters [name=attendees]', '60'); await page.fill('#browse-filters [name=event_date]', '2027-06-01');
  await page.fill('#browse-filters [name=start_time]', '18:00'); await page.fill('#browse-filters [name=duration_hours]', '4');
  await page.click('#browse-form button[type=submit]');
  await page.click('#browse-results .listing-action');
  await page.waitForSelector('#booking-form');
  await page.click('#booking-form button[type=submit]');
  await toast(page, 'Booking request sent');
  const bookings = (await api('GET', '/api/bookings', null, S.hostToken)).body;
  assert.equal(bookings.length, 1);
  S.bookingId = bookings[0].booking_id;
  assert.deepEqual([bookings[0].status, bookings[0].venue_id, bookings[0].start_datetime, bookings[0].end_datetime],
    ['PENDING', S.bigVenue, '2027-06-01 18:00:00', '2027-06-01 22:00:00']);
  const vendorNotes = (await api('GET', '/api/notifications', null, S.vendorToken)).body;
  assert.ok(vendorNotes.some(n => /requested the booking for Probe Party/.test(n.message)), 'vendor notification');
  note('Booking is PENDING for Grand Hall, 18:00-22:00 (the event\'s 4 hours).', 'Vendor notification: "The event host requested the booking for Probe Party (Grand Hall)".');
});

test('UI', 'step 7 - the vendor sees the request with its details; another vendor does not', async ({ page, note }) => {
  await signIn(page, 'vendor@e2e.test', PASSWORD, 'VENDOR');
  await page.click('[data-view=vendor-bookings].nav-item');
  await page.waitForSelector('button:has-text("Confirm")');
  const text = await page.innerText('main');
  assert.match(text, /Probe Party/); assert.match(text, /Grand Hall/); assert.match(text, /PENDING/); assert.match(text, /June 1, 2027 at 18:00/);
  const mine = (await api('GET', '/api/bookings', null, S.vendorToken)).body[0];
  assert.equal(mine.attendee_count, 60); assert.equal(mine.host_name, 'Hana Host');
  assert.ok(!('budget' in mine), 'vendor must not receive the host budget');
  S.otherVendorToken = await registerApi('Vera Other', 'othervendor@e2e.test', 'VENDOR');
  assert.deepEqual((await api('GET', '/api/bookings', null, S.otherVendorToken)).body, []);
  assert.equal((await api('PATCH', `/api/bookings/${S.bookingId}/confirm`, {}, S.otherVendorToken)).status, 404);
  assert.equal((await api('PATCH', `/api/bookings/${S.bookingId}/reject`, {}, S.otherVendorToken)).status, 403);
  note('Vendor screen lists Probe Party, Grand Hall, June 1 2027 at 18:00, PENDING, with Confirm and Reject.', 'API row has attendee count 60 and host name, and no budget.', 'A different vendor sees no bookings and cannot confirm (404) or reject (403) it.');
});

test('API', 'step 8 - capacity guard: a booking larger than the venue is refused', async ({ note }) => {
  const tooBig = (await api('POST', '/api/events', eventBody({ name: 'Huge Party', attendee_count: 150 }), S.hostToken)).body.event_id;
  const overVenue = await api('POST', '/api/bookings', { event_id: tooBig, venue_id: S.bigVenue, start_datetime: '2027-06-01 18:00:00', end_datetime: '2027-06-01 22:00:00' }, S.hostToken);
  assert.equal(overVenue.status, 409); assert.match(overVenue.body.message, /holds 100 guests but the event expects 150/);
  const overSmall = await api('POST', '/api/bookings', { event_id: S.eventId, venue_id: S.smallVenue, start_datetime: '2027-06-01 18:00:00', end_datetime: '2027-06-01 22:00:00' }, S.hostToken);
  assert.equal(overSmall.status, 409);
  assert.equal((await api('GET', '/api/bookings', null, S.hostToken)).body.length, 1, 'refused requests must not create bookings');
  note('150 guests into Grand Hall (100): 409 "holds 100 guests but the event expects 150".', '60 guests into Tiny Room (20): 409.', 'No booking rows were created by the refused requests.');
});

test('UI', 'step 9 - the vendor confirms in the browser; the stored procedure confirms it and the host is told', async ({ page, note }) => {
  await signIn(page, 'vendor@e2e.test', PASSWORD, 'VENDOR');
  await page.click('[data-view=vendor-bookings].nav-item');
  await page.click('button:has-text("Confirm")');
  await toast(page, 'Booking confirmed');
  await page.waitForFunction(() => /CONFIRMED/.test(document.querySelector('main').innerText), null, { timeout: 6000 });
  const [booking] = (await api('GET', '/api/bookings', null, S.hostToken)).body;
  assert.equal(booking.status, 'CONFIRMED');
  const hostNotes = (await api('GET', '/api/notifications', null, S.hostToken)).body;
  assert.ok(hostNotes.some(n => /confirmed the booking for Probe Party/.test(n.message)), 'host notification');
  note('Toast "Booking confirmed"; the booking row is CONFIRMED in the database (sp_confirm_booking ran).', 'Host notification: "Your service provider confirmed the booking for Probe Party (Grand Hall)".');
});

test('API', 'step 10 - double booking: a second, overlapping booking cannot be confirmed', async ({ note }) => {
  const rivalEvent = (await api('POST', '/api/events', eventBody({ name: 'Rival Party', attendee_count: 30 }), S.otherHostToken)).body.event_id;
  const request = await api('POST', '/api/bookings', { event_id: rivalEvent, venue_id: S.bigVenue, start_datetime: '2027-06-01 20:00:00', end_datetime: '2027-06-02 00:00:00' }, S.otherHostToken);
  note(`Request for an overlapping slot (20:00-00:00) answered ${request.status}.`);
  if (request.status === 201) {
    const attempt = await api('PATCH', `/api/bookings/${request.body.booking_id}/confirm`, {}, S.vendorToken);
    note(`Confirming it answered ${attempt.status}.`);
    assert.ok(attempt.status >= 400, 'confirming an overlapping booking must fail');
    const rival = (await api('GET', '/api/bookings', null, S.otherHostToken)).body.find(b => b.booking_id === request.body.booking_id);
    assert.notEqual(rival.status, 'CONFIRMED');
  } else assert.ok(request.status >= 400);
  const original = (await api('GET', '/api/bookings', null, S.hostToken)).body.find(b => b.booking_id === S.bookingId);
  assert.equal(original.status, 'CONFIRMED');
  note('The first host\'s booking is still CONFIRMED; the rival never became CONFIRMED.');
});

test('API', 'step 11 - the budget reflects the confirmed booking and a recorded expense', async ({ note }) => {
  const before = (await api('GET', `/api/events/${S.eventId}/budget`, null, S.hostToken)).body;
  assert.equal(Number(before.budget), 2000);
  assert.equal(Number(before.budget_remaining), 1500, JSON.stringify(before));
  const expense = await api('POST', `/api/events/${S.eventId}/expenses`, { description: 'Decorations', amount: 200 }, S.hostToken);
  assert.equal(expense.status, 201);
  const after = (await api('GET', `/api/events/${S.eventId}/budget`, null, S.hostToken)).body;
  assert.equal(Number(after.budget_remaining), 1300);
  assert.equal(Boolean(after.is_over_budget), false);
  assert.equal((await api('POST', `/api/events/${S.eventId}/expenses`, { description: 'Bad', amount: -5 }, S.hostToken)).status, 400);
  note('Budget 2000, confirmed venue 500 -> remaining 1500.', 'After a 200 expense -> remaining 1300, not over budget.', 'A negative expense is refused (400).');
});

test('UI', 'step 12 - the host invites a guest by email; it is delivered in the app and shown as awaiting', async ({ page, note }) => {
  await signIn(page, 'host@e2e.test', PASSWORD, 'HOST');
  await page.click('[data-view=invite].nav-item');
  await page.waitForSelector('#invite-workspace-form');
  await page.selectOption('#invite-workspace-event', String(S.eventId));
  await page.fill('#invite-workspace-form [name=emails]', 'guest@e2e.test');
  await page.click('#invite-workspace-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#invite-workspace-success')?.textContent.includes('invitation'), null, { timeout: 8000 });
  const success = await page.textContent('#invite-workspace-success');
  assert.match(success, /1 invitation saved/); assert.match(success, /1 delivered in Gather/);
  await page.waitForSelector('#invite-rsvp-list .invite-rsvp-guest');
  assert.match(await page.innerText('#invite-rsvp-list'), /guest@e2e\.test[\s\S]*Awaiting response/i);
  note(`Host sees: "${success.trim()}"`, 'Guest list shows guest@e2e.test as "Awaiting response".');
});

test('UI', 'step 13 - the guest opens the invitation: event, host, venue and map link, but no budget', async ({ page, note }) => {
  await signIn(page, 'guest@e2e.test', PASSWORD, 'INVITEE');
  await page.click('[data-view=events].nav-item');
  await page.click('.invitation-card');
  await page.waitForSelector('#invitation-details dl');
  const text = (await page.innerText('#invitation-title')) + ' ' + (await page.innerText('#invitation-details'));
  for (const expected of ['Probe Party', 'Birthday', 'June 1, 2027', '18:00', '4.00 hours', 'Hana Host', 'Grand Hall', '1 Main St, Pune']) assert.ok(text.includes(expected), `invitation shows ${expected}`);
  assert.ok(await page.$('#invitation-details a[href*="google.com/maps"]'), 'map link');
  assert.ok(!/2,?000|budget/i.test(text), 'guest must not see the budget');
  const event = (await api('GET', `/api/events/${S.eventId}`, null, S.guestToken)).body;
  assert.ok(!('budget' in event) && !('host_id' in event), 'API hides budget and host id from guests');
  assert.equal((await api('GET', `/api/events/${S.eventId}/budget`, null, S.guestToken)).status, 403);
  S.guestEvent = event;
  note('Invitation shows name, type, date, time, duration, host name, venue name and address, plus an Open map link.', 'No budget in the page; the event API response has no budget or host id; the budget endpoint is 403 for guests.');
});

test('UI', 'step 14 - the guest accepts; the host sees Accepted and is notified', async ({ page, note }) => {
  await signIn(page, 'guest@e2e.test', PASSWORD, 'INVITEE');
  await page.click('[data-view=events].nav-item');
  await page.click('.invitation-card');
  await page.click('#rsvp-accept');
  await page.waitForFunction(() => !document.querySelector('#invitation-error')?.textContent, null, { timeout: 5000 });
  await page.waitForTimeout(800);
  const rows = (await api('GET', `/api/events/${S.eventId}/invitations`, null, S.hostToken)).body;
  assert.equal(rows[0].rsvp_status, 'ACCEPTED'); assert.ok(rows[0].responded_at);
  const host = await newPage(page.context().browser());
  await signIn(host, 'host@e2e.test', PASSWORD, 'HOST');
  await host.click('[data-view=invite].nav-item');
  await host.waitForSelector('#invite-workspace-event');
  await host.selectOption('#invite-workspace-event', String(S.eventId));
  await host.waitForSelector('#invite-rsvp-list .invite-rsvp-guest');
  assert.match(await host.innerText('#invite-rsvp-list'), /Accepted/);
  assert.match(await host.innerText('#invite-rsvp-counts'), /1\s*Accepted/);
  const notes = (await api('GET', '/api/notifications', null, S.hostToken)).body;
  assert.ok(notes.some(n => /Gina Guest responded accepted/.test(n.message)));
  await host.context().close();
  assert.equal((await api('PATCH', `/api/invitations/${rows[0].invitation_id}/rsvp`, { rsvp_status: 'MAYBE' }, S.guestToken)).status, 400);
  const stranger = await registerApi('Stan Stranger', 'stranger@e2e.test', 'INVITEE');
  assert.equal((await api('PATCH', `/api/invitations/${rows[0].invitation_id}/rsvp`, { rsvp_status: 'DECLINED' }, stranger)).status, 404);
  note('Database: ACCEPTED with a response time. Host screen: "Accepted", count 1 Accepted. Host notification: "Gina Guest responded accepted ...".', 'An invalid answer ("MAYBE") is refused (400); a different guest cannot answer this invitation (404).');
});

test('API', 'step 15 - changing the date notifies the guest; an unrelated edit does not', async ({ note }) => {
  const count = async () => (await api('GET', '/api/notifications', null, S.guestToken)).body.filter(n => /date or time has changed/.test(n.message)).length;
  const before = await count();
  assert.equal((await api('PUT', `/api/events/${S.eventId}`, { name: 'Probe Party (renamed)' }, S.hostToken)).status, 200);
  assert.equal(await count(), before, 'renaming must not notify');
  assert.equal((await api('PUT', `/api/events/${S.eventId}`, { event_date: '2027-06-02' }, S.hostToken)).status, 200);
  assert.equal(await count(), before + 1, 'date change notifies once');
  assert.equal((await api('PUT', `/api/events/${S.eventId}`, { event_date: '2027-06-01', name: 'Probe Party' }, S.hostToken)).status, 200);
  note('Rename: no notification. Date moved to 2027-06-02: guest receives "The event date or time has changed...". (Date then restored.)');
});

test('API', 'step 16 - the host cancels the confirmed booking: status changes, the vendor is told, the slot opens again', async ({ note }) => {
  const search = async () => (await api('GET', `/api/venues?attendees=60&start_datetime=${encodeURIComponent('2027-06-01 18:00:00')}&end_datetime=${encodeURIComponent('2027-06-01 22:00:00')}`)).body.map(v => v.name);
  assert.ok(!(await search()).includes('Grand Hall'), 'a confirmed booking hides the venue from search');
  assert.equal((await api('PATCH', `/api/bookings/${S.bookingId}/cancel`, {}, S.hostToken)).status, 200);
  const booking = (await api('GET', '/api/bookings', null, S.hostToken)).body.find(b => b.booking_id === S.bookingId);
  assert.equal(booking.status, 'CANCELLED');
  assert.ok((await api('GET', '/api/notifications', null, S.vendorToken)).body.some(n => /cancelled the booking for/.test(n.message)));
  assert.ok((await search()).includes('Grand Hall'), 'cancelling frees the venue');
  assert.equal((await api('PATCH', `/api/bookings/${S.bookingId}/cancel`, {}, S.hostToken)).status, 400);
  assert.equal((await api('PATCH', `/api/bookings/${S.bookingId}/cancel`, {}, S.otherHostToken)).status, 403);
  note('While confirmed, Grand Hall is not offered for that time; after the cancel it is offered again.', 'Cancelling twice is refused (400); another host cannot cancel it (403). Vendor notified.');
});

test('API', 'step 17 - a reminder is sent once to a registered guest shortly before the event', async ({ note }) => {
  const db = await env.testDb();
  try {
    const [[soon]] = await db.query("SELECT DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 5 HOUR), '%Y-%m-%d') d, DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 5 HOUR), '%H:%i') t");
    const event = await api('POST', '/api/events', eventBody({ name: 'Tonight Party', event_date: soon.d, start_time: soon.t, attendee_count: 10 }), S.hostToken);
    assert.equal((await api('POST', `/api/events/${event.body.event_id}/invitations`, { invitees: [{ email: 'guest@e2e.test', name: 'Gina Guest' }] }, S.hostToken)).status, 201);
    const reminders = require('../../src/services/reminder.service');
    const first = await reminders.sendDueReminders(24);
    const second = await reminders.sendDueReminders(24);
    const mine = (await api('GET', '/api/notifications', null, S.guestToken)).body.filter(n => n.notification_type === 'EVENT_REMINDER');
    assert.equal(first.sent, 1); assert.equal(second.sent, 0);
    assert.equal(mine.length, 1); assert.match(mine[0].message, /Tonight Party/);
    note(`Event starts ${soon.d} ${soon.t}. First reminder run sent 1, second run sent 0.`, `Guest notification: "${mine[0].message}"`);
  } finally { await db.end(); }
});

// ================================================================== 4
section('Double booking and database rules');

test('API', 'two hosts confirm overlapping bookings at the same moment: exactly one wins (3 rounds)', async ({ note }) => {
  const venue = (await api('POST', '/api/venues', { name: 'Annex', address: '3 Race St, Pune', capacity: 100, base_price: 300 }, S.vendorToken)).body.venue_id;
  for (const [round, day] of ['2027-07-01', '2027-07-02', '2027-07-03'].entries()) {
    assert.equal((await api('POST', '/api/availability', slot(venue, day), S.vendorToken)).status, 201);
    const make = async (token, name, start, end) => {
      const eventId = (await api('POST', '/api/events', eventBody({ name, event_date: day, attendee_count: 30 }), token)).body.event_id;
      const booking = await api('POST', '/api/bookings', { event_id: eventId, venue_id: venue, start_datetime: `${day} ${start}`, end_datetime: `${day} ${end}` }, token);
      assert.equal(booking.status, 201, JSON.stringify(booking.body));
      return booking.body.booking_id;
    };
    const a = await make(S.hostToken, `Race A${round}`, '18:00:00', '22:00:00');
    const b = await make(S.otherHostToken, `Race B${round}`, '20:00:00', '23:00:00');
    const results = await Promise.all([a, b].map(id => api('PATCH', `/api/bookings/${id}/confirm`, {}, S.vendorToken)));
    const db = await env.testDb();
    const [rows] = await db.query('SELECT booking_id, status FROM booking WHERE booking_id IN (?, ?)', [a, b]); await db.end();
    const confirmed = rows.filter(row => row.status === 'CONFIRMED').length;
    note(`Round ${round + 1} (${day}): responses ${results.map(r => r.status).join(' and ')}; statuses ${rows.map(r => r.status).join(' / ')}.`);
    assert.equal(confirmed, 1, `round ${round + 1}: exactly one booking may be CONFIRMED, got ${confirmed}`);
  }
});

test('API', 'passwords are stored hashed, and a duplicate email is refused', async ({ note }) => {
  const db = await env.testDb();
  try {
    const [[user]] = await db.query("SELECT password_hash FROM app_user WHERE email = 'host@e2e.test'");
    assert.match(user.password_hash, /^\$2[aby]\$12\$/); assert.ok(!user.password_hash.includes(PASSWORD));
    const duplicate = await api('POST', '/api/auth/register', { name: 'Again', email: 'HOST@e2e.test', password: PASSWORD, role: 'HOST', age: 30 });
    assert.equal(duplicate.status, 409);
    const login = await api('POST', '/api/auth/login', { email: 'host@e2e.test', password: PASSWORD });
    assert.ok(!JSON.stringify(login.body).includes('password_hash'));
    note('Stored value is a bcrypt hash (cost 12), not the password.', 'Registering the same email in capitals: 409.', 'Login response never contains a password hash.');
  } finally { await db.end(); }
});

test('API', 'the database itself rejects bad rows, even if the API were bypassed', async ({ note }) => {
  const db = await env.testDb();
  const rejects = async (label, sql, params) => { await assert.rejects(db.query(sql, params), undefined, `${label} should be rejected`); note(`Rejected: ${label}`); };
  try {
    const [[{ user_id }]] = await db.query("SELECT user_id FROM app_user WHERE email = 'vendor@e2e.test'");
    await rejects('venue with capacity 0', 'INSERT INTO venue (vendor_id, name, address, capacity) VALUES (?, ?, ?, 0)', [user_id, 'Zero', 'Nowhere']);
    await rejects('venue with a negative price', 'INSERT INTO venue (vendor_id, name, address, capacity, base_price) VALUES (?, ?, ?, 10, -1)', [user_id, 'Neg', 'Nowhere']);
    await rejects('event with 0 attendees', "INSERT INTO `event` (host_id, name, event_type, event_date, start_time, duration_hours, attendee_count, budget) VALUES (?, 'x', 'x', '2027-01-01', '10:00', 1, 0, 10)", [user_id]);
    await rejects('booking that ends before it starts', "INSERT INTO booking (event_id, venue_id, start_datetime, end_datetime) VALUES (?, ?, '2027-01-01 12:00:00', '2027-01-01 10:00:00')", [S.eventId, S.bigVenue]);
    await rejects('booking pointing at no venue and no offering', "INSERT INTO booking (event_id, start_datetime, end_datetime) VALUES (?, '2027-01-01 10:00:00', '2027-01-01 12:00:00')", [S.eventId]);
    await rejects('a second user with the same email', "INSERT INTO app_user (name, email, password_hash, role, age) VALUES ('Dup', 'host@e2e.test', 'x', 'HOST', 30)", []);
  } finally { await db.end(); }
});

// ================================================================== 5
section('Responsive layout');

for (const [label, email, role] of [['host', 'host@e2e.test', 'HOST'], ['vendor', 'vendor@e2e.test', 'VENDOR'], ['guest', 'guest@e2e.test', 'INVITEE']]) {
  test('UI', `the ${label} dashboard has no sideways scrolling on a phone`, async ({ page, note }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, email, PASSWORD, role);
    await page.waitForTimeout(800);
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert.ok(scroll <= inner + 1, `page is ${scroll}px wide in a ${inner}px window`);
    note(`Viewport ${inner}px wide (iPhone 12 size); page content ${scroll}px wide.`);
  });
}

test('UI', 'the sign-in page has no sideways scrolling on a phone', async ({ page, note }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(scroll <= inner + 1, `page is ${scroll}px wide in a ${inner}px window`);
  note(`Viewport ${inner}px; content ${scroll}px.`);
});

// ------------------------------------------------------------------ run
async function main() {
  const started = Date.now();
  console.log('Creating throw-away database from the real schema...');
  await env.createTestDatabase();
  const server = await env.startServer();
  const browser = await launch();
  const version = browser.version();
  try {
    for (const group of sections) {
      for (const item of group.tests) {
        const notes = [];
        const context = { note: (...lines) => notes.push(...lines) };
        let page = null;
        if (item.kind === 'UI') { page = await newPage(browser); context.page = page; }
        const t0 = Date.now();
        let error = null;
        try {
          await item.fn(context);
          if (page?.errors.length) throw new Error(`JavaScript errors in the page: ${page.errors.join(' | ')}`);
        } catch (caught) { error = caught; }
        const ms = Date.now() - t0;
        let screenshot = null;
        if (page) { try { screenshot = (await page.screenshot({ type: 'jpeg', quality: 55 })).toString('base64'); } catch (_e) { /* page closed */ } await page.context().close(); }
        item.result = { name: item.name, kind: item.kind === 'UI' ? 'browser' : 'API / database', passed: !error, ms, notes, screenshot,
          error: error ? String(error.message || error).split('\n').slice(0, 6).join('\n') : null };
        console.log(`${error ? 'FAIL' : 'PASS'}  ${(ms / 1000).toFixed(1)}s  ${item.name}${error ? `\n      ${item.result.error.split('\n')[0]}` : ''}`);
      }
    }
  } finally {
    await browser.close();
    server.child.kill();
    await env.dropTestDatabase();
  }
  const all = sections.flatMap(group => group.tests.map(item => item.result));
  const passed = all.filter(item => item.passed).length;
  const html = buildReport({
    title: 'Gather integration and UI test report',
    meta: [
      'Module: event planning workflow (host plans an event, books a venue, vendor confirms, guest answers the invitation). Real Chrome, real server, real MySQL stored procedures, throw-away database.',
      `Run: ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · Chrome ${version} · Playwright · Node ${process.version.replace('v', '')}`
    ],
    summary: 'Click a test to see what it checked and, for browser tests, its final screenshot. The tests ran against a schema-only copy of <code>eventplanningdb</code> that was created for this run and dropped afterwards, on a second copy of the server (port 5055). Your real database and the app on port 5000 were not touched. Re-run with <code>npm run e2e</code>.',
    sections: sections.map(group => ({ title: group.title, tests: group.tests.map(item => item.result) })),
    findings: [
      '<b>Sign-in was blocked in Chrome.</b> The sign-in page set <code>pattern=""</code> on the password field, which this Chrome treats as "must match nothing", so the form never sent a request. Fixed in <code>public/login.js</code>.',
      '<b>Creating an event showed an error even though it saved.</b> After saving, the form code read <code>event.currentTarget</code> following an <code>await</code> (it is null by then), threw, and the event list did not refresh. The same mistake was in the availability and expense forms. Fixed in <code>public/app.js</code>.',
      '<b>Guests were shown the host-only "Invite guests" menu item.</b> Hidden for guests in <code>public/app.js</code>.'
    ],
    limits: [
      'Vendor listing set-up (venue, availability) and some host checks are driven through the API, not the browser forms; the vendor "My services" screens were not exercised.',
      'Email delivery is not tested (no email provider is configured; invitations are delivered in-app).',
      'Browser coverage is Chrome only; no Firefox, Safari or real phone.',
      'Sign-out clears the browser session, but tokens are stateless and stay valid until they expire.',
      'No load or performance testing.'
    ]
  });
  const out = path.join(__dirname, '../../INTEGRATION_UI_TEST_REPORT.html');
  fs.writeFileSync(out, html);
  console.log(`\n${passed}/${all.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${out}`);
  process.exit(passed === all.length ? 0 : 1);
}

main().catch(async error => { console.error(error); try { await env.dropTestDatabase(); } catch (_e) { /* ignore */ } process.exit(2); });
