// Opens the staged webOS package in Chromium 87, the engine of webOS 22, and
// fails unless the app starts there without errors.
// usage: node smoke-webos22.cjs <chrome> <stage dir>
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const [chrome, stage] = process.argv.slice(2);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--allow-file-access-from-files',
      '--disable-web-security',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent(
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager'
  );
  await page.evaluateOnNewDocument(() => {
    window.webOSSystem = {
      deviceInfo: '{"modelName":"OLED55C2"}',
      platformBack() {},
      setWindowProperty() {},
    };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const version = await browser.version();
  await page.goto('file://' + path.resolve(stage, 'index.html'));
  await new Promise((r) => setTimeout(r, 8000));
  const state = await page.evaluate(() => ({
    mounted: (document.getElementById('root')?.childElementCount ?? 0) > 0,
    text: document.body.innerText.slice(0, 300),
    fields: document.querySelectorAll('input').length,
  }));
  await browser.close();
  console.log(version, JSON.stringify(state));
  const problems = [...errors];
  if (!state.mounted) problems.push('the app did not start');
  if (/too old|could not start/i.test(state.text))
    problems.push('boot.js stopped the app: ' + state.text);
  if (!state.fields) problems.push('no server field on the first screen');
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
