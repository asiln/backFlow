// Prints Chrome's width/height for the same 10 strings the verify plugin measures in Figma (Vazirmatn 14px, line-height 20px).
// usage: node plugin/verify/chrome-ref.mjs   (needs your local app so the font's @font-face is available)
import { launchBrowser } from '../../browser.mjs';
import { loadConfig } from '../../config.mjs';
// Any page of your app that loads the fonts you want to measure: node plugin/verify/chrome-ref.mjs [/path]
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage();
await page.goto(loadConfig().baseUrl + (process.argv[2] || '/'), { waitUntil: 'networkidle' });
const strs = ['ورود', 'شماره موبایل', 'رمز عبور', 'برنامه‌ای متناسب با هدف تو', 'حساب نداری؟ ثبت‌نام', 'ضمانت ۷ روزه', '۱٬۲۹۰٬۰۰۰', 'تومان برای ۳ ماه', 'شروع تمرین امروز', 'گزارش هفتگی'];
const rows = await page.evaluate(async (list) => {
  await document.fonts.load('14px Vazirmatn'); await document.fonts.ready;
  return list.map((s) => { const e = document.createElement('span'); e.textContent = s; e.style.cssText = "position:absolute;white-space:nowrap;font:400 14px/20px Vazirmatn,sans-serif"; document.body.appendChild(e); const r = e.getBoundingClientRect(); e.remove(); return s + '  =>  ' + Math.round(r.width * 100) / 100 + ' x ' + Math.round(r.height * 100) / 100; });
}, strs);
console.log(rows.join('\n'));
await browser.close();
