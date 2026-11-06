// Prints Chrome's width/height for the same 10 strings the verify plugin measures in Figma (Vazirmatn 14px, line-height 20px).
// usage: node plugin/verify/chrome-ref.mjs   (needs the local app on :3000 so the Vazirmatn @font-face is available)
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const browser = await chromium.launch({ executablePath: path.join(root, dir, 'chrome-win64/chrome.exe'), headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3000/auth/login', { waitUntil: 'networkidle' });
const strs = ['ورود', 'شماره موبایل', 'رمز عبور', 'برنامه‌ای متناسب با هدف تو', 'حساب نداری؟ ثبت‌نام', 'ضمانت ۷ روزه', '۱٬۲۹۰٬۰۰۰', 'تومان برای ۳ ماه', 'شروع تمرین امروز', 'گزارش هفتگی'];
const rows = await page.evaluate(async (list) => {
  await document.fonts.load('14px Vazirmatn'); await document.fonts.ready;
  return list.map((s) => { const e = document.createElement('span'); e.textContent = s; e.style.cssText = "position:absolute;white-space:nowrap;font:400 14px/20px Vazirmatn,sans-serif"; document.body.appendChild(e); const r = e.getBoundingClientRect(); e.remove(); return s + '  =>  ' + Math.round(r.width * 100) / 100 + ' x ' + Math.round(r.height * 100) / 100; });
}, strs);
console.log(rows.join('\n'));
await browser.close();
