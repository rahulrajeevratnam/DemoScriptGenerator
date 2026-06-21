'use strict';

const path = require('path');
const fs = require('fs');
const extractFrames = require('./frameExtractor');
const analyseVideo = require('./aiAnalyser');
const runPlaywright = require('./playwrightRunner');
const annotateScreenshots = require('./annotator');
const generateDocx = require('./docxGenerator');

async function run({ jobId, videoPath, description, smartLinkUrl, iasUsername, iasPassword, template, jobs }) {
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
  const totalSections = scriptData.length;
  const totalSteps = scriptData.reduce((s, sec) =>
    s + sec.subSections.reduce((ss, sub) => ss + sub.actions.length, 0), 0);
  log(`✅ AI analysis complete — found ${totalSections} section(s), ${totalSteps} step(s)`);

  // Step 3: Playwright automation
  log('🌐 Launching browser automation...');
  const screenshotMap = await runPlaywright({
    scriptData,
    smartLinkUrl,
    iasUsername,
    iasPassword,
    screenshotsDir,
    log
  });
  log(`✅ Browser automation complete — ${Object.keys(screenshotMap).length} screenshot(s) captured`);

  // Step 4: Annotate screenshots
  log('🎨 Annotating screenshots with callouts...');
  const annotatedMap = await annotateScreenshots({
    scriptData,
    screenshotMap,
    annotatedDir,
    log
  });
  log(`✅ Annotation complete`);

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
  log('✅ Cleanup complete');

  return outputPath;
}

module.exports = { run };
