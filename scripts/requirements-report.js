// Runs test/requirements.test.js and writes REQUIREMENTS_TEST_REPORT.md.
// Usage: node scripts/requirements-report.js [baseUrl]   (baseUrl enables the read-only live-app smoke check)
const { run } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildHtml } = require('./report-html');

const root = path.join(__dirname, '..');
const baseUrl = process.argv[2];

const REQUIREMENTS = {
  'Host user stories': [
    ['HUS01', 'Registration and login'], ['HUS02', 'Create an event'], ['HUS03', 'Venue recommendations'], ['HUS04', 'View venue details'],
    ['HUS05', 'Browse vendors'], ['HUS06', 'Compare vendor offerings'], ['HUS07', 'Book venues and vendors'], ['HUS08', 'View event costs'],
    ['HUS09', 'Manage booking status'], ['HUS10', 'Send invitations'], ['HUS11', 'Track attendee responses'],
    ['HUS12', 'Modify or cancel bookings'], ['HUS13', 'Event overview']],
  'Vendor user stories': [
    ['VUS01', 'Vendor profile'], ['VUS02', 'Vendor category'], ['VUS03', 'Manage offerings'], ['VUS04', 'Set pricing'],
    ['VUS05', 'Manage venue information'], ['VUS06', 'Manage catering menus'], ['VUS08', 'Review booking requests'],
    ['VUS09', 'Manage booking calendar'], ['VUS10', 'Accept or reject bookings'], ['VUS11', 'View agreed booking details'],
    ['VUS12', 'Update listing and availability'], ['VUS13', 'View booking history'], ['VUS14', 'Booking notifications']],
  'Invited-user stories': [
    ['IUS01', 'Receive invitation'], ['IUS02', 'View event details'], ['IUS03', 'View venue location'], ['IUS04', 'View host information'],
    ['IUS05', 'Respond to invitation'], ['IUS06', 'Receive event updates'], ['IUS07', 'Reopen invitation'], ['IUS09', 'Contact host']],
  'Business rules': [
    ['BR-01', 'Budget-based recommendations'], ['BR-02', 'Venue capacity validation'], ['BR-03', 'Vendor service capacity'], ['BR-04', 'Availability check'],
    ['BR-05', 'No double booking'], ['BR-06', 'Event duration'], ['BR-07', 'Transparent pricing'], ['BR-08', 'Agreed booking price'],
    ['BR-09', 'Budget visibility'], ['BR-10', 'Booking status'], ['BR-11', 'Booking confirmation'], ['BR-12', 'Vendor booking decisions'],
    ['BR-13', 'Vendor-owned listings'], ['BR-14', 'Accurate vendor information'], ['BR-15', 'Host event ownership'], ['BR-16', 'Invitation contents'],
    ['BR-17', 'Invitation access'], ['BR-18', 'Invitation responses'], ['BR-19', 'Event updates'], ['BR-20', 'Role-based access'],
    ['BR-21', 'Vendor booking privacy'], ['BR-22', 'Invitee data privacy'], ['BR-23', 'Booking changes and cancellation'],
    ['BR-24', 'Booking notifications'], ['BR-25', 'Recommendation limitations'], ['BR-26', 'Consolidated event view']],
  'Cross-system acceptance criteria': [
    ['AC-01', 'Budget-based recommendations'], ['AC-02', 'Capacity validation'], ['AC-03', 'Availability validation'], ['AC-04', 'Transparent pricing'],
    ['AC-05', 'Role-based access'], ['AC-06', 'Invitation privacy'], ['AC-07', 'Booking lifecycle']],
  'SRS functional requirements': [
    ['FR-01', 'Registration and authentication'], ['FR-02', 'Event creation'], ['FR-03', 'Venue discovery and recommendations'], ['FR-04', 'Venue information'],
    ['FR-05', 'Vendor discovery'], ['FR-06', 'Vendor offerings and prices'], ['FR-07', 'Venue and vendor booking'], ['FR-08', 'Cost overview'],
    ['FR-09', 'Booking status management'], ['FR-10', 'Invitation creation and delivery'], ['FR-11', 'Attendee response tracking'],
    ['FR-12', 'Booking changes and cancellation'], ['FR-13', 'Event overview'], ['FR-14', 'Vendor profile and category'], ['FR-15', 'Vendor catalogue management'],
    ['FR-16', 'Vendor pricing management'], ['FR-17', 'Venue capacity and availability'], ['FR-18', 'Catering catalogue'], ['FR-19', 'Vendor booking requests'],
    ['FR-20', 'Vendor calendar'], ['FR-21', 'Vendor booking decisions'], ['FR-22', 'Vendor booking details'], ['FR-23', 'Vendor booking history'],
    ['FR-24', 'Booking notifications'], ['FR-25', 'Invitation viewing'], ['FR-26', 'Event details for invitees'], ['FR-27', 'Venue location'],
    ['FR-28', 'Invitation response'], ['FR-29', 'Event updates'], ['FR-30', 'Host contact information'], ['FR-31', 'Event reminders']],
  'Non-functional requirements': [
    ['NFR-01', 'Security'], ['NFR-02', 'Privacy'], ['NFR-03', 'Usability'], ['NFR-04', 'Data accuracy'], ['NFR-05', 'Reliability'],
    ['NFR-06', 'Performance'], ['NFR-07', 'Maintainability'], ['NFR-08', 'Compatibility']],
};

