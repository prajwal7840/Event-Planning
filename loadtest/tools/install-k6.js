// Downloads the k6 load-testing engine into loadtest/tools/k6 (project-local; nothing is installed system-wide).
// The zip is verified against the SHA-256 published in the same GitHub release before it is unpacked.
// Usage: node loadtest/tools/install-k6.js [version]      e.g. node loadtest/tools/install-k6.js v2.3.0
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSION = process.argv[2] || process.env.K6_VERSION || 'v2.3.0';
const TARGET = path.join(__dirname, 'k6');
const asset = `k6-${VERSION}-windows-amd64.zip`;
const base = `https://github.com/grafana/k6/releases/download/${VERSION}`;

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

(async () => {
  if (process.platform !== 'win32') throw new Error('This installer targets Windows; on other systems install k6 from https://grafana.com/docs/k6/ and set K6_BIN.');
  const exe = path.join(TARGET, 'k6.exe');
  if (fs.existsSync(exe)) { console.log(`k6 already installed at ${exe}`); return; }
  console.log(`Downloading ${asset} ...`);
  const [zip, sums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/k6-${VERSION}-checksums.txt`)]);
  const expected = sums.toString('utf8').split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === asset)?.[0];
  if (!expected) throw new Error(`No checksum listed for ${asset}`);
  const actual = crypto.createHash('sha256').update(zip).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}. Nothing was installed.`);
  console.log(`SHA-256 verified (${actual.slice(0, 16)}...)`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k6-install-'));
  const zipPath = path.join(tmp, asset);
  fs.writeFileSync(zipPath, zip);
  fs.mkdirSync(TARGET, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`]);
  const unpacked = fs.readdirSync(tmp).find(name => name.startsWith('k6-') && fs.statSync(path.join(tmp, name)).isDirectory());
  fs.copyFileSync(path.join(tmp, unpacked, 'k6.exe'), exe);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Installed ${execFileSync(exe, ['version']).toString().trim()} -> ${exe}`);
})().catch(error => { console.error(error.message); process.exit(1); });
