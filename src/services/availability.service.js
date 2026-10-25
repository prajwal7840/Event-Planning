const { queries, availabilitySlots } = require('../repositories');
const AppError = require('../utils/appError');

function validateRange(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (!start || !end || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
    throw new AppError(400, 'Provide a valid start_datetime and end_datetime with end after start');
}

async function list(userId) { return queries.listAvailabilityForVendor(userId); }

async function create(userId, data) {
  const venueId = data.venue_id == null || data.venue_id === '' ? null : Number(data.venue_id);
  const offeringId = data.offering_id == null || data.offering_id === '' ? null : Number(data.offering_id);
  if (Boolean(venueId) === Boolean(offeringId)) throw new AppError(400, 'Choose exactly one venue_id or offering_id');
  if ([venueId, offeringId].some(value => value != null && (!Number.isSafeInteger(value) || value <= 0))) throw new AppError(400, 'Resource IDs must be positive integers');
  validateRange(data.start_datetime, data.end_datetime);
  const status = data.availability_status || 'AVAILABLE';
  if (!['AVAILABLE', 'BLOCKED'].includes(status)) throw new AppError(400, 'availability_status must be AVAILABLE or BLOCKED');
  if (!await queries.vendorOwnsResource(userId, venueId, offeringId)) throw new AppError(404, 'Venue or offering not found for this vendor');
  const resourceField = venueId ? 'venue_id' : 'offering_id';
  const resourceId = venueId || offeringId;
  if (status === 'BLOCKED' && await queries.confirmedBookingOverlaps(resourceField, resourceId, data.start_datetime, data.end_datetime))
    throw new AppError(409, 'This time overlaps a confirmed booking and cannot be blocked');
  const slot = await availabilitySlots.create({ venue_id: venueId, offering_id: offeringId,
    start_datetime: data.start_datetime, end_datetime: data.end_datetime, availability_status: status });
  return slot;
}

async function update(userId, id, data) {
  if (!await queries.findAvailabilityForVendor(id, userId)) throw new AppError(404, 'Availability slot not found');
  const changes = {};
  for (const key of ['start_datetime', 'end_datetime']) if (Object.hasOwn(data, key)) changes[key] = data[key];
  if (Object.hasOwn(data, 'availability_status')) changes.availability_status = data.availability_status;
  if (!Object.keys(changes).length) throw new AppError(400, 'No supported availability fields supplied');
  const current = await availabilitySlots.findById(id);
  validateRange(changes.start_datetime ?? current.start_datetime, changes.end_datetime ?? current.end_datetime);
  if (changes.availability_status && !['AVAILABLE', 'BLOCKED'].includes(changes.availability_status))
    throw new AppError(400, 'availability_status must be AVAILABLE or BLOCKED');
  if (changes.availability_status === 'BLOCKED') {
    const field = current.venue_id ? 'venue_id' : 'offering_id';
    const resourceId = current.venue_id || current.offering_id;
    if (await queries.confirmedBookingOverlaps(field, resourceId, changes.start_datetime ?? current.start_datetime, changes.end_datetime ?? current.end_datetime))
      throw new AppError(409, 'This time overlaps a confirmed booking and cannot be blocked');
  }
  return availabilitySlots.update(id, changes);
}

async function remove(userId, id) {
  if (!await queries.findAvailabilityForVendor(id, userId)) throw new AppError(404, 'Availability slot not found');
  const slot = await availabilitySlots.findById(id);
  const field = slot.venue_id ? 'venue_id' : 'offering_id';
  const resourceId = slot.venue_id || slot.offering_id;
  if (await queries.confirmedBookingOverlaps(field, resourceId, slot.start_datetime, slot.end_datetime))
    throw new AppError(409, 'This time slot covers a confirmed booking and cannot be removed');
  await availabilitySlots.delete(id);
  return { message: 'Availability slot removed' };
}

module.exports = { list, create, update, remove };
