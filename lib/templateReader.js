'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Extracts plain text from a .docx file by unzipping word/document.xml
 * and stripping XML tags. Returns empty string on any failure.
 */
function extractDocxText(templatePath) {
  if (!templatePath || !fs.existsSync(templatePath)) return '';
  const ext = path.extname(templatePath).toLowerCase();
  if (ext !== '.docx') return '';

  try {
    const xml = execSync(`unzip -p "${templatePath}" word/document.xml`, {
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024
    }).toString('utf8');

    // Strip XML tags and collapse whitespace
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Return up to 3000 chars — enough for structure context without blowing token budget
    return text.slice(0, 3000);
  } catch {
    return '';
  }
}

module.exports = { extractDocxText };
