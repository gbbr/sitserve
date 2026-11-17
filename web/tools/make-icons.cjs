// Renders sitserve's icons into web/icons/: sutamaya's leaf with "OS" lettered over it. The
// artwork comes from a sutamaya.org checkout, which is read and never changed:
//
//   NODE_PATH=/tmp/sit-web-test/node_modules node web/tools/make-icons.cjs ../sutamaya.org
//
// Each icon starts from the sutamaya icon made for the same use, so the leaf stands upright in
// the manifest icons and leans in the Apple touch icon and favicons, as it does in sutamaya.
// Chrome draws the letters on a canvas at each icon's own size; the PNGs are committed.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// `x` and `y` place the center of the letters' ink and `font` sets their size, all as fractions
// of the icon, to sit them on the widest part of each leaf. The maskable icon keeps the letters
// inside its safe zone, the central circle that every launcher mask leaves visible. Favicons
// trade the soft shadow, which blurs away at those sizes, for a dark outline.
const ICONS = [
  { out: 'icon-512.png', size: 512, source: 'web/public/icons/icon-512-v2.png', x: .5, y: .6, font: .4 },
  { out: 'icon-192.png', size: 192, source: 'web/public/icons/icon-192-v2.png', x: .5, y: .6, font: .4 },
  { out: 'icon-512-maskable.png', size: 512, source: 'web/public/icons/icon-512-maskable-v2.png', x: .5, y: .58, font: .34 },
  { out: 'apple-touch-icon.png', size: 180, source: 'web/public/icons/apple-touch-icon.png', x: .52, y: .52, font: .38 },
  { out: 'favicon-32.png', size: 32, source: 'web/public/favicon-32-v3.png', x: .5, y: .52, font: .5, outline: true },
  { out: 'favicon-16.png', size: 16, source: 'web/public/favicon-16-v3.png', x: .5, y: .53, font: .58, outline: true },
];

async function main() {
  const sutamaya = process.argv[2];
  if (!sutamaya) throw new Error('Usage: node web/tools/make-icons.cjs /path/to/sutamaya.org');
  const outDir = path.join(__dirname, '..', 'icons');
  mkdirSync(outDir, { recursive: true });
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined) });
  try {
    const page = await browser.newPage();
    for (const icon of ICONS) {
      // A data URL keeps the canvas untainted, so it can be exported.
      const art = 'data:image/png;base64,' + readFileSync(path.join(sutamaya, icon.source)).toString('base64');
      const png = await page.evaluate(async ({ art, size, x, y, font, outline }) => {
        const image = new Image();
        image.src = art;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, size, size);
        ctx.font = `800 ${font * size}px -apple-system, system-ui, sans-serif`;
        ctx.letterSpacing = `${-font * size * .02}px`;
        const m = ctx.measureText('OS');
        const left = x * size - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        const baseline = y * size + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        if (outline) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = size / 10;
          ctx.strokeStyle = 'rgba(28, 18, 6, .85)';
          ctx.strokeText('OS', left, baseline);
        } else {
          for (const [blur, offset, alpha] of [[.05, .014, .55], [.012, .004, .4]]) {
            ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
            ctx.shadowBlur = blur * size;
            ctx.shadowOffsetY = offset * size;
            ctx.fillStyle = '#fffaf0';
            ctx.fillText('OS', left, baseline);
          }
          ctx.shadowColor = 'transparent';
        }
        ctx.fillStyle = '#fffaf0';
        ctx.fillText('OS', left, baseline);
        return canvas.toDataURL('image/png');
      }, { art, ...icon });
      writeFileSync(path.join(outDir, icon.out), Buffer.from(png.split(',')[1], 'base64'));
      console.log('icons/' + icon.out);
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
