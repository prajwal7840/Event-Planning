// Every user journey the load test can run, with the real API endpoints it depends on.
// lib/availability.js checks these endpoints against the routes actually declared in src/routes; a scenario whose
// endpoints are missing is reported as unavailable instead of being simulated.
'use strict';

const SCENARIOS = [
  // ---- Host -------------------------------------------------------------------------------------------
  { id: 'host_browse_discovery', role: 'HOST', category: 'Browsing and discovery', defaultWeight: 35, label: 'Browse venues and services',
    description: 'Searches venues and vendor offerings with varied filters, opens recommendations for one of their events.',
    endpoints: ['GET /api/venues', 'GET /api/offerings', 'GET /api/events', 'GET /api/events/:id/recommendations'] },
  { id: 'host_event_management', role: 'HOST', category: 'Event management', defaultWeight: 25, label: 'Manage events',
    description: 'Lists, opens, creates, updates and (to keep data bounded) removes the host\'s own events.',
    endpoints: ['GET /api/events', 'GET /api/events/:id', 'GET /api/events/:id/bookings', 'POST /api/events', 'PUT /api/events/:id', 'DELETE /api/events/:id'] },
  { id: 'host_booking_flow', role: 'HOST', category: 'Booking', defaultWeight: 20, label: 'Request, review and cancel bookings',
    description: 'Finds a listing, requests a booking for one of their events, checks status, edits or cancels it.',
    endpoints: ['GET /api/events', 'GET /api/venues', 'GET /api/offerings', 'POST /api/bookings', 'GET /api/bookings', 'PATCH /api/bookings/:id', 'PATCH /api/bookings/:id/cancel'] },
  { id: 'host_expenses_budget', role: 'HOST', category: 'Expenses and budget', defaultWeight: 10, label: 'Expenses and budget',
    description: 'Checks the budget summary and adds, edits and removes expenses.',
    endpoints: ['GET /api/events', 'GET /api/events/:id/budget', 'GET /api/events/:id/expenses', 'POST /api/events/:id/expenses', 'PATCH /api/expenses/:id', 'DELETE /api/expenses/:id'] },
  { id: 'host_invitations', role: 'HOST', category: 'Invitations and RSVP', defaultWeight: 10, label: 'Invite guests and review RSVPs',
    description: 'Invites guests to an event and reviews the RSVP list.',
    endpoints: ['GET /api/events', 'POST /api/events/:id/invitations', 'GET /api/events/:id/invitations'] },
  { id: 'host_notifications', role: 'HOST', category: 'Notifications', defaultWeight: 5, label: 'Check notifications',
    description: 'Reads notifications and marks one as read.',
    endpoints: ['GET /api/notifications', 'PATCH /api/notifications/:id/read'] },
  // ---- Vendor -----------------------------------------------------------------------------------------
  { id: 'vendor_dashboard', role: 'VENDOR', category: 'Dashboard', defaultWeight: 20, label: 'Open dashboard and profile',
    description: 'Loads the vendor profile with their venues and offerings, and their availability calendar.',
    endpoints: ['GET /api/vendors/profile', 'GET /api/availability', 'GET /api/auth/profile'] },
  { id: 'vendor_booking_requests', role: 'VENDOR', category: 'Booking decisions', defaultWeight: 35, label: 'Review and decide booking requests',
    description: 'Lists incoming booking requests and confirms or rejects a pending one.',
    endpoints: ['GET /api/bookings', 'PATCH /api/bookings/:id/confirm', 'PATCH /api/bookings/:id/reject'] },
  { id: 'vendor_listing_management', role: 'VENDOR', category: 'Listings', defaultWeight: 15, label: 'Update venue and offering details',
    description: 'Changes the price of one of their own offerings or venues.',
    endpoints: ['GET /api/vendors/profile', 'PATCH /api/offerings/:id', 'PATCH /api/venues/:id'] },
  { id: 'vendor_availability', role: 'VENDOR', category: 'Availability', defaultWeight: 15, label: 'Manage availability',
    description: 'Adds, lists and removes availability time slots.',
    endpoints: ['GET /api/vendors/profile', 'GET /api/availability', 'POST /api/availability', 'DELETE /api/availability/:id'] },
  { id: 'vendor_booking_history', role: 'VENDOR', category: 'Booking history', defaultWeight: 10, label: 'Review booking history',
    description: 'Lists upcoming and past bookings.',
    endpoints: ['GET /api/bookings'] },
  { id: 'vendor_notifications', role: 'VENDOR', category: 'Notifications', defaultWeight: 5, label: 'Check notifications',
    description: 'Reads notifications and marks one as read.',
    endpoints: ['GET /api/notifications', 'PATCH /api/notifications/:id/read'] },
  // ---- Invitee ----------------------------------------------------------------------------------------
  { id: 'invitee_review_invitations', role: 'INVITEE', category: 'Invitations', defaultWeight: 40, label: 'View invitations and event details',
    description: 'Lists their invitations (with RSVP status), opens an event and its venue.',
    endpoints: ['GET /api/invitations/mine', 'GET /api/events/:id', 'GET /api/events/:id/bookings'] },
  { id: 'invitee_rsvp', role: 'INVITEE', category: 'RSVP', defaultWeight: 30, label: 'Accept or decline an invitation',
    description: 'Answers one of their invitations and re-reads the list to see the new status.',
    endpoints: ['GET /api/invitations/mine', 'PATCH /api/invitations/:id/rsvp'] },
  { id: 'invitee_browse', role: 'INVITEE', category: 'Browsing and discovery', defaultWeight: 15, label: 'Browse venues and services',
    description: 'Browses public venue and service listings.',
    endpoints: ['GET /api/venues', 'GET /api/offerings'] },
  { id: 'invitee_notifications', role: 'INVITEE', category: 'Notifications', defaultWeight: 15, label: 'Check notifications',
    description: 'Reads notifications and marks one as read.',
    endpoints: ['GET /api/notifications', 'PATCH /api/notifications/:id/read'] }
];

function defaultScenarioWeights() {
  return Object.fromEntries(SCENARIOS.map(scenario => [scenario.id, scenario.defaultWeight]));
}

module.exports = { SCENARIOS, defaultScenarioWeights };
