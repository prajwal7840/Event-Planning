const { queries } = require('../repositories');
const Booking = require('../domain/entities').Booking;
const AppError = require('../utils/appError');

async function list(user) {
  if (!['HOST', 'VENDOR'].includes(user.role)) throw new AppError(403, 'Invitees cannot view bookings');
  return queries.listBookingsFor(user);
}

async function create(userId, data) {
  const { event_id, venue_id, offering_id, start_datetime, end_datetime, agreed_price } = data;
  const validation = Booking.validate(data);
  if (validation) throw new AppError(400, `${validation}${validation.includes('time range') ? ' and optional non-negative agreed_price' : ''}`);
  if (!await queries.hostOwnsEvent(event_id, userId)) throw new AppError(404, 'Event not found for this host');
  return queries.createBooking({ event_id, venue_id: venue_id || null, offering_id: offering_id || null, start_datetime, end_datetime,
    agreed_price: agreed_price == null ? null : Number(agreed_price) });
}

async function confirm(userId, id, agreedPrice = null) {
  if (!await queries.isPendingBookingForHost(id, userId)) throw new AppError(404, 'Pending booking not found for this host');
  if (agreedPrice != null && (!Number.isFinite(Number(agreedPrice)) || Number(agreedPrice) < 0))
    throw new AppError(400, 'agreed_price must be non-negative');
  await queries.confirmBooking(id, agreedPrice == null ? null : Number(agreedPrice));
}

async function cancel(user, id) {
  const b = await queries.findBookingForCancel(id); if (!b) throw new AppError(404, 'Booking not found');
  const allowed = (user.role === 'HOST' && Number(b.host_id) === Number(user.user_id)) ||
    (user.role === 'VENDOR' && [b.venue_vendor_id, b.offering_vendor_id].some(value => Number(value) === Number(user.user_id)));
  if (!allowed) throw new AppError(403, 'You cannot cancel this booking');
  if (['CANCELLED', 'REJECTED'].includes(b.status)) throw new AppError(400, 'Booking is already closed');
  await queries.updateBookingStatus(id, 'CANCELLED');
}

async function reject(userId, id) {
  const b = await queries.findBookingForReject(id); if (!b) throw new AppError(404, 'Booking not found');
  if (![b.venue_vendor_id, b.offering_vendor_id].some(value => Number(value) === Number(userId))) throw new AppError(403, 'This booking does not belong to your listing');
  if (b.status !== 'PENDING') throw new AppError(400, 'Only pending bookings can be rejected');
  await queries.updateBookingStatus(id, 'REJECTED');
}

module.exports = { list, create, confirm, cancel, reject };
