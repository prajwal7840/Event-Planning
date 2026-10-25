class Entity {
  constructor(data = {}) { Object.assign(this, data); }
  static fromRow(row) { return row ? new this(row) : null; }
  toJSON() { return { ...this }; }
}

class User extends Entity {
  static fields = ['user_id', 'name', 'email', 'password_hash', 'role', 'age', 'phone', 'city', 'share_phone_with_invitees'];
  toJSON() { const { password_hash, ...safe } = this; return safe; }
}
class VendorProfile extends Entity { static fields = ['vendor_id', 'business_name', 'description', 'business_location']; }
class Event extends Entity {
  static fields = ['event_id', 'host_id', 'name', 'event_type', 'event_date', 'start_time', 'duration_hours', 'attendee_count', 'budget', 'status'];
  static validate(data) {
    if (!data.name || !data.event_type || !data.event_date || !data.start_time) return 'name, event_type, event_date and start_time are required';
    if (!Number.isFinite(Number(data.duration_hours)) || Number(data.duration_hours) <= 0) return 'duration_hours must be positive';
    if (!Number.isInteger(Number(data.attendee_count)) || Number(data.attendee_count) <= 0) return 'attendee_count must be a positive integer';
    if (!Number.isFinite(Number(data.budget)) || Number(data.budget) < 0) return 'budget must be non-negative';
    return null;
  }
}
class Invitation extends Entity {
  static fields = ['invitation_id', 'event_id', 'invitee_user_id', 'invitee_name', 'invitee_email', 'rsvp_status', 'sent_at', 'responded_at', 'delivery_status', 'delivery_error'];
  static validateRsvp(status) { return ['ACCEPTED', 'DECLINED'].includes(status) ? null : 'rsvp_status must be ACCEPTED or DECLINED'; }
}
class Venue extends Entity {
  static fields = ['venue_id', 'vendor_id', 'name', 'address', 'capacity', 'facilities', 'base_price'];
  static validate(data) {
    if (!data.name || !data.address || !Number.isInteger(Number(data.capacity)) || Number(data.capacity) <= 0) return 'Valid name, address, and positive capacity are required';
    if (data.base_price != null && (!Number.isFinite(Number(data.base_price)) || Number(data.base_price) < 0)) return 'base_price must be non-negative';
    return null;
  }
}
class VendorOffering extends Entity {
  static fields = ['offering_id', 'vendor_id', 'category', 'offering_type', 'name', 'description', 'price', 'pricing_unit', 'min_capacity', 'max_capacity', 'is_active'];
  static validate(data) {
    if (!data.category || !data.name || !['SERVICE', 'PRODUCT', 'PACKAGE'].includes(data.offering_type)) return 'category, name and valid offering_type are required';
    if (data.price != null && (!Number.isFinite(Number(data.price)) || Number(data.price) < 0)) return 'price must be non-negative';
    if (data.min_capacity != null && (!Number.isInteger(Number(data.min_capacity)) || Number(data.min_capacity) < 1)) return 'min_capacity must be a positive integer';
    if (data.max_capacity != null && (!Number.isInteger(Number(data.max_capacity)) || Number(data.max_capacity) < 1)) return 'max_capacity must be a positive integer';
    if (data.min_capacity != null && data.max_capacity != null && Number(data.min_capacity) > Number(data.max_capacity)) return 'min_capacity cannot exceed max_capacity';
    return null;
  }
}
class Booking extends Entity {
  static fields = ['booking_id', 'event_id', 'venue_id', 'offering_id', 'start_datetime', 'end_datetime', 'agreed_price', 'status', 'created_at'];
  static validate(data) {
    if (!data.event_id || (!data.venue_id && !data.offering_id) || (data.venue_id && data.offering_id) || !data.start_datetime || !data.end_datetime || new Date(data.end_datetime) <= new Date(data.start_datetime))
      return 'Provide event_id, exactly one of venue_id/offering_id and a valid time range';
    if (data.agreed_price != null && (!Number.isFinite(Number(data.agreed_price)) || Number(data.agreed_price) < 0)) return 'agreed_price must be non-negative';
    return null;
  }
}
class Notification extends Entity { static fields = ['notification_id', 'user_id', 'message', 'notification_type', 'is_read', 'created_at']; }
class AvailabilitySlot extends Entity { static fields = ['slot_id', 'venue_id', 'offering_id', 'start_datetime', 'end_datetime', 'availability_status']; }
class Expense extends Entity { static fields = ['expense_id', 'event_id', 'booking_id', 'description', 'amount', 'expense_date']; }
class EventBudgetSummary extends Entity { static fields = ['event_id', 'host_id', 'name', 'budget', 'booking_costs', 'event_level_expenses', 'committed_total', 'budget_remaining', 'is_over_budget']; }
class InviteeEvent extends Entity { static fields = ['invitation_id', 'invitee_user_id', 'invitee_email', 'rsvp_status', 'event_id', 'event_name', 'event_type', 'event_date', 'start_time', 'duration_hours']; }

module.exports = { Entity, User, VendorProfile, Event, Invitation, Venue, VendorOffering, Booking, Notification, AvailabilitySlot, Expense, EventBudgetSummary, InviteeEvent };
