// User journeys. Each scenario returns an ordered list of steps; the runner randomises length, order of independent
// reads and early exits. Dependent steps (create event -> book it) always stay in order.
import { call, DATA, CONFIG, formatDateTime, parseDateTime, randomDate, query, negativeChecks } from './runtime.js';

const CATEGORIES = ['Catering', 'Decoration', 'Photography', 'Music', 'Event Management'];
const LOCATIONS = ['Pune', 'Main', 'Street', 'Hall', 'Garden'];
// Statuses that are legitimate answers to a racing or rule-checked request (counted as business refusals, not errors).
const BUSINESS = [400, 404, 409];

const pickEvent = vu => (vu.events.length ? vu.rng.pick(vu.events) : null);
const ensureEvents = vu => { if (!vu.events.length) listEvents(vu); return vu.events.length > 0; };

// ---------------------------------------------------------------- shared steps
function listEvents(vu) {
  const r = call(vu, 'GET /api/events', 'GET', '/api/events', null, [200]);
  const list = r.ok ? r.json() : null;
  if (Array.isArray(list)) vu.events = list;
}
function notificationsStep(vu) {
  const r = call(vu, 'GET /api/notifications', 'GET', '/api/notifications', null, [200]);
  const list = r.ok ? r.json() : null;
  const unread = Array.isArray(list) ? list.filter(n => !n.is_read) : [];
  if (unread.length && vu.rng.chance(0.6)) call(vu, 'PATCH /api/notifications/:id/read', 'PATCH', `/api/notifications/${vu.rng.pick(unread).notification_id}/read`, {}, [200, 404]);
}
function searchVenues(vu) {
  const rng = vu.rng;
  const params = { attendees: rng.chance(0.7) ? rng.int(10, 200) : '', max_price: rng.chance(0.5) ? rng.int(300, 5000) : '', location: rng.chance(0.25) ? rng.pick(LOCATIONS) : '' };
  if (rng.chance(0.4)) {
    const day = randomDate(rng, 2030, 1, 12);
    const start = rng.int(8, 18);
    params.start_datetime = `${day} ${String(start).padStart(2, '0')}:00:00`;
    params.end_datetime = `${day} ${String(start + rng.int(2, 5)).padStart(2, '0')}:00:00`;
  }
  call(vu, 'GET /api/venues', 'GET', `/api/venues${query(params)}`, null, [200]);
}
function searchOfferings(vu) {
  const rng = vu.rng;
  call(vu, 'GET /api/offerings', 'GET', `/api/offerings${query({ category: rng.chance(0.7) ? rng.pick(CATEGORIES) : '', attendees: rng.chance(0.5) ? rng.int(10, 200) : '', max_price: rng.chance(0.4) ? rng.int(10, 3000) : '' })}`, null, [200]);
}
function profileStep(vu) { call(vu, 'GET /api/auth/profile', 'GET', '/api/auth/profile', null, [200]); }

// ---------------------------------------------------------------- host
function bookingTimes(event) {
  const start = parseDateTime(event.event_date, event.start_time);
  return { start_datetime: formatDateTime(start), end_datetime: formatDateTime(start + Math.max(1, Number(event.duration_hours) || 2) * 3600000) };
}
function newEventBody(vu) {
  const rng = vu.rng;
  return { name: `LT ${vu.id}-${rng.int(1000, 9999)}`, event_type: rng.pick(['Birthday', 'Wedding', 'Reunion', 'Corporate', 'Conference']),
    event_date: randomDate(rng, 2030, 1, 12), start_time: `${String(rng.int(9, 18)).padStart(2, '0')}:00`, duration_hours: rng.int(2, 8),
    attendee_count: rng.int(10, 150), budget: rng.int(1000, 20000) };
}
function keepBounded(vu, list, deleteFn) { while (list.length >= CONFIG.data.maxCreatedPerUser) deleteFn(vu, list.shift()); }

