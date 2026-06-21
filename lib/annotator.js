'use strict';

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const CIRCLE_DIAMETER = 28;
const CIRCLE_RADIUS = CIRCLE_DIAMETER / 2;
const ORANGE = '#FF6B00';

function buildCalloutSvg(number, cx, cy) {
  const n = String(number);
  const fontSize = n.length > 1 ? 11 : 13;

  return `
<svg width="${CIRCLE_DIAMETER}" height="${CIRCLE_DIAMETER}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${CIRCLE_RADIUS}" cy="${CIRCLE_RADIUS}" r="${CIRCLE_RADIUS}" fill="${ORANGE}"/>
  <text
    x="${CIRCLE_RADIUS}"
    y="${CIRCLE_RADIUS + fontSize * 0.35}"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="bold"
    fill="white"
  >${n}</text>
</svg>`;
}

async function annotateScreenshots({ scriptData, screenshotMap, annotatedDir, log }) {
  const annotatedMap = {};

  let stepGlobal = 0;

  for (const section of scriptData) {
    for (const subSection of section.subSections) {
      for (const action of subSection.actions) {
        stepGlobal++;
        const stepKey = `step_${stepGlobal}`;
        const srcPath = screenshotMap[stepKey];

        if (!srcPath || !fs.existsSync(srcPath)) {
          annotatedMap[stepKey] = srcPath || null;
          continue;
        }

        const destPath = path.join(annotatedDir, `${stepKey}_annotated.png`);
        const coords = action.approximateCalloutCoordinates || [];

        try {
          const img = sharp(srcPath);
          const meta = await img.metadata();
          const W = meta.width || 1440;
          const H = meta.height || 900;

          const composites = [];

          for (let i = 0; i < coords.length; i++) {
            const { x, y } = coords[i];
            const cx = Math.min(Math.max(x, CIRCLE_RADIUS), W - CIRCLE_RADIUS);
            const cy = Math.min(Math.max(y, CIRCLE_RADIUS), H - CIRCLE_RADIUS);

            const svgBuf = Buffer.from(buildCalloutSvg(i + 1, cx, cy));
            composites.push({
              input: svgBuf,
              left: Math.round(cx - CIRCLE_RADIUS),
              top: Math.round(cy - CIRCLE_RADIUS)
            });
          }

          if (composites.length > 0) {
            await sharp(srcPath)
              .composite(composites)
              .png()
              .toFile(destPath);
          } else {
            // No callouts — just copy
            fs.copyFileSync(srcPath, destPath);
          }

          annotatedMap[stepKey] = destPath;
        } catch (err) {
          log(`   ⚠️  Annotation failed for ${stepKey}: ${err.message}`, 'warn');
          annotatedMap[stepKey] = srcPath;
        }
      }
    }
  }

  return annotatedMap;
}

module.exports = annotateScreenshots;
