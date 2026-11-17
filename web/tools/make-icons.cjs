// Renders sitserve's icons into web/icons/: the header's dhamma wheel with "OS" lettered over it.
//
//   NODE_PATH=/tmp/sit-web-test/node_modules node web/tools/make-icons.cjs
//
// Chrome draws each icon on a canvas at its own size from web/assets/wheel/dhamma-wheel.svg; the
// PNGs are committed.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// `wheel` is the wheel's height and `font` the letters' size, as fractions of the icon. The gold
// wheel sits on a dark tile, which launchers crop to their own shape; the maskable icon keeps the
// wheel inside its safe zone, the central circle that every launcher mask leaves visible. Favicons
// round the tile's corners themselves and drop the letters' soft shadow, which blurs away at
// those sizes.
const ICONS = [
  { out: 'icon-512.png', size: 512, wheel: .82, font: .36 },
  { out: 'icon-192.png', size: 192, wheel: .82, font: .36 },
  { out: 'icon-512-maskable.png', size: 512, wheel: .7, font: .3 },
  { out: 'apple-touch-icon.png', size: 180, wheel: .82, font: .36 },
  { out: 'favicon-32.png', size: 32, wheel: .94, font: .46, favicon: true },
  { out: 'favicon-16.png', size: 16, wheel: .94, font: .56, favicon: true },
];

async function main() {
  const outDir = path.join(__dirname, '..', 'icons');
  mkdirSync(outDir, { recursive: true });
  // A data URL keeps the canvas untainted, so it can be exported.
  const art = 'data:image/svg+xml;base64,' + readFileSync(path.join(__dirname, '..', 'assets', 'wheel', 'dhamma-wheel.svg')).toString('base64');
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined) });
  try {
    const page = await browser.newPage();
    for (const icon of ICONS) {
      const png = await page.evaluate(async ({ art, size, wheel, font, favicon }) => {
        const image = new Image();
        image.src = art;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        // A dark warm tile, lit from above in the wheel's gold.
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, favicon ? size * .2 : 0);
        ctx.clip();
        const base = ctx.createLinearGradient(0, 0, 0, size);
        base.addColorStop(0, '#2c2118');
        base.addColorStop(1, '#120d09');
        ctx.fillStyle = base;
        ctx.fill();
        const glow = ctx.createRadialGradient(size / 2, 0, 0, size / 2, 0, size * .9);
        glow.addColorStop(0, 'rgba(183, 135, 48, .45)');
        glow.addColorStop(1, 'rgba(183, 135, 48, 0)');
        ctx.fillStyle = glow;
        ctx.fill();
        const h = wheel * size, w = h * image.naturalWidth / image.naturalHeight;
        ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
        ctx.font = `800 ${font * size}px -apple-system, system-ui, sans-serif`;
        ctx.letterSpacing = `${-font * size * .02}px`;
        const m = ctx.measureText('OS');
        const left = size / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        const baseline = size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        if (!favicon) {
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
