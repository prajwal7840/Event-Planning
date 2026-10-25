// Works out which API routes the Gather backend actually declares, so a scenario that depends on a missing
// endpoint is reported as unavailable rather than silently simulated.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SCENARIOS } = require('../shared/catalog');

const ROOT = path.join(__dirname, '../..');
const normalize = routePath => routePath.replace(/:[A-Za-z_]+/g, ':p').replace(/\/+$/, '') || '/';

function declaredRoutes(root = ROOT) {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const fileByVar = {};
  for (const match of server.matchAll(/const\s+(\w+)\s*=\s*require\(["'](\.\/src\/routes\/[^"']+)["']\)/g)) fileByVar[match[1]] = match[2];
  const routes = new Set();
  for (const mount of server.matchAll(/app\.use\(\s*["'](\/api[^"']*)["']\s*,\s*(\w+)\s*\)/g)) {
    const file = fileByVar[mount[2]];
    if (!file) continue;
    const source = fs.readFileSync(path.join(root, `${file}.js`), 'utf8');
    for (const route of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g)) {
      routes.add(`${route[1].toUpperCase()} ${normalize(mount[1] + (route[2] === '/' ? '' : route[2]))}`);
    }
  }
  return routes;
}

// -> { unavailable: { scenarioId: 'missing: GET /api/x' }, routes: Set }
function scenarioAvailability(root = ROOT, catalog = SCENARIOS) {
  const routes = declaredRoutes(root);
  const unavailable = {};
  for (const scenario of catalog) {
    const missing = scenario.endpoints.filter(endpoint => {
      const [method, route] = endpoint.split(' ');
      return !routes.has(`${method} ${normalize(route)}`);
    });
    if (missing.length) unavailable[scenario.id] = `endpoint not found in this repository: ${missing.join(', ')}`;
  }
  return { unavailable, routes };
}

module.exports = { declaredRoutes, scenarioAvailability, normalize };
