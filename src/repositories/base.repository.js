class BaseRepository {
  constructor(db, table, primaryKey, EntityClass) {
    if (![table, primaryKey].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) {
      throw new TypeError('Repository table and primary key must be valid SQL identifiers');
    }
    this.db = db;
    this.table = table;
    this.primaryKey = primaryKey;
    this.EntityClass = EntityClass;
  }

  async findById(id) {
    const [rows] = await this.db.execute(`SELECT * FROM \`${this.table}\` WHERE \`${this.primaryKey}\` = ? LIMIT 1`, [id]);
    return this.EntityClass.fromRow(rows[0]);
  }

  async findAll({ limit = 100, offset = 0 } = {}) {
    const [rows] = await this.db.execute(`SELECT * FROM \`${this.table}\` LIMIT ? OFFSET ?`, [Number(limit), Number(offset)]);
    return rows.map(row => this.EntityClass.fromRow(row));
  }

  async create(data) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) throw new TypeError('At least one field is required');
    this.validateFields(entries);
    const columns = entries.map(([key]) => `\`${key}\``).join(', ');
    const placeholders = entries.map(() => '?').join(', ');
    const [result] = await this.db.execute(
      `INSERT INTO \`${this.table}\` (${columns}) VALUES (${placeholders})`,
      entries.map(([, value]) => value)
    );
    return this.findById(data[this.primaryKey] ?? result.insertId);
  }

  async update(id, data) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    this.validateFields(entries);
    if (!entries.length) return this.findById(id);
    const assignments = entries.map(([key]) => `\`${key}\` = ?`).join(', ');
    await this.db.execute(`UPDATE \`${this.table}\` SET ${assignments} WHERE \`${this.primaryKey}\` = ?`,
      [...entries.map(([, value]) => value), id]);
    return this.findById(id);
  }

  async updateWhere(id, data, conditions = {}) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    this.validateFields(entries);
    const where = Object.entries(conditions);
    this.validateFields(where);
    if (!entries.length) return this.findById(id);
    const assignments = entries.map(([key]) => `\`${key}\` = ?`).join(', ');
    const predicates = [`\`${this.primaryKey}\` = ?`, ...where.map(([key]) => `\`${key}\` = ?`)].join(' AND ');
    const [result] = await this.db.execute(`UPDATE \`${this.table}\` SET ${assignments} WHERE ${predicates}`,
      [...entries.map(([, value]) => value), id, ...where.map(([, value]) => value)]);
    return result.affectedRows ? this.findById(id) : null;
  }

  async delete(id) {
    const [result] = await this.db.execute(`DELETE FROM \`${this.table}\` WHERE \`${this.primaryKey}\` = ?`, [id]);
    return result.affectedRows > 0;
  }

  async deleteWhere(id, conditions = {}) {
    const where = Object.entries(conditions);
    this.validateFields(where);
    const predicates = [`\`${this.primaryKey}\` = ?`, ...where.map(([key]) => `\`${key}\` = ?`)].join(' AND ');
    const [result] = await this.db.execute(`DELETE FROM \`${this.table}\` WHERE ${predicates}`,
      [id, ...where.map(([, value]) => value)]);
    return result.affectedRows > 0;
  }

  validateFields(entries) {
    const allowed = this.EntityClass.fields;
    if (entries.some(([key]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (allowed && !allowed.includes(key)))) {
      throw new TypeError(`Invalid field for ${this.EntityClass.name}`);
    }
  }
}

module.exports = BaseRepository;