function createEventStep(vu) {
  keepBounded(vu, vu.created.events, (u, id) => {
    call(u, 'DELETE /api/events/:id', 'DELETE', `/api/events/${id}`, null, [200, 404]);
    u.events = u.events.filter(e => e.event_id !== id);
  });
  const body = newEventBody(vu);
  const r = call(vu, 'POST /api/events', 'POST', '/api/events', body, [201]);
  const data = r.ok ? r.json() : null;
  if (data && data.event_id) { vu.created.events.push(data.event_id); vu.events.push({ event_id: data.event_id, ...body }); }
}
function viewEventStep(vu) {
  if (!ensureEvents(vu)) return;
  const e = pickEvent(vu);
  call(vu, 'GET /api/events/:id', 'GET', `/api/events/${e.event_id}`, null, [200, 404]);
}
function updateEventStep(vu) {
  if (!ensureEvents(vu)) return;
  const e = pickEvent(vu);
  const body = vu.rng.chance(0.5) ? { budget: vu.rng.int(1000, 20000) } : vu.rng.chance(0.5) ? { attendee_count: vu.rng.int(10, 150) } : { name: `LT ${vu.id}-${vu.rng.int(1000, 9999)}` };
  call(vu, 'PUT /api/events/:id', 'PUT', `/api/events/${e.event_id}`, body, [200, 404]);
}
function eventBookingsStep(vu) {
  if (!ensureEvents(vu)) return;
  call(vu, 'GET /api/events/:id/bookings', 'GET', `/api/events/${pickEvent(vu).event_id}/bookings`, null, [200]);
}
function recommendationsStep(vu) {
  if (!ensureEvents(vu)) return;
  call(vu, 'GET /api/events/:id/recommendations', 'GET', `/api/events/${pickEvent(vu).event_id}/recommendations`, null, [200, 404]);
}
function createBookingStep(vu) {
  if (!ensureEvents(vu)) return;
  const e = pickEvent(vu);
  const wantVenue = vu.rng.chance(0.55) && DATA.venues.length;
  const body = { event_id: e.event_id, ...bookingTimes(e) };
  if (wantVenue) {
    const fits = DATA.venues.filter(v => v.capacity >= Number(e.attendee_count));
    body.venue_id = vu.rng.pick(fits.length && vu.rng.chance(0.85) ? fits : DATA.venues).venue_id;
  } else if (DATA.offerings.length) body.offering_id = vu.rng.pick(DATA.offerings).offering_id;
  else return;
  const r = call(vu, 'POST /api/bookings', 'POST', '/api/bookings', body, [201, 409]);
  if (r.ok && r.status === 201) { const d = r.json(); if (d && d.booking_id) vu.bookings.push({ booking_id: d.booking_id, status: 'PENDING' }); }
}
function listBookingsStep(vu) {
  const r = call(vu, 'GET /api/bookings', 'GET', '/api/bookings', null, [200]);
  const list = r.ok ? r.json() : null;
  if (Array.isArray(list)) vu.bookings = list;
}
function cancelBookingStep(vu) {
  const open = vu.bookings.filter(b => b.status === 'PENDING' || b.status === 'CONFIRMED');
  if (!open.length) return;
  const b = vu.rng.pick(open);
  const r = call(vu, 'PATCH /api/bookings/:id/cancel', 'PATCH', `/api/bookings/${b.booking_id}/cancel`, {}, [200, 400, 403, 404]);
  if (r.status === 200) b.status = 'CANCELLED';
}
function editBookingStep(vu) {
  const pending = vu.bookings.filter(b => b.status === 'PENDING');
  if (!pending.length) return;
  call(vu, 'PATCH /api/bookings/:id', 'PATCH', `/api/bookings/${vu.rng.pick(pending).booking_id}`, { agreed_price: vu.rng.int(100, 5000) }, [200, 404, 409]);
}
function budgetStep(vu) {
  if (!ensureEvents(vu)) return;
  call(vu, 'GET /api/events/:id/budget', 'GET', `/api/events/${pickEvent(vu).event_id}/budget`, null, [200, 404]);
}
function listExpensesStep(vu) {
  if (!ensureEvents(vu)) return;
  call(vu, 'GET /api/events/:id/expenses', 'GET', `/api/events/${pickEvent(vu).event_id}/expenses`, null, [200]);
}
function addExpenseStep(vu) {
  if (!ensureEvents(vu)) return;
  keepBounded(vu, vu.created.expenses, (u, id) => call(u, 'DELETE /api/expenses/:id', 'DELETE', `/api/expenses/${id}`, null, [200, 404]));
  const e = pickEvent(vu);
  const r = call(vu, 'POST /api/events/:id/expenses', 'POST', `/api/events/${e.event_id}/expenses`,
    { description: vu.rng.pick(['Flowers', 'Music', 'Cake', 'Lighting', 'Decor', 'Photographer deposit']), amount: vu.rng.int(20, 800), expense_date: '2030-01-15' }, [201]);
  const d = r.ok ? r.json() : null;
  if (d && d.expense_id) vu.created.expenses.push(d.expense_id);
}
function editExpenseStep(vu) {
  if (!vu.created.expenses.length) return;
  call(vu, 'PATCH /api/expenses/:id', 'PATCH', `/api/expenses/${vu.rng.pick(vu.created.expenses)}`, { amount: vu.rng.int(20, 800) }, [200, 404]);
}
function inviteStep(vu) {
  if (!ensureEvents(vu) || !DATA.inviteeEmails.length) return;
  const count = vu.rng.int(1, 3);
  const invitees = [];
  for (let i = 0; i < count; i += 1) { const email = vu.rng.pick(DATA.inviteeEmails); invitees.push({ name: email.split('@')[0], email }); }
  call(vu, 'POST /api/events/:id/invitations', 'POST', `/api/events/${pickEvent(vu).event_id}/invitations`, { invitees }, [201, 409]);
}
function listInvitationsStep(vu) {
  if (!ensureEvents(vu)) return;
  call(vu, 'GET /api/events/:id/invitations', 'GET', `/api/events/${pickEvent(vu).event_id}/invitations`, null, [200]);
}