// Honest limits for requirements a unit test cannot fully prove, shown next to the result.
const LIMITS = {
  'BR-04': 'Search and update guards are unit-tested; the confirm-time check lives in sp_confirm_booking (database).',
  'BR-05': 'Same as BR-04: true overlap prevention under concurrency needs a database test.',
  'BR-06': 'Time-window filtering is checked in the search SQL text only, not against data.',
  'BR-11': 'The procedure call is verified, not its outcome.',
  'AC-03': 'Needs database run to prove conflicting reservations are rejected.',
  'NFR-03': 'No automated usability check; unit tests cover only the data side of this ID. Needs a manual or browser review.',
  'NFR-04': 'Mapped to Data accuracy in the combined requirements; only error/consistency handling is unit-tested here.',
  'NFR-05': 'Mapped to Reliability in the combined requirements; only code-structure rules are unit-tested here.',
  'NFR-06': 'No performance targets are defined in the requirements; not testable yet.',
  'NFR-08': 'Supported devices and browsers are not defined; needs a manual cross-browser check.',
  'HUS05': 'Category filter is verified; "recommendations by requirement" for vendors is the same budget/guest search as HUS03.',
  'VUS06': 'Menus are modelled as generic offerings (per-person unit + min/max capacity); there is no dedicated menu model.',
  'FR-18': 'Same as VUS06.',
  'FR-31': 'Reminders are in-app only and require migration 004 to be applied.',
  'HUS10': 'Email content and failure handling are verified with a stubbed provider; real delivery needs RESEND configured.',
  'IUS03': 'Map link is checked in the front-end source, not by running a browser.',
};

function idsIn(title) {
  const match = /^\[([^\]]+)\]/.exec(title);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

async function runTests() {
  const files = ['test/requirements.test.js', 'test/unit.test.js'].map(file => path.join(root, file));
  const results = new Map(files.map(file => [file, []]));
  const stream = run({ files, concurrency: false });
  for await (const event of stream) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.data.nesting !== 0 || !results.has(event.data.file)) continue;
      results.get(event.data.file).push({
        name: event.data.name, passed: event.type === 'test:pass', ms: event.data.details.duration_ms,
        error: event.type === 'test:fail' ? String(event.data.details.error?.cause?.message || event.data.details.error?.message || 'failed').split('\n')[0] : null
      });
    }
  }
  return results;
}

