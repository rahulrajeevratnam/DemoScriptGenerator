'use strict';

const path = require('path');
const fs = require('fs');
const extractFrames = require('./frameExtractor');
const analyseVideo = require('./aiAnalyser');
const annotateScreenshots = require('./annotator');
const generateDocx = require('./docxGenerator');
const { pickFrameForStep } = require('./framePicker');

async function run({ jobId, videoPath, description, template, jobs }) {
  const log = (message, type = 'info') => {
    jobs[jobId].logs.push({ type, message });
  };

  const framesDir = path.join(__dirname, '..', 'frames', jobId);
  const screenshotsDir = path.join(__dirname, '..', 'screenshots', jobId);
  const annotatedDir = path.join(__dirname, '..', 'annotated', jobId);

  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(annotatedDir, { recursive: true });

  // Step 1: Extract frames
  log('📽️  Extracting frames from video...');
  const frames = await extractFrames(videoPath, framesDir, log);
  log(`✅ Extracted ${frames.length} frames`);

  // Step 2: AI analysis
  log('🤖 Analysing video with AI (this may take a minute)...');
  const scriptData = await analyseVideo(frames, description, log);
  const totalSteps = scriptData.reduce((s, sec) =>
    s + sec.subSections.reduce((ss, sub) => ss + sub.actions.length, 0), 0);
  log(`✅ AI analysis complete — found ${scriptData.length} section(s), ${totalSteps} step(s)`);

  // Step 3: Map video frames to steps
  log('🖼️  Mapping video frames to script steps...');
  const screenshotMap = await buildFrameScreenshots({ scriptData, frames, screenshotsDir, log });
  log(`✅ ${Object.keys(screenshotMap).length} screenshot(s) ready`);

  // Step 4: Annotate
  log('🎨 Annotating screenshots with callouts...');
  const annotatedMap = await annotateScreenshots({ scriptData, screenshotMap, annotatedDir, log });
  log('✅ Annotation complete');

  // Step 5: Generate docx
  log('📄 Generating demo script document...');
  const timestamp = Date.now();
  const outputPath = path.join(__dirname, '..', 'output', `DemoScript_${timestamp}.docx`);
  await generateDocx({ scriptData, annotatedMap, description, outputPath, log });
  log(`✅ Demo script generated: DemoScript_${timestamp}.docx`);

  // Step 6: Cleanup
  log('🧹 Cleaning up temporary files...');
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.unlinkSync(videoPath);
  } catch {}
  log('✅ Done');

  return outputPath;
}

async function buildFrameScreenshots({ scriptData, frames, screenshotsDir, log }) {
  const sharp = require('sharp');
  const screenshotMap = {};
  let stepGlobal = 0;

  const totalSteps = scriptData.reduce((s, sec) =>
    s + sec.subSections.reduce((ss, sub) => ss + sub.actions.length, 0), 0);

  for (const section of scriptData) {
    for (const subSection of section.subSections) {
      for (const action of subSection.actions) {
        stepGlobal++;
        const stepKey = `step_${stepGlobal}`;
        const frameIdx = pickFrameForStep(action.frameNumber, stepGlobal, totalSteps, frames.length);
        const sourcePath = frames[frameIdx];

        if (!sourcePath || !fs.existsSync(sourcePath)) {
          log(`   ⚠️  No frame available for step ${stepGlobal}`, 'warn');
          continue;
        }

        const destPath = path.join(screenshotsDir, `${stepKey}.png`);
        try {
          await sharp(sourcePath).png().toFile(destPath);
          screenshotMap[stepKey] = destPath;
          log(`   Step ${stepGlobal}: "${action.title}" — frame ${frameIdx + 1}`);
        } catch (err) {
          log(`   ⚠️  Frame copy failed for step ${stepGlobal}: ${err.message}`, 'warn');
          screenshotMap[stepKey] = sourcePath;
        }
        action._screenshotKey = stepKey;
      }
    }
  }

  return screenshotMap;
}

module.exports = { run };
