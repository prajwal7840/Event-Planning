// Query methods for workflows that need joins, views, transactions, or stored procedures.
// Entity CRUD remains in BaseRepository; all SQL stays in the repository layer.
class ApplicationRepository {
  constructor(pool) { this.pool = pool; }
  execute(sql, params = []) { return this.pool.execute(sql, params); }
  query(sql, params = []) { return this.pool.query(sql, params); }
  getConnection() { return this.pool.getConnection(); }

  async findUserByEmail(email) {
    const [rows] = await this.pool.execute('SELECT user_id, name, email, password_hash, role FROM app_user WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  }
  async findUserById(userId) {
    const [rows] = await this.pool.execute('SELECT user_id, name, email, role FROM app_user WHERE user_id = ? LIMIT 1', [userId]);
    return rows[0] || null;
  }
  async listEventsFor(user) {
    let sql = 'SELECT event_id, host_id, name, event_type, event_date, start_time, duration_hours, attendee_count, budget, status FROM `event`';
    const params = [];
    if (user.role === 'HOST') { sql += ' WHERE host_id = ?'; params.push(user.user_id); }
    else {
      sql = `SELECT e.event_id, e.host_id, e.name, e.event_type, e.event_date, e.start_time, e.duration_hours, e.attendee_count, e.status
        FROM \`event\` e JOIN invitation i ON i.event_id = e.event_id WHERE i.invitee_user_id = ? OR LOWER(i.invitee_email) = LOWER(?)`;
      params.push(user.user_id, user.email);
    }
    const [rows] = await this.pool.execute(`${sql} ORDER BY event_date DESC, event_id DESC`, params);
    return rows;
  }
  async findEventById(id) {
    const [rows] = await this.pool.execute('SELECT * FROM `event` WHERE event_id = ?', [id]);
    return rows[0] || null;
  }

  async listEventBookingsForHost(eventId, userId) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.event_id, b.venue_id, b.offering_id,
        b.start_datetime, b.end_datetime, b.agreed_price, b.status,
        v.name AS venue_name, v.address AS venue_address, v.capacity AS venue_capacity,
        v.facilities AS venue_facilities, vo.name AS offering_name, vo.category AS offering_category,
        vo.offering_type, vo.description AS offering_description, vo.pricing_unit,
        COALESCE(b.agreed_price, v.base_price, vo.price) AS estimated_price,
        vp.business_name
      FROM booking b
      JOIN \`event\` e ON e.event_id = b.event_id
      LEFT JOIN venue v ON v.venue_id = b.venue_id
      LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id
      LEFT JOIN vendor_profile vp ON vp.vendor_id = COALESCE(v.vendor_id, vo.vendor_id)
      WHERE b.event_id = ? AND e.host_id = ?
      ORDER BY b.created_at, b.booking_id`, [eventId, userId]);
    return rows;
  }
  async isInviteeForEvent(eventId, user) {
    const [rows] = await this.pool.execute('SELECT invitation_id FROM invitation WHERE event_id = ? AND (invitee_user_id = ? OR LOWER(invitee_email) = LOWER(?)) LIMIT 1', [eventId, user.user_id, user.email]);
    return rows.length > 0;
  }

