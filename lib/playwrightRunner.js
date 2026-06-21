'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

async function runPlaywright({ scriptData, smartLinkUrl, iasUsername, iasPassword, screenshotsDir, log }) {
  const screenshotMap = {};
  let stepGlobal = 0;

  // Try to load playwright — it may not be installed in restricted environments
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    log('   ⚠️  Playwright/Chromium not available — using placeholder screenshots', 'warn');
    return buildPlaceholderScreenshots(scriptData, screenshotsDir, log);
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  } catch (launchErr) {
    log(`   ⚠️  Browser launch failed: ${launchErr.message} — using placeholder screenshots`, 'warn');
    return buildPlaceholderScreenshots(scriptData, screenshotsDir, log);
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  try {
    // Navigate to the smart link
    log(`   Navigating to: ${smartLinkUrl}`);
    await page.goto(smartLinkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // IAS Login
    await performIASLogin(page, iasUsername, iasPassword, log);

    // Execute each action step
    for (const section of scriptData) {
      for (const subSection of section.subSections) {
        for (const action of subSection.actions) {
          stepGlobal++;
          const stepKey = `step_${stepGlobal}`;
          log(`   Step ${stepGlobal}: ${action.title} — executing...`);

          try {
            await executeAction(page, action, log);

            // Wait for page to settle
            try {
              await page.waitForLoadState('networkidle', { timeout: 5000 });
            } catch {
              await page.waitForTimeout(1000);
            }

            // Take screenshot
            const screenshotPath = path.join(screenshotsDir, `${stepKey}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: false });
            screenshotMap[stepKey] = screenshotPath;
            log(`   Step ${stepGlobal}: ${action.title} — screenshot captured ✓`);
          } catch (err) {
            log(`   ⚠️  Step ${stepGlobal} error: ${err.message} — using fallback screenshot`, 'warn');
            // Use last successful screenshot or take current state
            try {
              const screenshotPath = path.join(screenshotsDir, `${stepKey}.png`);
              await page.screenshot({ path: screenshotPath, fullPage: false });
              screenshotMap[stepKey] = screenshotPath;
            } catch {
              // Use last screenshot if available
              const lastKey = `step_${stepGlobal - 1}`;
              if (screenshotMap[lastKey]) {
                screenshotMap[stepKey] = screenshotMap[lastKey];
              }
            }
          }

          // Store step key back in action for later reference
          action._screenshotKey = stepKey;
        }
      }
    }
  } finally {
    await browser.close();
  }

  return screenshotMap;
}

async function performIASLogin(page, username, password, log) {
  log('   Attempting IAS login...');

  try {
    // Wait for login form — IAS typically shows email input first
    await page.waitForSelector(
      'input[type="email"], input[type="text"][name*="user"], input[id*="user"], input[id*="email"], input[placeholder*="email" i], input[placeholder*="user" i]',
      { timeout: 15000 }
    );

    log('   Login form detected');

    // Fill username/email
    const emailInput = page.locator(
      'input[type="email"], input[type="text"][name*="user"], input[id*="user"], input[id*="email"]'
    ).first();
    await emailInput.fill(username);

    // Some IAS pages require clicking "Next" before password
    const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue"), input[value="Next"]');
    const hasNext = await nextBtn.count() > 0;
    if (hasNext) {
      await nextBtn.first().click();
      await page.waitForTimeout(1500);
    }

    // Fill password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="password"]').first().fill(password);

    // Click sign in
    const signInBtn = page.locator(
      'button[type="submit"], button:has-text("Sign In"), button:has-text("Log On"), button:has-text("Login"), input[type="submit"]'
    ).first();
    await signInBtn.click();

    // Wait for navigation away from login page
    await page.waitForURL(url => !url.toString().includes('login') && !url.toString().includes('auth'), {
      timeout: 20000
    }).catch(() => {
      log('   ⚠️  Login redirect not detected — continuing anyway', 'warn');
    });

    log('   IAS login complete ✓');
  } catch (err) {
    log(`   ⚠️  Login step issue: ${err.message} — continuing`, 'warn');
  }
}

async function executeAction(page, action, log) {
  const { playwrightAction, selector } = action;

  if (!selector && playwrightAction !== 'navigate') return;

  switch (playwrightAction) {
    case 'click': {
      await page.locator(selector).first().click({ timeout: 10000 });
      break;
    }
    case 'fill': {
      const value = action.fillValue || action.subActions[0]?.match(/'([^']+)'/)?.[1] || '';
      await page.locator(selector).first().fill(value, { timeout: 10000 });
      break;
    }
    case 'navigate': {
      if (selector && selector.startsWith('http')) {
        await page.goto(selector, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
      break;
    }
    case 'select': {
      const value = action.selectValue || '';
      await page.locator(selector).first().selectOption(value, { timeout: 10000 });
      break;
    }
    case 'waitForSelector': {
      await page.waitForSelector(selector, { timeout: 10000 });
      break;
    }
    default:
      // For unknown actions, try a click
      if (selector) {
        await page.locator(selector).first().click({ timeout: 8000 }).catch(() => {});
      }
  }
}

// ─── Placeholder screenshots when browser unavailable ─────────────────────
async function buildPlaceholderScreenshots(scriptData, screenshotsDir, log) {
  const screenshotMap = {};
  let stepGlobal = 0;

  for (const section of scriptData) {
    for (const subSection of section.subSections) {
      for (const action of subSection.actions) {
        stepGlobal++;
        const stepKey = `step_${stepGlobal}`;
        const screenshotPath = path.join(screenshotsDir, `${stepKey}.png`);

        try {
          // Generate a placeholder 1440×900 image with step label
          const svgContent = `<svg width="1440" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect width="1440" height="900" fill="#F4F6F8"/>
            <rect x="20" y="20" width="1400" height="60" fill="#0070F2" rx="4"/>
            <text x="730" y="58" text-anchor="middle" font-family="Arial" font-size="28" font-weight="bold" fill="white">SAP System — ${escapeXml(action.title)}</text>
            <rect x="20" y="100" width="1400" height="780" fill="#FFFFFF" rx="4" stroke="#D9DCE0" stroke-width="1"/>
            <text x="730" y="480" text-anchor="middle" font-family="Arial" font-size="18" fill="#888888">Step ${stepGlobal}: ${escapeXml(action.title)}</text>
            <text x="730" y="520" text-anchor="middle" font-family="Arial" font-size="14" fill="#AAAAAA">[Browser automation screenshot — install Playwright Chromium to capture live screenshots]</text>
          </svg>`;

          await sharp(Buffer.from(svgContent))
            .png()
            .toFile(screenshotPath);

          screenshotMap[stepKey] = screenshotPath;
          log(`   Step ${stepGlobal}: ${action.title} — placeholder created`);
          action._screenshotKey = stepKey;
        } catch (err) {
          log(`   ⚠️  Could not create placeholder for step ${stepGlobal}: ${err.message}`, 'warn');
        }
      }
    }
  }

  return screenshotMap;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = runPlaywright;
