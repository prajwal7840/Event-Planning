const { queries, events, venues, vendorOfferings, vendorProfiles } = require('../repositories');
const { Venue, VendorOffering } = require('../domain/entities');
const AppError = require('../utils/appError');

async function searchVenues(query) {
  validateSearchTime(query);
  return queries.searchVenues(query);
}

async function searchOfferings(query) {
  validateSearchTime(query);
  return queries.searchOfferings(query);
}

function validateSearchTime(query) {
  const hasStart = Boolean(query.start_datetime);
  const hasEnd = Boolean(query.end_datetime);
  if (hasStart !== hasEnd) throw new AppError(400, 'Provide both start_datetime and end_datetime');
  if (hasStart && (Number.isNaN(Date.parse(query.start_datetime)) || Number.isNaN(Date.parse(query.end_datetime)) || new Date(query.end_datetime) <= new Date(query.start_datetime)))
    throw new AppError(400, 'Provide a valid availability time range');
}

function eventWindow(event) {
  const date = String(event.event_date).slice(0, 10);
  const time = String(event.start_time).slice(0, 8).padEnd(8, ':00').slice(0, 8);
  const start = new Date(`${date}T${time}Z`);
  const end = new Date(start.getTime() + Number(event.duration_hours) * 3600000);
  const format = value => value.toISOString().slice(0, 19).replace('T', ' ');
  return { start_datetime: format(start), end_datetime: format(end) };
}

async function recommendForEvent(userId, eventId) {
  const event = await events.findById(eventId);
  if (!event || Number(event.host_id) !== Number(userId)) throw new AppError(404, 'Event not found');
  const criteria = { attendees: event.attendee_count, max_price: event.budget, ...eventWindow(event) };
  const [venueMatches, offeringMatches] = await Promise.all([queries.searchVenues(criteria), queries.searchOfferings(criteria)]);
  const budget = Number(event.budget);
  const share = price => (price == null || !budget ? null : Number((Number(price) / budget).toFixed(2)));
  const venuesOut = venueMatches.map(venue => ({ ...venue, budget_share: share(venue.base_price) }));
  const offeringsOut = offeringMatches.map(offering => ({ ...offering, budget_share: share(offering.price) }));
  const message = venuesOut.length || offeringsOut.length ? null : "No venues or vendors match this event's budget, guest count, date and duration.";
  return { event_id: event.event_id, criteria, venues: venuesOut, offerings: offeringsOut, message };
}

async function createVenue(userId, data) {
  const validation = Venue.validate(data);
  if (validation) throw new AppError(400, validation);
  const venue = await venues.create({ vendor_id: userId, name: data.name, address: data.address, capacity: Number(data.capacity),
    facilities: data.facilities == null ? null : JSON.stringify(data.facilities), base_price: data.base_price == null ? null : Number(data.base_price) });
  return venue.venue_id;
}

async function saveVendorProfile(userId, data) {
  const businessName = String(data.business_name || '').trim();
  if (!businessName) throw new AppError(400, 'business_name is required');
  const profileData = {
    business_name: businessName,
    description: data.description ? String(data.description).trim() : null,
    business_location: data.business_location ? String(data.business_location).trim() : null
  };
  const existing = await vendorProfiles.findById(userId);
  if (existing) return vendorProfiles.update(userId, profileData);
  return vendorProfiles.create({ vendor_id: userId, ...profileData });
}

async function createOffering(userId, data) {
  const validation = VendorOffering.validate(data);
  if (validation) throw new AppError(400, validation);
  const offering = await vendorOfferings.create({ vendor_id: userId, category: data.category, offering_type: data.offering_type,
    name: data.name, description: data.description || null, price: data.price == null ? null : Number(data.price),
    pricing_unit: data.pricing_unit || null, min_capacity: data.min_capacity == null ? null : Number(data.min_capacity),
    max_capacity: data.max_capacity == null ? null : Number(data.max_capacity) });
  return offering.offering_id;
}

async function vendorData(userId) {
  const [profile, resources] = await Promise.all([vendorProfiles.findById(userId), queries.listVendorResources(userId)]);
  return { profile, ...resources };
}

async function updateOffering(userId, id, data) {
  const current = await vendorOfferings.findById(id);
  if (!current || Number(current.vendor_id) !== Number(userId)) throw new AppError(404, 'Offering not found');
  const allowed = ['category', 'offering_type', 'name', 'description', 'price', 'pricing_unit', 'min_capacity', 'max_capacity', 'is_active'];
  const changes = Object.fromEntries(allowed.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  const merged = { ...current, ...changes };
  const validation = VendorOffering.validate(merged);
  if (validation) throw new AppError(400, validation);
  if (merged.min_capacity != null && merged.max_capacity != null && Number(merged.min_capacity) > Number(merged.max_capacity))
    throw new AppError(400, 'min_capacity cannot exceed max_capacity');
  if (!Object.keys(changes).length) throw new AppError(400, 'No supported fields supplied');
  const terms = ['category', 'offering_type', 'name', 'description', 'price', 'pricing_unit', 'min_capacity', 'max_capacity'];
  if (Object.keys(changes).some(key => terms.includes(key)) && await queries.hasOpenBookingForResource('offering_id', id))
    throw new AppError(409, 'Listing terms cannot change while pending or confirmed bookings exist');
  if (Object.hasOwn(changes, 'is_active') && typeof changes.is_active !== 'boolean') throw new AppError(400, 'is_active must be a boolean');
  return vendorOfferings.updateWhere(id, changes, { vendor_id: userId });
}

async function deleteOffering(userId, id) {
  const current = await vendorOfferings.findById(id);
  if (!current || Number(current.vendor_id) !== Number(userId)) throw new AppError(404, 'Offering not found');
  if (await queries.hasBookingForOffering(id)) throw new AppError(409, 'This offering has booking history; deactivate it instead');
  await vendorOfferings.updateWhere(id, { is_active: false }, { vendor_id: userId });
  return { message: 'Offering deactivated' };
}

async function updateVenue(userId, id, data) {
  const current = await venues.findById(id);
  if (!current || Number(current.vendor_id) !== Number(userId)) throw new AppError(404, 'Venue not found');
  const allowed = ['name', 'address', 'capacity', 'facilities', 'base_price'];
  const changes = Object.fromEntries(allowed.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  const merged = { ...current, ...changes };
  const validation = Venue.validate(merged);
  if (validation) throw new AppError(400, validation);
  if (!Object.keys(changes).length) throw new AppError(400, 'No supported fields supplied');
  if (await queries.hasOpenBookingForResource('venue_id', id)) throw new AppError(409, 'Venue details cannot change while pending or confirmed bookings exist');
  if (Object.hasOwn(changes, 'facilities') && changes.facilities != null) changes.facilities = JSON.stringify(changes.facilities);
  return venues.updateWhere(id, changes, { vendor_id: userId });
}

async function deleteVenue(userId, id) {
  const current = await venues.findById(id);
  if (!current || Number(current.vendor_id) !== Number(userId)) throw new AppError(404, 'Venue not found');
  if (await queries.hasBookingForVenue(id)) throw new AppError(409, 'This venue has booking history; remove its availability instead');
  await venues.deleteWhere(id, { vendor_id: userId });
  return { message: 'Venue deleted' };
}

module.exports = { recommendForEvent, searchVenues, searchOfferings, createVenue, createOffering, saveVendorProfile, vendorData, updateOffering, deleteOffering, updateVenue, deleteVenue };
