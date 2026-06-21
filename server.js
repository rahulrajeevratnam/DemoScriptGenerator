'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execSync, spawn } = require('child_process');

const pipeline = require('./lib/pipeline');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['uploads', 'frames', 'screenshots', 'annotated', 'output', 'templates'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// In-memory job store
const jobs = {};

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only mp4, mov, webm videos are allowed'));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: List templates ───────────────────────────────────────────────────
app.get('/api/templates', (req, res) => {
  const templatesDir = path.join(__dirname, 'templates');
  try {
    const files = fs.readdirSync(templatesDir).filter(f =>
      f.endsWith('.docx') || f.endsWith('.pdf')
    );
    res.json({ templates: files });
  } catch {
    res.json({ templates: [] });
  }
});

// ─── API: Sync templates ───────────────────────────────────────────────────
app.post('/api/sync-templates', (req, res) => {
  const templatesDir = path.join(__dirname, 'templates');
  const repoUrl = process.env.TEMPLATES_REPO || 'https://github.com/rahul-demo-scripts/templates';

  try {
    const isGitRepo = fs.existsSync(path.join(templatesDir, '.git'));
    if (isGitRepo) {
      execSync('git pull', { cwd: templatesDir, timeout: 30000 });
      res.json({ success: true, message: 'Templates updated successfully.' });
    } else {
      try {
        execSync(`git clone "${repoUrl}" "${templatesDir}"`, { timeout: 60000 });
        res.json({ success: true, message: 'Templates cloned successfully.' });
      } catch (cloneErr) {
        res.json({
          success: false,
          message: `Templates repository not accessible. Please check ${repoUrl}. You can still generate scripts without a template.`
        });
      }
    }
  } catch (err) {
    res.json({ success: false, message: `Sync failed: ${err.message}` });
  }
});

// ─── API: Generate demo script ─────────────────────────────────────────────
app.post('/api/generate', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  const { description, smartLinkUrl, iasUsername, iasPassword, template } = req.body;
  if (!description || !smartLinkUrl || !iasUsername || !iasPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const jobId = uuidv4();
  jobs[jobId] = {
    status: 'running',
    logs: [],
    outputFile: null,
    startedAt: new Date()
  };

  // Run pipeline asynchronously
  setImmediate(() => {
    pipeline.run({
      jobId,
      videoPath: req.file.path,
      description,
      smartLinkUrl,
      iasUsername,
      iasPassword,
      template,
      jobs
    }).then(outputFile => {
      jobs[jobId].status = 'done';
      jobs[jobId].outputFile = outputFile;
      jobs[jobId].logs.push({ type: 'done', message: `✅ Demo script ready: ${path.basename(outputFile)}` });
    }).catch(err => {
      jobs[jobId].status = 'error';
      jobs[jobId].logs.push({ type: 'error', message: `❌ Pipeline failed: ${err.message}` });
    });
  });

  res.json({ jobId });
});

// ─── API: SSE status stream ────────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let sentIndex = 0;

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send buffered logs
  const flush = () => {
    while (sentIndex < job.logs.length) {
      send(job.logs[sentIndex]);
      sentIndex++;
    }
    if (job.status === 'done') {
      send({ type: 'done', outputFile: job.outputFile });
      clearInterval(interval);
      res.end();
    } else if (job.status === 'error') {
      send({ type: 'error' });
      clearInterval(interval);
      res.end();
    }
  };

  flush();
  const interval = setInterval(flush, 500);

  req.on('close', () => clearInterval(interval));
});

// ─── API: Download output ──────────────────────────────────────────────────
app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, 'output', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`DemoScriptGenerator running at http://localhost:${PORT}`);
});