// ---------------------------------------------------------------- vendor
function vendorProfileStep(vu) {
  const r = call(vu, 'GET /api/vendors/profile', 'GET', '/api/vendors/profile', null, [200]);
  const d = r.ok ? r.json() : null;
  if (d) vu.vendor = d;
}
const ensureVendor = vu => { if (!vu.vendor) vendorProfileStep(vu); return vu.vendor; };
function availabilityListStep(vu) { call(vu, 'GET /api/availability', 'GET', '/api/availability', null, [200]); }
function vendorBookingsStep(vu, when) {
  const r = call(vu, 'GET /api/bookings', 'GET', `/api/bookings${query({ when })}`, null, [200]);
  const list = r.ok ? r.json() : null;
  if (Array.isArray(list)) vu.bookings = list;
}
function decideBookingStep(vu) {
  const pending = vu.bookings.filter(b => b.status === 'PENDING');
  if (!pending.length) return;
  const b = vu.rng.pick(pending);
  if (vu.rng.chance(0.7)) {
    const r = call(vu, 'PATCH /api/bookings/:id/confirm', 'PATCH', `/api/bookings/${b.booking_id}/confirm`, vu.rng.chance(0.5) ? { agreed_price: vu.rng.int(100, 5000) } : {}, [200, ...BUSINESS, 500]);
    if (r.status === 200) b.status = 'CONFIRMED';
  } else {
    const r = call(vu, 'PATCH /api/bookings/:id/reject', 'PATCH', `/api/bookings/${b.booking_id}/reject`, {}, [200, 400, 403, 404]);
    if (r.status === 200) b.status = 'REJECTED';
  }
}
function updateOfferingStep(vu) {
  const v = ensureVendor(vu);
  if (!v || !v.offerings || !v.offerings.length) return;
  const o = vu.rng.pick(v.offerings);
  call(vu, 'PATCH /api/offerings/:id', 'PATCH', `/api/offerings/${o.offering_id}`, { price: Math.max(1, Math.round(Number(o.price || 100) * vu.rng.float(0.9, 1.1))) }, [200, 409]);
}
function updateVenueStep(vu) {
  const v = ensureVendor(vu);
  if (!v || !v.venues || !v.venues.length) return;
  const venue = vu.rng.pick(v.venues);
  call(vu, 'PATCH /api/venues/:id', 'PATCH', `/api/venues/${venue.venue_id}`, { base_price: Math.max(1, Math.round(Number(venue.base_price || 500) * vu.rng.float(0.9, 1.1))) }, [200, 409]);
}
function addSlotStep(vu) {
  const v = ensureVendor(vu);
  if (!v) return;
  const resources = [...(v.venues || []).map(x => ({ venue_id: x.venue_id })), ...(v.offerings || []).map(x => ({ offering_id: x.offering_id }))];
  if (!resources.length) return;
  keepBounded(vu, vu.created.slots, (u, id) => call(u, 'DELETE /api/availability/:id', 'DELETE', `/api/availability/${id}`, null, [200, 404, 409]));
  const day = randomDate(vu.rng, 2031, 1, 12);
  const r = call(vu, 'POST /api/availability', 'POST', '/api/availability', { ...vu.rng.pick(resources), start_datetime: `${day} 08:00:00`, end_datetime: `${day} 20:00:00`, availability_status: 'AVAILABLE' }, [201]);
  const d = r.ok ? r.json() : null;
  if (d && d.slot_id) vu.created.slots.push(d.slot_id);
}

