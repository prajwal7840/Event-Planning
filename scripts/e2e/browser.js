// Browser + HTTP helpers shared by the e2e probes and the test run.
const { chromium } = require('playwright-core');
const { baseUrl } = require('./env');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function launch() { return chromium.launch({ executablePath: CHROME }); }

// A fresh, isolated session. External requests (Google Fonts) are blocked so pages load fast and offline.
async function newPage(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  return page;
}

async function api(method, url, body, token) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// Sign in through the real login page for the chosen role.
async function signIn(page, email, password, role) {
  await page.goto(`${baseUrl}/login?role=${role.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('#submit-button');
  await page.waitForURL(/\/app/, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#top-user-name:not(:empty)', { state: 'attached' });
}

module.exports = { launch, newPage, api, signIn, baseUrl };
