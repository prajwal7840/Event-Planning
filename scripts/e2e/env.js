// Throw-away test environment: a schema-only copy of the real database plus a second server pointed at it.
// The real database is only ever read by mysqldump (--no-data); no real rows are copied or changed.
require('dotenv').config({ path: require('node:path').join(__dirname, '../../.env') });
const { execSync, spawn } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');

const root = path.join(__dirname, '../..');
const MYSQL_BIN = process.env.MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.0/bin';
const SOURCE_DB = process.env.DB_NAME || 'eventplanningdb';
const TEST_DB = 'eventplanningdb_e2e';
const PORT = Number(process.env.E2E_PORT || 5055);
const baseUrl = `http://localhost:${PORT}`;
const dbConfig = { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };

async function adminQuery(sql) {
  const conn = await mysql.createConnection(dbConfig);
  try { await conn.query(sql); } finally { await conn.end(); }
}

async function createTestDatabase() {
  if (TEST_DB === SOURCE_DB) throw new Error('Refusing to use the real database as the test database');
  await adminQuery(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await adminQuery(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4`);
  const env = { ...process.env, MYSQL_PWD: dbConfig.password };
  const common = `-h ${dbConfig.host} -P ${dbConfig.port} -u ${dbConfig.user}`;
  execSync(`"${MYSQL_BIN}/mysqldump" ${common} --no-data --routines --triggers --skip-comments ${SOURCE_DB} | "${MYSQL_BIN}/mysql" ${common} ${TEST_DB}`, { env, stdio: ['ignore', 'ignore', 'pipe'], shell: true });
}

async function dropTestDatabase() { await adminQuery(`DROP DATABASE IF EXISTS \`${TEST_DB}\``); }

async function testDb() { return mysql.createConnection({ ...dbConfig, database: TEST_DB }); }

async function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DB_NAME: TEST_DB, NODE_ENV: 'development', REMINDER_INTERVAL_MINUTES: '0', RESEND_API_KEY: '', INVITATION_FROM_EMAIL: '' }
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, log: () => log };
    } catch (_error) { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Test server did not start:\n${log}`);
}

module.exports = { baseUrl, TEST_DB, createTestDatabase, dropTestDatabase, testDb, startServer };
