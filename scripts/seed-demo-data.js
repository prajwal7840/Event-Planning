require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const demoAccounts = [
  { name: 'Gather Demo Host', email: 'demo.host@gather.local', password: 'GatherHost2026!', role: 'HOST' },
  { name: 'Gather Demo Guest', email: 'demo.guest@gather.local', password: 'GatherGuest2026!', role: 'INVITEE' }
];

const demoEvents = [
  { name: 'Demo: Garden Wedding Reception', event_type: 'Wedding', days: 30, time: '17:00:00', duration: 6, guests: 120, budget: 180000 },
  { name: 'Demo: Winter Alumni Dinner', event_type: 'Dinner', days: 52, time: '18:30:00', duration: 4, guests: 70, budget: 85000 },
  { name: 'Demo: Campus Innovation Showcase', event_type: 'College Event', days: 90, time: '10:00:00', duration: 8, guests: 240, budget: 250000 },
  { name: 'Demo: Birthday Brunch', event_type: 'Birthday', days: 120, time: '11:00:00', duration: 3, guests: 35, budget: 40000 },
  { name: 'Demo: Community Arts Fair', event_type: 'Community Event', days: 150, time: '09:00:00', duration: 7, guests: 300, budget: 175000 },
  { name: 'Demo: Spring Team Retreat', event_type: 'Work Gathering', days: 190, time: '09:30:00', duration: 6, guests: 55, budget: 95000 }
];

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function ensureDemoAccount(connection, account) {
  const [rows] = await connection.execute(
    'SELECT user_id, role FROM app_user WHERE email = ? LIMIT 1', [account.email]
  );
  const passwordHash = await bcrypt.hash(account.password, 12);
  if (rows.length) {
    if (rows[0].role !== account.role) throw new Error(`Demo email ${account.email} belongs to a different role.`);
    await connection.execute('UPDATE app_user SET password_hash = ? WHERE user_id = ?', [passwordHash, rows[0].user_id]);
    return rows[0].user_id;
  }
  const [result] = await connection.execute(
    'INSERT INTO app_user (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [account.name, account.email, passwordHash, account.role]
  );
  return result.insertId;
}

async function ensureDemoEvent(connection, hostId, event) {
  const [rows] = await connection.execute(
    'SELECT event_id FROM `event` WHERE host_id = ? AND name = ? LIMIT 1', [hostId, event.name]
  );
  if (rows.length) return rows[0].event_id;
  const [result] = await connection.execute(
    `INSERT INTO \`event\`
      (host_id, name, event_type, event_date, start_time, duration_hours, attendee_count, budget, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLANNING')`,
    [hostId, event.name, event.event_type, dateAfter(event.days), event.time, event.duration, event.guests, event.budget]
  );
  return result.insertId;
}

async function ensureDemoBooking(connection, eventId, listingType, listingName) {
  const isVenue = listingType === 'venue';
  const table = isVenue ? 'venue' : 'vendor_offering';
  const idColumn = isVenue ? 'venue_id' : 'offering_id';
  const bookingColumn = isVenue ? 'venue_id' : 'offering_id';
  const [listings] = await connection.execute(
    `SELECT ${idColumn} FROM ${table} WHERE name = ? LIMIT 1`, [listingName]
  );
  if (!listings.length) throw new Error(`Sample ${listingType} "${listingName}" was not found. Run the marketplace seed first.`);
  const listingId = listings[0][idColumn];
  const [events] = await connection.execute(
    `SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
            duration_hours
       FROM \`event\` WHERE event_id = ?`, [eventId]
  );
  const event = events[0];
  const start = new Date(`${event.event_date}T${event.start_time}`);
  const end = new Date(start.getTime() + Number(event.duration_hours) * 60 * 60 * 1000);
  const toSqlDateTime = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  const startSql = toSqlDateTime(start);
  const endSql = toSqlDateTime(end);
  const [existing] = await connection.execute(
    `SELECT booking_id, status FROM booking WHERE event_id = ? AND ${bookingColumn} = ? LIMIT 1`, [eventId, listingId]
  );
  if (existing.length) {
    if (existing[0].status === 'PENDING') {
      await ensureDemoAvailability(connection, listingType, listingId, startSql, endSql);
    }
    return false;
  }

  await connection.execute(
    `INSERT INTO booking (event_id, venue_id, offering_id, start_datetime, end_datetime)
     VALUES (?, ?, ?, ?, ?)`,
    [eventId, isVenue ? listingId : null, isVenue ? null : listingId, startSql, endSql]
  );
  await ensureDemoAvailability(connection, listingType, listingId, startSql, endSql);
  return true;
}