// ---------------------------------------------------------------- invitee
function myInvitationsStep(vu) {
  const r = call(vu, 'GET /api/invitations/mine', 'GET', '/api/invitations/mine', null, [200]);
  const list = r.ok ? r.json() : null;
  if (Array.isArray(list)) vu.invitations = list;
}
function inviteeEventStep(vu) {
  if (!vu.invitations.length) myInvitationsStep(vu);
  if (!vu.invitations.length) return;
  call(vu, 'GET /api/events/:id', 'GET', `/api/events/${vu.rng.pick(vu.invitations).event_id}`, null, [200, 403, 404]);
}
function inviteeVenueStep(vu) {
  if (!vu.invitations.length) return;
  call(vu, 'GET /api/events/:id/bookings', 'GET', `/api/events/${vu.rng.pick(vu.invitations).event_id}/bookings`, null, [200, 403]);
}
function rsvpStep(vu) {
  if (!vu.invitations.length) myInvitationsStep(vu);
  if (!vu.invitations.length) return;
  const invite = vu.rng.pick(vu.invitations);
  const answer = vu.rng.chance(0.7) ? 'ACCEPTED' : 'DECLINED';
  const r = call(vu, 'PATCH /api/invitations/:id/rsvp', 'PATCH', `/api/invitations/${invite.invitation_id}/rsvp`, { rsvp_status: answer }, [200, 404]);
  if (r.status === 200) invite.rsvp_status = answer;
}

