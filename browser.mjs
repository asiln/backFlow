// Cross-platform browser launcher (Windows, macOS, Linux).
// Order: $BACKFLOW_CHROME (or the pre-1.0 $FIGMA_LIFT_CHROME) -> Playwright's own matching browser -> any Chromium already in the
// Playwright cache (versions drift) -> system Chrome / Edge.
// If nothing works run: npx playwright-core install chromium   (or set BACKFLOW_CHROME to a Chrome binary)
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import os from 'os';

function cacheDir() {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (env && env !== '0') return env;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

const REL = {
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
  darwin: ['chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
};

function cachedChromiums() {
  const root = cacheDir();
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  const found = [];
  for (const d of dirs) for (const rel of REL[process.platform] || REL.linux) {
    const p = path.join(root, d, rel);
    if (fs.existsSync(p)) found.push(p);
  }
  return found;
}

export async function launchBrowser({ headless = true } = {}) {
  const exe = process.env.BACKFLOW_CHROME || process.env.FIGMA_LIFT_CHROME;
  if (exe) return chromium.launch({ executablePath: exe, headless });
  const errors = [];
  try { return await chromium.launch({ headless }); } catch (e) { errors.push(String(e.message || e).split('\n')[0]); }
  for (const exe of cachedChromiums()) {
    try { return await chromium.launch({ executablePath: exe, headless }); } catch (e) { errors.push(String(e.message || e).split('\n')[0]); }
  }
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel, headless }); } catch (e) { errors.push(String(e.message || e).split('\n')[0]); }
  }
  throw new Error('No usable Chromium found. Run "npx playwright-core install chromium" or set BACKFLOW_CHROME to a Chrome/Chromium binary.\n' + errors.join('\n'));
}
