const { queries, venues, vendorOfferings, vendorProfiles } = require('../repositories');
const { Venue, VendorOffering } = require('../domain/entities');
const AppError = require('../utils/appError');

async function searchVenues(query) {
  return queries.searchVenues(query);
}

async function searchOfferings(query) {
  return queries.searchOfferings(query);
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

module.exports = { searchVenues, searchOfferings, createVenue, createOffering, saveVendorProfile };
