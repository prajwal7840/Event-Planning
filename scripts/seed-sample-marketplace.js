require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const demoEmail = 'gather-sample-vendor@example.invalid';
const businessName = 'Gather Demo Collection (Sample Listings)';
const demoPassword = 'GatherVendor2026!';

const venues = [
  {
    name: 'Willow Courtyard',
    address: 'Sample venue listing, Amravati',
    capacity: 90,
    facilities: ['Garden', 'Outdoor seating', 'Parking'],
    base_price: 18000
  },
  {
    name: 'Riverside Studio',
    address: 'Sample venue listing, Amravati',
    capacity: 45,
    facilities: ['Indoor hall', 'Catering preparation area', 'Sound system'],
    base_price: 12000
  },
  {
    name: 'Maple Grove Lawn',
    address: 'Sample venue listing, Amravati',
    capacity: 160,
    facilities: ['Open lawn', 'Parking', 'Power backup'],
    base_price: 30000
  },
  {
    name: 'The Glasshouse at Sunrise',
    address: 'Sample venue listing, Amravati',
    capacity: 75,
    facilities: ['Glasshouse', 'Garden', 'Natural light'],
    base_price: 22000
  },
  {
    name: 'Old Town Banquet Hall',
    address: 'Sample venue listing, Amravati',
    capacity: 220,
    facilities: ['Indoor hall', 'Stage', 'Parking', 'Air conditioning'],
    base_price: 48000
  },
  {
    name: 'Blue Heron Lakeside Deck',
    address: 'Sample venue listing, Amravati',
    capacity: 60,
    facilities: ['Lakeside', 'Outdoor seating', 'Power backup'],
    base_price: 16000
  },
  {
    name: 'The Copper Terrace',
    address: 'Sample venue listing, Amravati',
    capacity: 110,
    facilities: ['Rooftop', 'City view', 'Sound system'],
    base_price: 27500
  },
  {
    name: 'Cedar Conference Pavilion',
    address: 'Sample venue listing, Amravati',
    capacity: 180,
    facilities: ['Conference room', 'Projector', 'Wi-Fi', 'Parking'],
    base_price: 36000
  }
];

const offerings = [
  {
    category: 'Catering', offering_type: 'PACKAGE', name: 'Gather & Graze Buffet',
    description: 'Sample catering package for exploring the Gather marketplace.',
    price: 850, pricing_unit: 'per guest', min_capacity: 20, max_capacity: 200
  },
  {
    category: 'Photography', offering_type: 'SERVICE', name: 'Golden Hour Photography',
    description: 'Sample event photography service for exploring the Gather marketplace.',
    price: 12000, pricing_unit: 'per event', min_capacity: 10, max_capacity: 250
  },
  {
    category: 'Decoration', offering_type: 'PACKAGE', name: 'Petal & Stem Decor',
    description: 'Sample floral decor package for exploring the Gather marketplace.',
    price: 8500, pricing_unit: 'per event', min_capacity: 10, max_capacity: 180
  },
  {
    category: 'Music', offering_type: 'SERVICE', name: 'The Sunday Acoustic Duo',
    description: 'Sample live music service for dinners, weddings, and private parties.',
    price: 15000, pricing_unit: 'per event', min_capacity: 20, max_capacity: 200
  },
  {
    category: 'Bakery', offering_type: 'PRODUCT', name: 'Little Celebration Cake',
    description: 'Sample custom cake listing with a choice of celebration flavours.',
    price: 3500, pricing_unit: 'per cake', min_capacity: 10, max_capacity: 100
  },
  {
    category: 'Rentals', offering_type: 'SERVICE', name: 'Gather Table & Chair Set',
    description: 'Sample event furniture rental package for seated gatherings.',
    price: 9500, pricing_unit: 'per event', min_capacity: 20, max_capacity: 180
  },
  {
    category: 'Lighting', offering_type: 'PACKAGE', name: 'Warm Lights Installation',
    description: 'Sample string-light and ambient lighting package for evening events.',
    price: 7000, pricing_unit: 'per event', min_capacity: 15, max_capacity: 160
  },
  {
    category: 'Sound', offering_type: 'SERVICE', name: 'Clear Sound Event Setup',
    description: 'Sample microphone and speaker setup for presentations and celebrations.',
    price: 6000, pricing_unit: 'per event', min_capacity: 25, max_capacity: 250
  }
];

async function ensureVendor(connection) {
  const [users] = await connection.execute(
    'SELECT user_id, role FROM app_user WHERE email = ? LIMIT 1', [demoEmail]
  );
  if (users.length) {
    if (users[0].role !== 'VENDOR') throw new Error(`The sample email ${demoEmail} belongs to a non-vendor account.`);
    const passwordHash = await bcrypt.hash(demoPassword, 12);
    await connection.execute('UPDATE app_user SET password_hash = ? WHERE user_id = ?', [passwordHash, users[0].user_id]);
    return users[0].user_id;
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const [created] = await connection.execute(
    'INSERT INTO app_user (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Gather Sample Vendor', demoEmail, passwordHash, 'VENDOR']
  );
  return created.insertId;
}

async function seedVenues(connection, vendorId) {
  let inserted = 0;
  for (const venue of venues) {
    const [existing] = await connection.execute(
      'SELECT venue_id FROM venue WHERE vendor_id = ? AND name = ? LIMIT 1', [vendorId, venue.name]
    );
    if (existing.length) continue;
    await connection.execute(
      'INSERT INTO venue (vendor_id, name, address, capacity, facilities, base_price) VALUES (?, ?, ?, ?, ?, ?)',
      [vendorId, venue.name, venue.address, venue.capacity, JSON.stringify(venue.facilities), venue.base_price]
    );
    inserted += 1;
  }
  return inserted;
}

async function seedOfferings(connection, vendorId) {
  let inserted = 0;
  for (const offering of offerings) {
    const [existing] = await connection.execute(
      'SELECT offering_id FROM vendor_offering WHERE vendor_id = ? AND name = ? LIMIT 1', [vendorId, offering.name]
    );
    if (existing.length) continue;
    await connection.execute(
      `INSERT INTO vendor_offering
        (vendor_id, category, offering_type, name, description, price, pricing_unit, min_capacity, max_capacity, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [vendorId, offering.category, offering.offering_type, offering.name, offering.description,
        offering.price, offering.pricing_unit, offering.min_capacity, offering.max_capacity]
    );
    inserted += 1;
  }
  return inserted;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'eventplanningdb'
  });

  try {
    await connection.beginTransaction();
    const vendorId = await ensureVendor(connection);
    const [profiles] = await connection.execute(
      'SELECT vendor_id FROM vendor_profile WHERE vendor_id = ? LIMIT 1', [vendorId]
    );
    if (!profiles.length) {
      await connection.execute(
        'INSERT INTO vendor_profile (vendor_id, business_name, description, business_location) VALUES (?, ?, ?, ?)',
        [vendorId, businessName, 'Clearly marked sample inventory for trying the Gather marketplace.', 'Amravati']
      );
    }
    const venueCount = await seedVenues(connection, vendorId);
    const offeringCount = await seedOfferings(connection, vendorId);
    await connection.commit();
    console.log(`Sample marketplace ready: ${venueCount} venues and ${offeringCount} services added.`);
    console.log('Run the script again safely to add any missing sample listings.');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Could not seed sample listings: ${error.message}`);
  process.exitCode = 1;
});
