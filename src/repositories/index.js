const db = require('../config/db');
const DatabaseRepository = require('./database.repository');
const BaseRepository = require('./base.repository');
const ReadOnlyRepository = require('./read-only.repository');
const ApplicationRepository = require('./application.repository');
const { User, VendorProfile, Event, Invitation, Venue, VendorOffering, Booking, Notification, AvailabilitySlot, Expense, EventBudgetSummary, InviteeEvent } = require('../domain/entities');

// Each repository uses the application's shared mysql2 pool.
module.exports = {
  db: new DatabaseRepository(db),
  queries: new ApplicationRepository(db),
  users: new BaseRepository(db, 'app_user', 'user_id', User),
  vendorProfiles: new BaseRepository(db, 'vendor_profile', 'vendor_id', VendorProfile),
  events: new BaseRepository(db, 'event', 'event_id', Event),
  invitations: new BaseRepository(db, 'invitation', 'invitation_id', Invitation),
  venues: new BaseRepository(db, 'venue', 'venue_id', Venue),
  vendorOfferings: new BaseRepository(db, 'vendor_offering', 'offering_id', VendorOffering),
  bookings: new BaseRepository(db, 'booking', 'booking_id', Booking),
  notifications: new BaseRepository(db, 'notification', 'notification_id', Notification),
  availabilitySlots: new BaseRepository(db, 'availability_slot', 'slot_id', AvailabilitySlot),
  expenses: new BaseRepository(db, 'expense', 'expense_id', Expense),
  budgetSummaries: new ReadOnlyRepository(db, 'v_event_budget_summary', 'event_id', EventBudgetSummary),
  inviteeEvents: new ReadOnlyRepository(db, 'v_invitee_event', 'invitation_id', InviteeEvent)
};