  async listBookingsFor(user, when = null) {
    let sql; const params = [];
    if (user.role === 'HOST') {
      sql = 'SELECT b.* FROM booking b JOIN `event` e ON e.event_id = b.event_id WHERE e.host_id = ?';
      params.push(user.user_id);
    } else {
      sql = `SELECT b.*, e.name AS event_name, e.event_type, e.attendee_count, e.duration_hours,
          e.event_date, e.start_time AS event_start_time, h.name AS host_name,
          v.name AS venue_name, v.address AS venue_address, v.capacity AS venue_capacity,
          vo.name AS offering_name, vo.category AS offering_category, vo.description AS offering_description,
          vo.offering_type, vo.pricing_unit,
          COALESCE(b.agreed_price, v.base_price, vo.price) AS booking_price
        FROM booking b JOIN \`event\` e ON e.event_id = b.event_id
        JOIN app_user h ON h.user_id = e.host_id
        LEFT JOIN venue v ON v.venue_id = b.venue_id
        LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id
        WHERE (v.vendor_id = ? OR vo.vendor_id = ?)`;
      params.push(user.user_id, user.user_id);
    }
    if (when === 'upcoming') sql += ' AND b.end_datetime >= NOW()';
    if (when === 'past') sql += ' AND b.end_datetime < NOW()';
    const [rows] = await this.pool.execute(`${sql} ORDER BY b.created_at DESC`, params);
    return rows;
  }
  async getCapacityCheck({ bookingId = null, eventId = null, venueId = null, offeringId = null }) {
    const byBooking = bookingId != null;
    const [rows] = await this.pool.execute(`SELECT e.attendee_count, v.name AS venue_name, v.capacity AS venue_capacity,
        vo.name AS offering_name, vo.min_capacity, vo.max_capacity
      FROM \`event\` e
      ${byBooking ? 'JOIN booking b ON b.event_id = e.event_id' : ''}
      LEFT JOIN venue v ON v.venue_id = ${byBooking ? 'b.venue_id' : '?'}
      LEFT JOIN vendor_offering vo ON vo.offering_id = ${byBooking ? 'b.offering_id' : '?'}
      WHERE ${byBooking ? 'b.booking_id = ?' : 'e.event_id = ?'}`,
    byBooking ? [bookingId] : [venueId, offeringId, eventId]);
    return rows[0] || null;
  }
  async findDueReminders(hoursAhead) {
    const [rows] = await this.pool.execute(`SELECT i.invitation_id, i.invitee_user_id, e.name AS event_name, e.event_date, e.start_time
      FROM invitation i JOIN \`event\` e ON e.event_id = i.event_id
      WHERE i.invitee_user_id IS NOT NULL AND i.rsvp_status <> 'DECLINED' AND i.reminder_sent_at IS NULL
        AND TIMESTAMP(e.event_date, e.start_time) BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? HOUR)`, [Number(hoursAhead)]);
    return rows;
  }
  async markReminderSent(invitationId) {
    const [result] = await this.pool.execute('UPDATE invitation SET reminder_sent_at = CURRENT_TIMESTAMP WHERE invitation_id = ? AND reminder_sent_at IS NULL', [invitationId]);
    return result.affectedRows > 0;
  }
  async hostOwnsEvent(eventId, userId) {
    const [rows] = await this.pool.execute('SELECT event_id FROM `event` WHERE event_id = ? AND host_id = ?', [eventId, userId]);
    return rows.length > 0;
  }
  async createBooking(data) {
    const [result] = await this.pool.execute('INSERT INTO booking (event_id, venue_id, offering_id, start_datetime, end_datetime, agreed_price) VALUES (?, ?, ?, ?, ?, ?)',
      [data.event_id, data.venue_id, data.offering_id, data.start_datetime, data.end_datetime, data.agreed_price]);
    return result.insertId;
  }
  async isPendingBookingForHost(id, userId) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id FROM booking b JOIN \`event\` e ON e.event_id = b.event_id WHERE b.booking_id = ? AND e.host_id = ? AND b.status = 'PENDING'`, [id, userId]);
    return rows.length > 0;
  }
  async isPendingBookingForVendor(id, userId) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id FROM booking b
      LEFT JOIN venue v ON v.venue_id = b.venue_id
      LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id
      WHERE b.booking_id = ? AND b.status = 'PENDING' AND (v.vendor_id = ? OR vo.vendor_id = ?)`, [id, userId, userId]);
    return rows.length > 0;
  }
  async getBookingContacts(id) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.event_id, b.venue_id, b.status, e.name AS event_name, e.host_id,
      COALESCE(v.vendor_id, vo.vendor_id) AS vendor_id, COALESCE(v.name, vo.name) AS listing_name
      FROM booking b JOIN \`event\` e ON e.event_id = b.event_id
      LEFT JOIN venue v ON v.venue_id = b.venue_id LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id
      WHERE b.booking_id = ?`, [id]);
    return rows[0] || null;
  }
  confirmBooking(id, agreedPrice = null) { return this.pool.query('CALL sp_confirm_booking(?, ?)', [id, agreedPrice]); }
  async findBookingForCancel(id) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.event_id, b.start_datetime, b.end_datetime, b.agreed_price, b.status,
      e.host_id, v.vendor_id AS venue_vendor_id, vo.vendor_id AS offering_vendor_id
      FROM booking b JOIN \`event\` e ON e.event_id = b.event_id LEFT JOIN venue v ON v.venue_id = b.venue_id
      LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id WHERE b.booking_id = ?`, [id]);
    return rows[0] || null;
  }
  async findBookingForReject(id) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.status, v.vendor_id AS venue_vendor_id, vo.vendor_id AS offering_vendor_id
      FROM booking b LEFT JOIN venue v ON v.venue_id = b.venue_id LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id WHERE b.booking_id = ?`, [id]);
    return rows[0] || null;
  }
  async updateBookingStatus(id, status) {
    const [result] = await this.pool.execute('UPDATE booking SET status = ? WHERE booking_id = ?', [status, id]);
    return result.affectedRows > 0;
  }
  async updatePendingBookingForHost(id, hostId, changes) {
    const fields = ['start_datetime', 'end_datetime', 'agreed_price'];
    const entries = Object.entries(changes).filter(([key, value]) => fields.includes(key) && value !== undefined);
    if (!entries.length) return false;
    const assignments = entries.map(([key]) => `\`${key}\` = ?`).join(', ');
    const [result] = await this.pool.execute(`UPDATE booking b JOIN \`event\` e ON e.event_id = b.event_id
      SET ${assignments} WHERE b.booking_id = ? AND e.host_id = ? AND b.status = 'PENDING'`,
    [...entries.map(([, value]) => value), id, hostId]);
    return result.affectedRows > 0;
  }

  async searchVenues(query) {
    const conditions = ['1 = 1']; const params = [];
    if (query.min_capacity) { conditions.push('v.capacity >= ?'); params.push(Number(query.min_capacity)); }
    if (query.attendees) { conditions.push('v.capacity >= ?'); params.push(Number(query.attendees)); }
    if (query.max_price != null && query.max_price !== '') { conditions.push('(v.base_price IS NULL OR v.base_price <= ?)'); params.push(Number(query.max_price)); }
    if (query.location) { conditions.push('v.address LIKE ?'); params.push(`%${query.location}%`); }
    if (query.start_datetime && query.end_datetime) {
      conditions.push(`EXISTS (SELECT 1 FROM availability_slot a WHERE a.venue_id = v.venue_id AND a.offering_id IS NULL
        AND a.availability_status = 'AVAILABLE' AND a.start_datetime <= ? AND a.end_datetime >= ?)`);
      params.push(query.start_datetime, query.end_datetime);
      conditions.push(`NOT EXISTS (SELECT 1 FROM booking b WHERE b.venue_id = v.venue_id AND b.status = 'CONFIRMED'
        AND b.start_datetime < ? AND b.end_datetime > ?)`);
      params.push(query.end_datetime, query.start_datetime);
      conditions.push(`NOT EXISTS (SELECT 1 FROM availability_slot a WHERE a.venue_id = v.venue_id AND a.offering_id IS NULL
        AND a.availability_status = 'BLOCKED' AND a.start_datetime < ? AND a.end_datetime > ?)`);
      params.push(query.end_datetime, query.start_datetime);
    }
    const [rows] = await this.pool.execute(`SELECT v.venue_id, v.vendor_id, v.name, v.address, v.capacity, v.facilities, v.base_price, vp.business_name
      FROM venue v JOIN vendor_profile vp ON vp.vendor_id = v.vendor_id WHERE ${conditions.join(' AND ')} ORDER BY v.base_price IS NULL, v.base_price`, params);
    return rows;
  }
  async searchOfferings(query) {
    const conditions = ['vo.is_active = TRUE']; const params = [];
    if (query.category) { conditions.push('vo.category = ?'); params.push(query.category); }
    if (query.max_price != null && query.max_price !== '') { conditions.push('(vo.price IS NULL OR vo.price <= ?)'); params.push(Number(query.max_price)); }
    if (query.attendees) { conditions.push('(vo.min_capacity IS NULL OR vo.min_capacity <= ?)'); conditions.push('(vo.max_capacity IS NULL OR vo.max_capacity >= ?)'); params.push(Number(query.attendees), Number(query.attendees)); }
    if (query.start_datetime && query.end_datetime) {
      conditions.push(`EXISTS (SELECT 1 FROM availability_slot a WHERE a.offering_id = vo.offering_id AND a.venue_id IS NULL
        AND a.availability_status = 'AVAILABLE' AND a.start_datetime <= ? AND a.end_datetime >= ?)`);
      params.push(query.start_datetime, query.end_datetime);
      conditions.push(`NOT EXISTS (SELECT 1 FROM booking b WHERE b.offering_id = vo.offering_id AND b.status = 'CONFIRMED'
        AND b.start_datetime < ? AND b.end_datetime > ?)`);
      params.push(query.end_datetime, query.start_datetime);
      conditions.push(`NOT EXISTS (SELECT 1 FROM availability_slot a WHERE a.offering_id = vo.offering_id AND a.venue_id IS NULL
        AND a.availability_status = 'BLOCKED' AND a.start_datetime < ? AND a.end_datetime > ?)`);
      params.push(query.end_datetime, query.start_datetime);
    }
    const [rows] = await this.pool.execute(`SELECT vo.offering_id, vo.vendor_id, vo.category, vo.offering_type, vo.name, vo.description, vo.price, vo.pricing_unit, vo.min_capacity, vo.max_capacity, vp.business_name
      FROM vendor_offering vo JOIN vendor_profile vp ON vp.vendor_id = vo.vendor_id WHERE ${conditions.join(' AND ')} ORDER BY vo.price IS NULL, vo.price`, params);
    return rows;
  }

  async listInvitationsFor(user) {
    const [rows] = await this.pool.execute('SELECT * FROM v_invitee_event WHERE invitee_user_id = ? OR LOWER(invitee_email) = LOWER(?) ORDER BY event_date', [user.user_id, user.email]);
    return rows;
  }
  async listInvitationsForEvent(eventId, hostId) {
    const [rows] = await this.pool.execute(`SELECT i.invitation_id, i.invitee_name, i.invitee_email,
        i.rsvp_status, i.sent_at, i.responded_at, i.delivery_status, i.delivery_error
      FROM invitation i JOIN \`event\` e ON e.event_id = i.event_id
      WHERE i.event_id = ? AND e.host_id = ?
      ORDER BY FIELD(i.rsvp_status, 'PENDING', 'ACCEPTED', 'DECLINED'), i.invitee_name, i.invitee_email`, [eventId, hostId]);
    return rows;
  }
  async createInvitations(eventId, invitees) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction(); const created = [];
      for (const invitee of invitees) {
        const [users] = await conn.execute('SELECT user_id FROM app_user WHERE email = ? LIMIT 1', [invitee.email]);
        const [result] = await conn.execute(`INSERT INTO invitation (event_id, invitee_user_id, invitee_name, invitee_email)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE invitee_name = VALUES(invitee_name)`,
          [eventId, users.length ? users[0].user_id : null, invitee.name || null, invitee.email]);
        if (users.length) {
          const [[event]] = await conn.execute('SELECT name FROM `event` WHERE event_id = ?', [eventId]);
          await conn.execute('INSERT INTO notification (user_id, message, notification_type, is_read, created_at) VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP)',
            [users[0].user_id, `You have been invited to ${event.name}.`, 'INVITATION_RECEIVED']);
        }
        const [saved] = await conn.execute('SELECT invitation_id FROM invitation WHERE event_id = ? AND invitee_email = ? LIMIT 1', [eventId, invitee.email]);
        created.push({ email: invitee.email, invitation_id: saved[0]?.invitation_id || result.insertId || null, delivery_status: users.length ? 'IN_APP' : 'MANUAL_SHARE' });
      }
      await conn.commit(); return created;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }
  async updateRsvp(id, user, status) {
    const [result] = await this.pool.execute(`UPDATE invitation SET rsvp_status = ?, responded_at = CURRENT_TIMESTAMP
      WHERE invitation_id = ? AND (invitee_user_id = ? OR LOWER(invitee_email) = LOWER(?))`, [status, id, user.user_id, user.email]);
    return result.affectedRows > 0;
  }
  async listNotifications(userId) {
    const [rows] = await this.pool.execute('SELECT notification_id, message, notification_type, is_read, created_at FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [userId]);
    return rows;
  }
  async markNotificationRead(userId, id) {
    const [result] = await this.pool.execute('UPDATE notification SET is_read = TRUE WHERE notification_id = ? AND user_id = ?', [id, userId]);
    return result.affectedRows > 0;
  }
  async createNotification(userId, message, type) {
    if (!userId) return;
    await this.pool.execute('INSERT INTO notification (user_id, message, notification_type, is_read, created_at) VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP)', [userId, message, type]);
  }
  async notifyEventInvitees(eventId, message, type = 'EVENT_UPDATED') {
    const [rows] = await this.pool.execute('SELECT DISTINCT invitee_user_id FROM invitation WHERE event_id = ? AND invitee_user_id IS NOT NULL', [eventId]);
    for (const row of rows) await this.createNotification(row.invitee_user_id, message, type);
  }
  async getConfirmedEventLocation(eventId) {
    const [rows] = await this.pool.execute(`SELECT v.name AS venue_name, v.address AS venue_address
      FROM booking b JOIN venue v ON v.venue_id = b.venue_id
      WHERE b.event_id = ? AND b.status = 'CONFIRMED' ORDER BY b.start_datetime, v.venue_id`, [eventId]);
    return JSON.stringify(rows);
  }
  async notifyBookingParties(bookingId, actorRole, action) {
    const booking = await this.getBookingContacts(bookingId);
    if (!booking) return;
    const recipient = actorRole === 'VENDOR' ? booking.host_id : booking.vendor_id;
    const actor = actorRole === 'VENDOR' ? 'Your service provider' : 'The event host';
    await this.createNotification(recipient, `${actor} ${action} the booking for ${booking.event_name} (${booking.listing_name}).`, `BOOKING_${action.toUpperCase()}`);
  }
  async listVendorResources(userId) {
    const [[venues], [offerings]] = await Promise.all([
      this.pool.execute('SELECT venue_id, name, address, capacity, facilities, base_price FROM venue WHERE vendor_id = ? ORDER BY name', [userId]),
      this.pool.execute('SELECT offering_id, category, offering_type, name, description, price, pricing_unit, min_capacity, max_capacity, is_active FROM vendor_offering WHERE vendor_id = ? ORDER BY name', [userId])
    ]);
    return { venues, offerings };
  }
  async hasBookingForVenue(venueId) {
    const [rows] = await this.pool.execute('SELECT booking_id FROM booking WHERE venue_id = ? LIMIT 1', [venueId]);
    return rows.length > 0;
  }
  async hasBookingForOffering(offeringId) {
    const [rows] = await this.pool.execute('SELECT booking_id FROM booking WHERE offering_id = ? LIMIT 1', [offeringId]);
    return rows.length > 0;
  }
  async hasOpenBookingForResource(resourceField, resourceId) {
    if (!['venue_id', 'offering_id'].includes(resourceField)) throw new TypeError('Invalid resource field');
    const [rows] = await this.pool.execute(`SELECT booking_id FROM booking WHERE \`${resourceField}\` = ? AND status IN ('PENDING','CONFIRMED') LIMIT 1`, [resourceId]);
    return rows.length > 0;
  }
  async isBookableListing(venueId, offeringId) {
    if (venueId) {
      const [rows] = await this.pool.execute('SELECT venue_id FROM venue WHERE venue_id = ?', [venueId]);
      return rows.length > 0;
    }
    if (offeringId) {
      const [rows] = await this.pool.execute('SELECT offering_id FROM vendor_offering WHERE offering_id = ? AND is_active = TRUE', [offeringId]);
      return rows.length > 0;
    }
    return false;
  }
  async isBookingForEvent(bookingId, eventId) {
    const [rows] = await this.pool.execute('SELECT booking_id FROM booking WHERE booking_id = ? AND event_id = ?', [bookingId, eventId]);
    return rows.length > 0;
  }
  async listAvailabilityForVendor(userId) {
    const [rows] = await this.pool.execute(`SELECT a.*, v.name AS venue_name, vo.name AS offering_name
      FROM availability_slot a LEFT JOIN venue v ON v.venue_id = a.venue_id
      LEFT JOIN vendor_offering vo ON vo.offering_id = a.offering_id
      WHERE v.vendor_id = ? OR vo.vendor_id = ? ORDER BY a.start_datetime`, [userId, userId]);
    return rows;
  }
  async findAvailabilityForVendor(slotId, userId) {
    const [rows] = await this.pool.execute(`SELECT a.slot_id FROM availability_slot a
      LEFT JOIN venue v ON v.venue_id = a.venue_id LEFT JOIN vendor_offering vo ON vo.offering_id = a.offering_id
      WHERE a.slot_id = ? AND (v.vendor_id = ? OR vo.vendor_id = ?)`, [slotId, userId, userId]);
    return rows.length > 0;
  }
  async vendorOwnsResource(userId, venueId, offeringId) {
    if (venueId) {
      const [rows] = await this.pool.execute('SELECT venue_id FROM venue WHERE venue_id = ? AND vendor_id = ?', [venueId, userId]);
      return rows.length > 0;
    }
    if (offeringId) {
      const [rows] = await this.pool.execute('SELECT offering_id FROM vendor_offering WHERE offering_id = ? AND vendor_id = ?', [offeringId, userId]);
      return rows.length > 0;
    }
    return false;
  }
  async confirmedBookingOverlaps(resourceField, resourceId, start, end) {
    if (!['venue_id', 'offering_id'].includes(resourceField)) throw new TypeError('Invalid resource field');
    const [rows] = await this.pool.execute(`SELECT booking_id FROM booking WHERE \`${resourceField}\` = ? AND status = 'CONFIRMED'
      AND start_datetime < ? AND end_datetime > ? LIMIT 1`, [resourceId, end, start]);
    return rows.length > 0;
  }
  async listExpensesForEvent(eventId, hostId) {
    const [rows] = await this.pool.execute(`SELECT x.* FROM expense x JOIN \`event\` e ON e.event_id = x.event_id
      WHERE x.event_id = ? AND e.host_id = ? ORDER BY x.expense_date DESC, x.expense_id DESC`, [eventId, hostId]);
    return rows;
  }
  async findExpenseForHost(expenseId, hostId) {
    const [rows] = await this.pool.execute(`SELECT x.expense_id FROM expense x JOIN \`event\` e ON e.event_id = x.event_id
      WHERE x.expense_id = ? AND e.host_id = ?`, [expenseId, hostId]);
    return rows.length > 0;
  }
  async listEventBookingsForInvitee(eventId) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.event_id, b.venue_id, b.start_datetime, b.end_datetime,
      v.name AS venue_name, v.address AS venue_address
      FROM booking b LEFT JOIN venue v ON v.venue_id = b.venue_id
      WHERE b.event_id = ? AND b.status = 'CONFIRMED' AND b.venue_id IS NOT NULL ORDER BY b.start_datetime`, [eventId]);
    return rows;
  }
  async findHostContactForEvent(eventId) {
    const [rows] = await this.pool.execute(`SELECT h.name AS host_name,
      CASE WHEN h.share_phone_with_invitees = TRUE THEN h.phone ELSE NULL END AS host_phone
      FROM \`event\` e JOIN app_user h ON h.user_id = e.host_id WHERE e.event_id = ?`, [eventId]);
    return rows[0] || null;
  }
  async findInvitationHost(invitationId) {
    const [rows] = await this.pool.execute(`SELECT e.host_id, e.name AS event_name, i.invitee_email
      FROM invitation i JOIN \`event\` e ON e.event_id = i.event_id WHERE i.invitation_id = ?`, [invitationId]);
    return rows[0] || null;
  }
  async findInvitationEventDetails(eventId) {
    const [rows] = await this.pool.execute(`SELECT e.name, e.event_type, e.event_date, e.start_time, e.duration_hours,
      v.name AS venue_name, v.address AS venue_address
      FROM \`event\` e LEFT JOIN booking b ON b.event_id = e.event_id AND b.status = 'CONFIRMED' AND b.venue_id IS NOT NULL
      LEFT JOIN venue v ON v.venue_id = b.venue_id WHERE e.event_id = ? ORDER BY b.start_datetime LIMIT 1`, [eventId]);
    return rows[0] || null;
  }
  async updateInvitationDelivery(invitationId, status, error = null) {
    await this.pool.execute(`UPDATE invitation SET delivery_status = ?, delivery_error = ?,
      sent_at = CASE WHEN ? IN ('EMAIL_SENT','IN_APP') THEN CURRENT_TIMESTAMP ELSE sent_at END
      WHERE invitation_id = ?`, [status, error, status, invitationId]);
  }
  async findBudgetForEvent(userId, eventId) {
    const [rows] = await this.pool.execute('SELECT * FROM v_event_budget_summary WHERE event_id = ? AND host_id = ?', [eventId, userId]);
    return rows[0] || null;
  }
}

module.exports = ApplicationRepository;
