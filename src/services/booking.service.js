const { queries } = require('../repositories');
const Booking = require('../domain/entities').Booking;
const AppError = require('../utils/appError');

async function list(user, when) {
  if (!['HOST', 'VENDOR'].includes(user.role)) throw new AppError(403, 'Invitees cannot view bookings');
  if (when && !['upcoming', 'past'].includes(when)) throw new AppError(400, 'when must be upcoming or past');
  return queries.listBookingsFor(user, when || null);
}

function assertWithinCapacity(check) {
  if (!check) return;
  const attendees = Number(check.attendee_count);
  if (check.venue_capacity != null && attendees > Number(check.venue_capacity))
    throw new AppError(409, `${check.venue_name} holds ${check.venue_capacity} guests but the event expects ${attendees}`);
  if (check.max_capacity != null && attendees > Number(check.max_capacity))
    throw new AppError(409, `${check.offering_name} serves up to ${check.max_capacity} guests but the event expects ${attendees}`);
  if (check.min_capacity != null && attendees < Number(check.min_capacity))
    throw new AppError(409, `${check.offering_name} requires at least ${check.min_capacity} guests but the event expects ${attendees}`);
}

async function create(userId, data) {
  const { event_id, venue_id, offering_id, start_datetime, end_datetime, agreed_price } = data;
  const validation = Booking.validate(data);
  if (validation) throw new AppError(400, `${validation}${validation.includes('time range') ? ' and optional non-negative agreed_price' : ''}`);
  if (!await queries.hostOwnsEvent(event_id, userId)) throw new AppError(404, 'Event not found for this host');
  if (!await queries.isBookableListing(venue_id, offering_id)) throw new AppError(404, 'Venue or active service not found');
  assertWithinCapacity(await queries.getCapacityCheck({ eventId: event_id, venueId: venue_id || null, offeringId: offering_id || null }));
  const bookingId = await queries.createBooking({ event_id, venue_id: venue_id || null, offering_id: offering_id || null, start_datetime, end_datetime,
    agreed_price: agreed_price == null ? null : Number(agreed_price) });
  await queries.notifyBookingParties(bookingId, 'HOST', 'requested');
  return bookingId;
}

async function confirm(user, id, agreedPrice = null) {
  const allowed = user.role === 'HOST'
    ? await queries.isPendingBookingForHost(id, user.user_id)
    : user.role === 'VENDOR' && await queries.isPendingBookingForVendor(id, user.user_id);
  if (!allowed) throw new AppError(404, 'Pending booking not found for this account');
  if (agreedPrice != null && (!Number.isFinite(Number(agreedPrice)) || Number(agreedPrice) < 0))
    throw new AppError(400, 'agreed_price must be non-negative');
  assertWithinCapacity(await queries.getCapacityCheck({ bookingId: id }));
  const booking = await queries.getBookingContacts(id);
  const oldLocation = booking ? await queries.getConfirmedEventLocation(booking.event_id) : null;
  await queries.confirmBooking(id, agreedPrice == null ? null : Number(agreedPrice));
  await queries.notifyBookingParties(id, user.role, 'confirmed');
  if (booking?.venue_id && oldLocation !== await queries.getConfirmedEventLocation(booking.event_id))
    await queries.notifyEventInvitees(booking.event_id, 'The venue for your invitation has changed. Open the invitation to see its current location.');
}

async function cancel(user, id) {
  const b = await queries.findBookingForCancel(id); if (!b) throw new AppError(404, 'Booking not found');
  const allowed = (user.role === 'HOST' && Number(b.host_id) === Number(user.user_id)) ||
    (user.role === 'VENDOR' && [b.venue_vendor_id, b.offering_vendor_id].some(value => Number(value) === Number(user.user_id)));
  if (!allowed) throw new AppError(403, 'You cannot cancel this booking');
  if (['CANCELLED', 'REJECTED'].includes(b.status)) throw new AppError(400, 'Booking is already closed');
  const oldLocation = b.venue_vendor_id != null ? await queries.getConfirmedEventLocation(b.event_id) : null;
  await queries.updateBookingStatus(id, 'CANCELLED');
  await queries.notifyBookingParties(id, user.role, 'cancelled');
  if (b.venue_vendor_id != null && oldLocation !== await queries.getConfirmedEventLocation(b.event_id))
    await queries.notifyEventInvitees(b.event_id, 'The venue for your invitation has changed. Open the invitation to see its current location.');
}

async function updatePending(user, id, data) {
  if (user.role !== 'HOST') throw new AppError(403, 'Only the event host can request a booking change');
  const booking = await queries.findBookingForCancel(id);
  if (!booking || Number(booking.host_id) !== Number(user.user_id)) throw new AppError(404, 'Booking not found for this host');
  if (booking.status !== 'PENDING') throw new AppError(409, 'Only pending bookings can be changed. Cancel and submit a new request for a confirmed booking.');
  const changes = {};
  if (Object.hasOwn(data, 'start_datetime')) changes.start_datetime = data.start_datetime;
  if (Object.hasOwn(data, 'end_datetime')) changes.end_datetime = data.end_datetime;
  if (Object.hasOwn(data, 'agreed_price')) changes.agreed_price = data.agreed_price == null || data.agreed_price === '' ? null : Number(data.agreed_price);
  const start = new Date(changes.start_datetime ?? booking.start_datetime);
  const end = new Date(changes.end_datetime ?? booking.end_datetime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new AppError(400, 'Provide a valid booking time range');
  if (changes.agreed_price != null && (!Number.isFinite(changes.agreed_price) || changes.agreed_price < 0)) throw new AppError(400, 'agreed_price must be non-negative');
  if (!Object.keys(changes).length) throw new AppError(400, 'Provide a new time or agreed price');
  if (!await queries.updatePendingBookingForHost(id, user.user_id, changes)) throw new AppError(409, 'Booking could not be updated');
  await queries.notifyBookingParties(id, 'HOST', 'updated');
  return { message: 'Pending booking request updated' };
}

async function reject(userId, id) {
  const b = await queries.findBookingForReject(id); if (!b) throw new AppError(404, 'Booking not found');
  if (![b.venue_vendor_id, b.offering_vendor_id].some(value => Number(value) === Number(userId))) throw new AppError(403, 'This booking does not belong to your listing');
  if (b.status !== 'PENDING') throw new AppError(400, 'Only pending bookings can be rejected');
  await queries.updateBookingStatus(id, 'REJECTED');
  await queries.notifyBookingParties(id, 'VENDOR', 'rejected');
}

module.exports = { list, create, confirm, cancel, updatePending, reject };
