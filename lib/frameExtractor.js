'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

function extractFrames(videoPath, framesDir, log) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-vf', "select='gt(scene,0.3)',setpts=N/FRAME_RATE/TB", '-vsync', 'vfr', '-q:v', '2'])
      .output(path.join(framesDir, 'frame_%03d.jpg'))
      .on('start', () => log('   ffmpeg started scene-change frame extraction (threshold 0.3)...'))
      .on('progress', (progress) => {
        if (progress.percent) {
          log(`   Extracting frames: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', async () => {
        const rawFrames = fs.readdirSync(framesDir)
          .filter(f => f.endsWith('.jpg'))
          .sort()
          .map(f => path.join(framesDir, f));

        // Resize frames for AI (max 1024px wide)
        const resized = [];
        for (const framePath of rawFrames) {
          try {
            await sharp(framePath)
              .resize({ width: 1024, withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toFile(framePath + '_resized.jpg');
            resized.push(framePath + '_resized.jpg');
          } catch {
            resized.push(framePath);
          }
        }
        resolve(resized);
      })
      .on('error', (err) => reject(new Error(`ffmpeg error: ${err.message}`)))
      .run();
  });
}

module.exports = extractFrames;