async function smokeCheck(url) {
  const checks = [
    ['GET /api/health', '/api/health', 200, body => /"database":"connected"/.test(body)],
    ['GET / (landing page)', '/', 200], ['GET /login', '/login', 200], ['GET /app (dashboard)', '/app', 200],
    ['GET /api-docs (Swagger)', '/api-docs', 200], ['GET /openapi.yaml', '/openapi.yaml', 200, body => body.includes('/api/events/{id}/recommendations')],
    ['GET /api/events without a token', '/api/events', 401], ['GET /api/bookings without a token', '/api/bookings', 401],
    ['GET /api/events/1/recommendations without a token', '/api/events/1/recommendations', 401],
    ['GET /api/venues (public search)', '/api/venues', 200, body => Array.isArray(JSON.parse(body))],
    ['GET /api/no-such-route', '/api/no-such-route', 404]
  ];
  const rows = [];
  for (const [label, route, expected, extra] of checks) {
    try {
      const response = await fetch(url + route);
      const body = await response.text();
      const ok = response.status === expected && (!extra || extra(body));
      rows.push({ label, expected, actual: response.status, ok });
    } catch (error) { rows.push({ label, expected, actual: error.message, ok: false }); }
  }
  return rows;
}

(async () => {
  const results = await runTests();
  const [reqTests, unitTests] = [...results.values()];
  const byId = new Map();
  for (const test of reqTests) for (const id of idsIn(test.name)) (byId.get(id) || byId.set(id, []).get(id)).push(test);
  const smoke = baseUrl ? await smokeCheck(baseUrl) : null;

  const all = Object.values(REQUIREMENTS).flat();
  const state = id => {
    const tests = byId.get(id) || [];
    if (!tests.length) return 'NOT COVERED';
    if (tests.some(test => !test.passed)) return 'FAIL';
    return LIMITS[id] ? 'PASS (limits)' : 'PASS';
  };
  const counts = { PASS: 0, 'PASS (limits)': 0, FAIL: 0, 'NOT COVERED': 0 };
  for (const [id] of all) counts[state(id)] += 1;

  const lines = [];
  const reqPass = reqTests.filter(test => test.passed).length;
  const unitPass = unitTests.filter(test => test.passed).length;
  lines.push('# Requirements Unit Test Report', '',
    `**Project:** Event Planning API (Gather)  `,
    `**Generated:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`node scripts/requirements-report.js\`  `,
    '**Sources checked against:** Event_Planning_Combined_Requirements.docx (user stories, acceptance criteria, business rules, NFRs), Event_Planning_Management_SRS.docx (FR-01 to FR-31), Event_Planning_Traceability_Matrix.xlsx, Event_Planning_Test_Specification.docx', '',
    '## Summary', '',
    '| Measure | Result |', '|---|---|',
    `| Requirement-driven tests (\`test/requirements.test.js\`) | ${reqPass} of ${reqTests.length} passed |`,
    `| Existing component unit tests (\`test/unit.test.js\`) | ${unitPass} of ${unitTests.length} passed |`,
    `| Requirement IDs checked | ${all.length} |`,
    `| Verified by a passing test | ${counts.PASS + counts['PASS (limits)']} (${counts['PASS (limits)']} with stated limits) |`,
    `| Failing | ${counts.FAIL} |`,
    `| No unit test (see below) | ${counts['NOT COVERED']} |`,
    smoke ? `| Live app smoke checks (read-only) | ${smoke.filter(row => row.ok).length} of ${smoke.length} passed |` : '| Live app smoke checks | not run |', '',
    '**How to read this:** the tests use fake repositories and a recording SQL pool, so they prove the application rules and the shape of the SQL. They do not run against MySQL, so stored procedures, triggers, constraints and concurrency are not proven here. Tests were also checked to be able to fail: removing the venue-capacity rule made the capacity test fail, and restoring it made it pass.', '');

  lines.push('## Requirement coverage', '');
  for (const [group, items] of Object.entries(REQUIREMENTS)) {
    lines.push(`### ${group}`, '', '| ID | Requirement | Result | Verified by | Notes |', '|---|---|---|---|---|');
    for (const [id, title] of items) {
      const tests = byId.get(id) || [];
      lines.push(`| ${id} | ${title} | ${state(id)} | ${tests.length} test${tests.length === 1 ? '' : 's'} | ${LIMITS[id] || (tests.length ? '' : 'No unit test: needs a database, browser or manual check.')} |`);
    }
    lines.push('');
  }

  lines.push('## Requirement-driven tests', '', '| Result | Test (requirement IDs first) | ms |', '|---|---|---|');
  for (const test of reqTests) lines.push(`| ${test.passed ? 'PASS' : 'FAIL'} | ${test.name.replace(/\|/g, '\\|')}${test.error ? ` — ${test.error}` : ''} | ${Number(test.ms).toFixed(1)} |`);
  lines.push('');

  if (smoke) {
    lines.push('## Live app smoke check', '', `Run against ${baseUrl} with the real MySQL database connected. Read-only: no data was created or changed.`, '',
      '| Check | Expected | Actual | Result |', '|---|---|---|---|');
    for (const row of smoke) lines.push(`| ${row.label} | ${row.expected} | ${row.actual} | ${row.ok ? 'PASS' : 'FAIL'} |`);
    lines.push('');
  }

  lines.push('## Not proven by these unit tests', '',
    '- **Database behaviour:** `sp_confirm_booking`, triggers, check constraints, foreign keys and the budget view (matrix tests TC-20, TC-21). Concurrent double-booking needs a database integration test.',
    '- **Reminders on the real database:** the reminder query and `migrations/004_add_invitation_reminders.sql` were run against `eventplanningdb`, but no reminder has been sent end to end yet.',
    '- **Browser behaviour:** dashboard screens, responsive layout and accessibility (matrix TC for UI) need a browser or manual pass.',
    '- **Real email delivery:** needs `RESEND_API_KEY` and `INVITATION_FROM_EMAIL`.',
    '- **Open policy decisions** from the requirements document: payments, cancellation windows and fees, vendor approval, notification channels, and whether hosts can confirm bookings without vendor acceptance (currently they can).', '');

  fs.writeFileSync(path.join(root, 'REQUIREMENTS_TEST_REPORT.md'), lines.join('\n'));
  const requirementRows = all.map(([id, title]) => {
    const result = state(id);
    return { name: `${id} ${title}`, passed: result === 'PASS' || result === 'PASS (limits)', skipped: result === 'NOT COVERED', note: result === 'NOT COVERED' ? 'No unit test for this requirement' : LIMITS[id] || '' };
  });
  fs.writeFileSync(path.join(root, 'REQUIREMENTS_TEST_REPORT.html'), buildHtml({
    title: 'Gather test report',
    footnote: 'Unit tests use fake repositories, so MySQL procedures, triggers and concurrency are not exercised. The live smoke check is read-only. Browser journeys are checked separately.',
    suites: [
      { title: 'Requirement-driven unit tests', rows: reqTests },
      { title: 'Component unit tests', rows: unitTests },
      ...(smoke ? [{ title: 'Live app smoke check (read-only)', rows: smoke.map(row => ({ name: `${row.label} (expected ${row.expected}, got ${row.actual})`, passed: row.ok })) }] : []),
      { title: `Requirement coverage (${all.length} IDs)`, rows: requirementRows, excludeFromTotal: true }
    ]
  }));
  console.log(`requirements tests ${reqPass}/${reqTests.length}, existing ${unitPass}/${unitTests.length}; IDs: ${JSON.stringify(counts)}`);
  if (smoke) console.log(`smoke ${smoke.filter(row => row.ok).length}/${smoke.length}`);
})();