// ---------------------------------------------------------------- scenarios
// step: [name, fn, options]  options: { shuffle: 'group', optional: probability of being included }
const S = (name, fn, options) => ({ name, fn, ...(options || {}) });
export const SCENARIO_STEPS = {
  host_browse_discovery: () => [S('searchVenues', searchVenues, { shuffle: 'a' }), S('searchOfferings', searchOfferings, { shuffle: 'a' }), S('listEvents', listEvents, { shuffle: 'a' }),
    S('searchVenues2', searchVenues, { optional: 0.5 }), S('recommendations', recommendationsStep, { optional: 0.6 })],
  host_event_management: () => [S('listEvents', listEvents), S('viewEvent', viewEventStep), S('eventBookings', eventBookingsStep, { optional: 0.6 }),
    S('createEvent', createEventStep, { optional: 0.45 }), S('updateEvent', updateEventStep, { optional: 0.6 }), S('viewEvent2', viewEventStep, { optional: 0.4 })],
  host_booking_flow: () => [S('listEvents', listEvents), S('searchVenues', searchVenues, { shuffle: 'a' }), S('searchOfferings', searchOfferings, { shuffle: 'a' }),
    S('createBooking', createBookingStep), S('listBookings', listBookingsStep), S('editBooking', editBookingStep, { optional: 0.3 }), S('cancelBooking', cancelBookingStep, { optional: 0.3 })],
  host_expenses_budget: () => [S('listEvents', listEvents), S('budget', budgetStep), S('listExpenses', listExpensesStep, { optional: 0.7 }),
    S('addExpense', addExpenseStep, { optional: 0.7 }), S('budgetAgain', budgetStep, { optional: 0.6 }), S('editExpense', editExpenseStep, { optional: 0.35 })],
  host_invitations: () => [S('listEvents', listEvents), S('invite', inviteStep, { optional: 0.8 }), S('listInvitations', listInvitationsStep)],
  host_notifications: () => [S('notifications', notificationsStep), S('profile', profileStep, { optional: 0.4 })],
  vendor_dashboard: () => [S('vendorProfile', vendorProfileStep, { shuffle: 'a' }), S('availability', availabilityListStep, { shuffle: 'a' }), S('profile', profileStep, { shuffle: 'a', optional: 0.5 })],
  vendor_booking_requests: () => [S('bookings', vu => vendorBookingsStep(vu)), S('decide', decideBookingStep, { optional: 0.8 }), S('bookingsAgain', vu => vendorBookingsStep(vu), { optional: 0.5 }), S('decide2', decideBookingStep, { optional: 0.3 })],
  vendor_listing_management: () => [S('vendorProfile', vendorProfileStep), S('updateOffering', updateOfferingStep, { optional: 0.7 }), S('updateVenue', updateVenueStep, { optional: 0.5 })],
  vendor_availability: () => [S('vendorProfile', vendorProfileStep), S('availability', availabilityListStep), S('addSlot', addSlotStep, { optional: 0.7 }), S('availabilityAgain', availabilityListStep, { optional: 0.4 })],
  vendor_booking_history: () => [S('upcoming', vu => vendorBookingsStep(vu, 'upcoming'), { shuffle: 'a' }), S('past', vu => vendorBookingsStep(vu, 'past'), { shuffle: 'a' }), S('all', vu => vendorBookingsStep(vu), { optional: 0.4 })],
  vendor_notifications: () => [S('notifications', notificationsStep), S('profile', profileStep, { optional: 0.4 })],
  invitee_review_invitations: () => [S('invitations', myInvitationsStep), S('event', inviteeEventStep), S('venue', inviteeVenueStep, { optional: 0.7 }), S('event2', inviteeEventStep, { optional: 0.4 })],
  invitee_rsvp: () => [S('invitations', myInvitationsStep), S('rsvp', rsvpStep), S('invitationsAgain', myInvitationsStep, { optional: 0.8 })],
  invitee_browse: () => [S('venues', searchVenues, { shuffle: 'a' }), S('offerings', searchOfferings, { shuffle: 'a' })],
  invitee_notifications: () => [S('notifications', notificationsStep), S('invitations', myInvitationsStep, { optional: 0.5 })]
};

// Intentionally invalid or forbidden requests. Only used when negative testing is enabled.
export function negativeStep(vu) {
  if (!CONFIG.negativeTesting.enabled || !vu.rng.chance(CONFIG.negativeTesting.rate)) return;
  vu.journey = `${vu.journey}`;
  const kind = vu.rng.int(1, 4);
  negativeChecks.add(1, { kind: String(kind) });
  if (kind === 1) call(vu, 'NEGATIVE GET /api/events/:id (missing)', 'GET', '/api/events/999999999', null, [403, 404]);
  else if (kind === 2) call(vu, 'NEGATIVE POST /api/events (invalid)', 'POST', '/api/events', { name: '', attendee_count: 0 }, [400, 403]);
  else if (kind === 3) call(vu, 'NEGATIVE GET /api/availability (wrong role)', 'GET', '/api/availability', null, vu.role === 'VENDOR' ? [200] : [403]);
  else call(vu, 'NEGATIVE PATCH /api/bookings/:id/confirm (not mine)', 'PATCH', '/api/bookings/999999999/confirm', {}, [403, 404]);
}
