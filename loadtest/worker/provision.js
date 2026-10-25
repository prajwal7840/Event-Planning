// Creates and removes the managed load-test target: a schema-only copy of the real database and a second copy of the
// Gather API pointed at it. The real database is only read by mysqldump --no-data; no rows are copied.
'use strict';
const { execSync, spawn } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '../..');
const MYSQL_BIN = process.env.MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.0/bin';
const SOURCE_DB = process.env.DB_NAME || 'eventplanningdb';
const dbConfig = () => ({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });

async function admin(sql) {
  const connection = await mysql.createConnection(dbConfig());
  try { await connection.query(sql); } finally { await connection.end(); }
}

async function createDatabase(name) {
  if (name === SOURCE_DB) throw new Error('Refusing to use the real database as the load-test database');
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Invalid database name');
  await admin(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  const c = dbConfig();
  const common = `-h ${c.host} -P ${c.port} -u ${c.user}`;
  execSync(`"${MYSQL_BIN}/mysqldump" ${common} --no-data --routines --triggers --skip-comments ${SOURCE_DB} | "${MYSQL_BIN}/mysql" ${common} ${name}`,
    { env: { ...process.env, MYSQL_PWD: c.password }, stdio: ['ignore', 'ignore', 'pipe'], shell: true });
}

async function dropDatabase(name) {
  if (name === SOURCE_DB) throw new Error('Refusing to drop the real database');
  await admin(`DROP DATABASE IF EXISTS \`${name}\``);
}

async function waitForHealth(baseUrl, getLog) {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) return; } catch (error) { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`The managed test API did not become healthy:\n${getLog()}`);
}

// Returns { baseUrl, probeUrl, database, stop() }
async function provisionManaged(environment, onLog) {
  const log = message => onLog && onLog(message);
  log(`Creating throw-away database ${environment.database} from the ${SOURCE_DB} schema...`);
  await createDatabase(environment.database);
  const baseUrl = `http://127.0.0.1:${environment.appPort}`;
  const probeUrl = `http://127.0.0.1:${environment.probePort}`;
  log(`Starting a separate copy of the Gather API on port ${environment.appPort}...`);
  let output = '';
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'probe-preload.js'), 'server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(environment.appPort), DB_NAME: environment.database, NODE_ENV: 'production', LT_PROBE_PORT: String(environment.probePort),
      REMINDER_INTERVAL_MINUTES: '0', RESEND_API_KEY: '', INVITATION_FROM_EMAIL: '' }
  });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  try { await waitForHealth(baseUrl, () => output); } catch (error) { child.kill(); await dropDatabase(environment.database).catch(() => {}); throw error; }
  log('Managed target is healthy.');
  return {
    baseUrl, probeUrl, database: environment.database, pid: child.pid, serverLog: () => output,
    async stop() {
      try { child.kill(); } catch (error) { /* already stopped */ }
      await new Promise(resolve => setTimeout(resolve, 300));
      await dropDatabase(environment.database).catch(error => log(`Could not drop ${environment.database}: ${error.message}`));
      log(`Removed throw-away database ${environment.database}.`);
    }
  };
}

module.exports = { provisionManaged, createDatabase, dropDatabase };
