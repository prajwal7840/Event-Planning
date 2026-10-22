class ReadOnlyRepository {
  constructor(db, view, primaryKey, EntityClass) {
    if (![view, primaryKey].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) throw new TypeError('Invalid view mapping');
    this.db = db; this.view = view; this.primaryKey = primaryKey; this.EntityClass = EntityClass;
  }
  async findById(id) {
    const [rows] = await this.db.execute(`SELECT * FROM \`${this.view}\` WHERE \`${this.primaryKey}\` = ? LIMIT 1`, [id]);
    return this.EntityClass.fromRow(rows[0]);
  }
  async findAll({ limit = 100, offset = 0 } = {}) {
    const [rows] = await this.db.execute(`SELECT * FROM \`${this.view}\` LIMIT ? OFFSET ?`, [Number(limit), Number(offset)]);
    return rows.map(row => this.EntityClass.fromRow(row));
  }
}
module.exports = ReadOnlyRepository;