async function ensureDemoAvailability(connection, listingType, listingId, start, end) {
  const isVenue = listingType === 'venue';
  const listingColumn = isVenue ? 'venue_id' : 'offering_id';
  const [existing] = await connection.execute(
    `SELECT slot_id FROM availability_slot
      WHERE ${listingColumn} = ? AND availability_status = 'AVAILABLE'
        AND start_datetime <= ? AND end_datetime >= ? LIMIT 1`,
    [listingId, start, end]
  );
  if (existing.length) return;
  await connection.execute(
    `INSERT INTO availability_slot (venue_id, offering_id, start_datetime, end_datetime, availability_status)
     VALUES (?, ?, ?, ?, 'AVAILABLE')`,
    [isVenue ? listingId : null, isVenue ? null : listingId, start, end]
  );
}

async function ensureDemoNotification(connection, userId, message) {
  const [existing] = await connection.execute(
    'SELECT notification_id FROM notification WHERE user_id = ? AND message = ? LIMIT 1', [userId, message]
  );
  if (existing.length) return false;
  await connection.execute(
    'INSERT INTO notification (user_id, message, notification_type) VALUES (?, ?, ?)',
    [userId, message, 'DEMO']
  );
  return true;
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
    const hostId = await ensureDemoAccount(connection, demoAccounts[0]);
    const guestId = await ensureDemoAccount(connection, demoAccounts[1]);
    const eventIds = [];
    for (const event of demoEvents) eventIds.push(await ensureDemoEvent(connection, hostId, event));
    await connection.execute(
      `UPDATE booking b
         JOIN \`event\` e ON e.event_id = b.event_id
         JOIN venue old_v ON old_v.venue_id = b.venue_id
         JOIN venue demo_v ON demo_v.name = 'Maple Grove Lawn'
         SET b.venue_id = demo_v.venue_id
       WHERE e.event_id = ? AND b.status = 'PENDING' AND old_v.name = 'Willow Courtyard'
         AND e.attendee_count <= demo_v.capacity`,
      [eventIds[0]]
    );
    const bookingsAdded = [
      await ensureDemoBooking(connection, eventIds[0], 'venue', 'Maple Grove Lawn'),
      await ensureDemoBooking(connection, eventIds[1], 'offering', 'Golden Hour Photography')
    ].filter(Boolean).length;

    let invitationsAdded = 0;
    for (const eventId of [eventIds[0], eventIds[1], eventIds[4]]) {
      const [existing] = await connection.execute(
        'SELECT invitation_id FROM invitation WHERE event_id = ? AND invitee_user_id = ? LIMIT 1',
        [eventId, guestId]
      );
      if (existing.length) continue;
      await connection.execute(
        `INSERT INTO invitation (event_id, invitee_user_id, invitee_name, invitee_email)
         VALUES (?, ?, ?, ?)`,
        [eventId, guestId, demoAccounts[1].name, demoAccounts[1].email]
      );
      invitationsAdded += 1;
    }
    const notificationsAdded = [
      await ensureDemoNotification(connection, hostId, 'Demo: Your Garden Wedding Reception booking is ready to review.'),
      await ensureDemoNotification(connection, guestId, 'Demo: You have been invited to the Garden Wedding Reception.')
    ].filter(Boolean).length;
    await connection.commit();
    console.log(`Demo accounts ready; ${demoEvents.length} events checked, ${bookingsAdded} sample bookings added, ${invitationsAdded} invitations added, and ${notificationsAdded} notifications added.`);
    console.log(`Host: ${demoAccounts[0].email} / ${demoAccounts[0].password}`);
    console.log(`Invitee: ${demoAccounts[1].email} / ${demoAccounts[1].password}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Could not seed demo data: ${error.message}`);
  process.exitCode = 1;
});
