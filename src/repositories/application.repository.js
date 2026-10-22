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
  async isInviteeForEvent(eventId, user) {
    const [rows] = await this.pool.execute('SELECT invitation_id FROM invitation WHERE event_id = ? AND (invitee_user_id = ? OR LOWER(invitee_email) = LOWER(?)) LIMIT 1', [eventId, user.user_id, user.email]);
    return rows.length > 0;
  }

  async listBookingsFor(user) {
    let sql = 'SELECT b.* FROM booking b'; const params = [];
    if (user.role === 'HOST') { sql += ' JOIN `event` e ON e.event_id = b.event_id WHERE e.host_id = ?'; params.push(user.user_id); }
    else { sql += ' LEFT JOIN venue v ON v.venue_id = b.venue_id LEFT JOIN vendor_offering vo ON vo.offering_id = b.offering_id WHERE v.vendor_id = ? OR vo.vendor_id = ?'; params.push(user.user_id, user.user_id); }
    const [rows] = await this.pool.execute(`${sql} ORDER BY b.created_at DESC`, params);
    return rows;
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
  confirmBooking(id, agreedPrice = null) { return this.pool.query('CALL sp_confirm_booking(?, ?)', [id, agreedPrice]); }
  async findBookingForCancel(id) {
    const [rows] = await this.pool.execute(`SELECT b.booking_id, b.status, e.host_id, v.vendor_id AS venue_vendor_id, vo.vendor_id AS offering_vendor_id
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

  async searchVenues(query) {
    const conditions = ['1 = 1']; const params = [];
    if (query.min_capacity) { conditions.push('v.capacity >= ?'); params.push(Number(query.min_capacity)); }
    if (query.max_price) { conditions.push('(v.base_price IS NULL OR v.base_price <= ?)'); params.push(Number(query.max_price)); }
    if (query.location) { conditions.push('v.address LIKE ?'); params.push(`%${query.location}%`); }
    const [rows] = await this.pool.execute(`SELECT v.venue_id, v.vendor_id, v.name, v.address, v.capacity, v.facilities, v.base_price, vp.business_name
      FROM venue v JOIN vendor_profile vp ON vp.vendor_id = v.vendor_id WHERE ${conditions.join(' AND ')} ORDER BY v.base_price IS NULL, v.base_price`, params);
    return rows;
  }
  async searchOfferings(query) {
    const conditions = ['vo.is_active = TRUE']; const params = [];
    if (query.category) { conditions.push('vo.category = ?'); params.push(query.category); }
    if (query.max_price) { conditions.push('(vo.price IS NULL OR vo.price <= ?)'); params.push(Number(query.max_price)); }
    if (query.attendees) { conditions.push('(vo.min_capacity IS NULL OR vo.min_capacity <= ?)'); conditions.push('(vo.max_capacity IS NULL OR vo.max_capacity >= ?)'); params.push(Number(query.attendees), Number(query.attendees)); }
    const [rows] = await this.pool.execute(`SELECT vo.offering_id, vo.vendor_id, vo.category, vo.offering_type, vo.name, vo.description, vo.price, vo.pricing_unit, vo.min_capacity, vo.max_capacity, vp.business_name
      FROM vendor_offering vo JOIN vendor_profile vp ON vp.vendor_id = vo.vendor_id WHERE ${conditions.join(' AND ')} ORDER BY vo.price IS NULL, vo.price`, params);
    return rows;
  }

  async listInvitationsFor(user) {
    const [rows] = await this.pool.execute('SELECT * FROM v_invitee_event WHERE invitee_user_id = ? OR LOWER(invitee_email) = LOWER(?) ORDER BY event_date', [user.user_id, user.email]);
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
        created.push({ email: invitee.email, invitation_id: result.insertId || null });
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
  async findBudgetForEvent(userId, eventId) {
    const [rows] = await this.pool.execute('SELECT * FROM v_event_budget_summary WHERE event_id = ? AND host_id = ?', [eventId, userId]);
    return rows[0] || null;
  }
}

module.exports = ApplicationRepository;
