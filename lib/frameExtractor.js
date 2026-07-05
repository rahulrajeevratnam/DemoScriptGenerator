'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

const CAPTURE_THRESHOLD = 0.02; // 2% — triggers timer
const SETTLE_MS = 400;          // ms of quiet before capturing

// ─── Pass 1: collect timestamps where scene change > 2% ───────────────────
function collectTriggerTimestamps(videoPath) {
  return new Promise((resolve, reject) => {
    const timestamps = [];

    ffmpeg(videoPath)
      .outputOptions([
        '-vf', `select='eq(n\\,0)+gt(scene\\,${CAPTURE_THRESHOLD})',metadata=print:file=-`,
        '-vsync', 'vfr',
        '-f', 'null'
      ])
      .output('-')
      .on('stderr', (line) => {
        // ffmpeg metadata lines look like:
        // frame:0    pts:0       pts_time:0
        // lavfi.scene_score=0.123456
        const tsMatch = line.match(/pts_time:([\d.]+)/);
        if (tsMatch) {
          const t = parseFloat(tsMatch[1]);
          if (!isNaN(t)) timestamps.push(t);
        }
      })
      .on('end', () => resolve(timestamps))
      .on('error', (err) => reject(new Error(`ffmpeg pass 1 error: ${err.message}`)))
      .run();
  });
}

// ─── Apply 400ms settle logic → produce settled capture timestamps ─────────
function applySettleLogic(triggerTimestamps) {
  if (triggerTimestamps.length === 0) return [];

  // Always include t=0 (first frame)
  const sorted = [0, ...triggerTimestamps].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];

  const captureAt = [];
  let i = 0;

  while (i < unique.length) {
    const triggerTime = unique[i];

    // Find the last consecutive trigger within 400ms of this one
    let windowEnd = triggerTime;
    let j = i + 1;
    while (j < unique.length && unique[j] <= windowEnd + SETTLE_MS / 1000) {
      windowEnd = unique[j];
      j++;
    }

    // Capture 400ms after the last trigger in this cluster
    captureAt.push(windowEnd + SETTLE_MS / 1000);
    i = j;
  }

  return captureAt;
}

// ─── Pass 2: extract one frame at each settled timestamp ───────────────────
function extractFrameAtTimestamp(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, timestamp))
      .outputOptions(['-vframes', '1', '-q:v', '2'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`ffmpeg seek error at ${timestamp}s: ${err.message}`)))
      .run();
  });
}

// ─── Main extractor ────────────────────────────────────────────────────────
async function extractFrames(videoPath, framesDir, log) {
  // Pass 1 — find trigger timestamps
  log('   Pass 1: scanning for scene changes (threshold 2%)...');
  let triggerTimestamps;
  try {
    triggerTimestamps = await collectTriggerTimestamps(videoPath);
  } catch (err) {
    log(`   ⚠️  Pass 1 failed: ${err.message} — falling back to 1fps extraction`, 'warn');
    return fallbackExtract(videoPath, framesDir, log);
  }

  log(`   Found ${triggerTimestamps.length} trigger(s), applying 400ms settle logic...`);

  // Apply settle logic
  const captureTimestamps = applySettleLogic(triggerTimestamps);
  log(`   Settled to ${captureTimestamps.length} capture timestamp(s)`);

  if (captureTimestamps.length === 0) {
    log('   ⚠️  No capture timestamps — falling back to 1fps extraction', 'warn');
    return fallbackExtract(videoPath, framesDir, log);
  }

  // Pass 2 — extract one frame per settled timestamp
  log('   Pass 2: extracting settled frames...');
  const rawFrames = [];
  for (let i = 0; i < captureTimestamps.length; i++) {
    const ts = captureTimestamps[i];
    const outputPath = path.join(framesDir, `frame_${String(i + 1).padStart(4, '0')}.jpg`);
    try {
      await extractFrameAtTimestamp(videoPath, ts, outputPath);
      if (fs.existsSync(outputPath)) rawFrames.push(outputPath);
    } catch (err) {
      log(`   ⚠️  Could not extract frame at ${ts.toFixed(3)}s: ${err.message}`, 'warn');
    }
  }

  log(`   Extracted ${rawFrames.length} frame(s)`);

  // Resize for AI
  const resized = [];
  for (const framePath of rawFrames) {
    try {
      const resizedPath = framePath + '_resized.jpg';
      await sharp(framePath)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(resizedPath);
      resized.push(resizedPath);
    } catch {
      resized.push(framePath);
    }
  }

  return resized;
}

// ─── Fallback: simple 1fps extraction ─────────────────────────────────────
function fallbackExtract(videoPath, framesDir, log) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-vf', 'fps=1', '-q:v', '2'])
      .output(path.join(framesDir, 'frame_%04d.jpg'))
      .on('end', async () => {
        const rawFrames = fs.readdirSync(framesDir)
          .filter(f => f.endsWith('.jpg') && !f.includes('resized'))
          .sort()
          .map(f => path.join(framesDir, f));

        const resized = [];
        for (const framePath of rawFrames) {
          try {
            const resizedPath = framePath + '_resized.jpg';
            await sharp(framePath)
              .resize({ width: 1024, withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toFile(resizedPath);
            resized.push(resizedPath);
          } catch {
            resized.push(framePath);
          }
        }
        resolve(resized);
      })
      .on('error', (err) => reject(new Error(`ffmpeg fallback error: ${err.message}`)))
      .run();
  });
}

module.exports = extractFrames;
