// PDF export of a stored HTML report, rendered by the locally installed Chrome (through playwright-core).
'use strict';
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const storage = require('./storage');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function reportPdf(runId) {
  const target = storage.reportPath(runId, 'report.pdf');
  const html = storage.reportPath(runId, 'report.html');
  if (!fs.existsSync(html)) throw new Error('Report not found');
  if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(html).mtimeMs) return target;
  if (!fs.existsSync(CHROME)) throw new Error(`PDF export needs Chrome (looked for ${CHROME}). Set CHROME_PATH or download the HTML report and print it to PDF.`);
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    await page.pdf({ path: target, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } finally { await browser.close(); }
  return target;
}

module.exports = { reportPdf };
