'use strict';

const path = require('path');
const fs = require('fs');
const extractFrames = require('./frameExtractor');
const analyseVideo = require('./aiAnalyser');
const runPlaywright = require('./playwrightRunner');
const annotateScreenshots = require('./annotator');
const generateDocx = require('./docxGenerator');
const { pickFrameForStep } = require('./framePicker');

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

  // Step 3: Build screenshot map from video frames (primary source)
  // Playwright live replay is used only to verify login works;
  // screenshots come from the actual recorded video frames for accuracy.
  log('🖼️  Mapping video frames to script steps...');
  const screenshotMap = await buildFrameBasedScreenshots({
    scriptData,
    frames,
    screenshotsDir,
    log
  });
  log(`✅ Frame mapping complete — ${Object.keys(screenshotMap).length} screenshot(s) ready`);

  // Step 3b: Optionally attempt live login screenshot for cover (non-blocking)
  await attemptLiveLoginScreenshot({
    smartLinkUrl, iasUsername, iasPassword, screenshotsDir, log
  });

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

// Map each action step to the best matching video frame
async function buildFrameBasedScreenshots({ scriptData, frames, screenshotsDir, log }) {
  const sharp = require('sharp');
  const screenshotMap = {};
  let stepGlobal = 0;

  // Total steps for even distribution when frameNumber isn't set
  const totalSteps = scriptData.reduce((s, sec) =>
    s + sec.subSections.reduce((ss, sub) => ss + sub.actions.length, 0), 0);

  for (const section of scriptData) {
    for (const subSection of section.subSections) {
      for (const action of subSection.actions) {
        stepGlobal++;
        const stepKey = `step_${stepGlobal}`;

        // Use AI-provided frameNumber, or distribute evenly across frames
        const frameIdx = pickFrameForStep(action.frameNumber, stepGlobal, totalSteps, frames.length);
        const sourcePath = frames[frameIdx];

        if (!sourcePath || !fs.existsSync(sourcePath)) {
          log(`   ⚠️  No frame available for step ${stepGlobal}`, 'warn');
          continue;
        }

        const destPath = path.join(screenshotsDir, `${stepKey}.png`);

        try {
          // Convert/copy frame to PNG at full quality for the document
          await sharp(sourcePath)
            .png()
            .toFile(destPath);
          screenshotMap[stepKey] = destPath;
          log(`   Step ${stepGlobal}: ${action.title} — frame ${frameIdx + 1} selected`);
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

// Non-blocking: try to capture the live authenticated home screen
async function attemptLiveLoginScreenshot({ smartLinkUrl, iasUsername, iasPassword, screenshotsDir, log }) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return;
  }

  log('🌐 Attempting live login screenshot...');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(smartLinkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Login
    const hasLogin = await page.locator('input[type="email"], input[type="password"], input[id*="user"], input[id*="email"]').count() > 0;
    if (hasLogin) {
      const emailInput = page.locator('input[type="email"], input[type="text"][name*="user"], input[id*="user"], input[id*="email"]').first();
      await emailInput.fill(iasUsername).catch(() => {});
      const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue")');
      if (await nextBtn.count() > 0) {
        await nextBtn.first().click();
        await page.waitForTimeout(1500);
      }
      const pwInput = page.locator('input[type="password"]').first();
      await pwInput.fill(iasPassword).catch(() => {});
      const signIn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log On")').first();
      await signIn.click().catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    await page.screenshot({ path: path.join(screenshotsDir, 'live_home.png'), fullPage: false });
    log('✅ Live login screenshot captured');
  } catch (err) {
    log(`   ℹ️  Live screenshot skipped: ${err.message}`, 'info');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { run };
