// Central adapter around mysql2's pool. Services use this instead of importing
// the pool, keeping connection details inside the repository layer.
class DatabaseRepository {
  constructor(pool) { this.pool = pool; }
  execute(sql, params = []) { return this.pool.execute(sql, params); }
  query(sql, params = []) { return this.pool.query(sql, params); }
  getConnection() { return this.pool.getConnection(); }
}

module.exports = DatabaseRepository;
