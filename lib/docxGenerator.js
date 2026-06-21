'use strict';

const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  AlignmentType, BorderStyle, TableRow, TableCell, Table,
  WidthType, ShadingType, convertMillimetersToTwip,
  patchDocument, PatchType
} = require('docx');

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ─── Colours ──────────────────────────────────────────────────────────────
const SAP_BLUE = '0070F2';
const GREY_LIGHT = 'F5F5F5';
const GREY_MED = 'E0E0E0';
const DARK_TEXT = '1A1A1A';

// ─── Helpers ──────────────────────────────────────────────────────────────
function pt(n) { return n * 2; }
function mm(n) { return convertMillimetersToTwip(n); }

function makeHRule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: SAP_BLUE } },
    spacing: { after: mm(4) }
  });
}

function makeParagraph(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text,
      font: 'Arial',
      size: pt(opts.size || 10),
      bold: opts.bold || false,
      color: opts.color || DARK_TEXT,
      italics: opts.italic || false
    })],
    spacing: { after: mm(opts.spaceAfter !== undefined ? opts.spaceAfter : 2) },
    alignment: opts.align || AlignmentType.LEFT
  });
}

function makeHeading1(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: pt(18), bold: true, color: DARK_TEXT })],
    spacing: { before: mm(6), after: mm(3) }
  });
}

function makeHeading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: pt(14), bold: true, color: DARK_TEXT })],
    spacing: { before: mm(5), after: mm(2) }
  });
}

function makeActionHeading(subSectionTitle, actionNum, stepNum) {
  return new Paragraph({
    children: [new TextRun({
      text: `Action ${actionNum} - ${subSectionTitle}: Step ${stepNum}`,
      font: 'Arial', size: pt(11), bold: true, color: SAP_BLUE
    })],
    spacing: { before: mm(4), after: mm(1) }
  });
}

function makeTalkTrack(text) {
  if (!text) return null;
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: pt(10), italics: true, color: '555555' })],
    spacing: { after: mm(2) }
  });
}

function makeCheckmarkBullet(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: '✓  ', font: 'Arial', size: pt(10), bold: true, color: SAP_BLUE }),
      new TextRun({ text, font: 'Arial', size: pt(10), color: DARK_TEXT })
    ],
    spacing: { after: mm(1) },
    indent: { left: mm(5) }
  });
}

function makeNumberedItem(num, text) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${num}. `, font: 'Arial', size: pt(10), bold: true, color: DARK_TEXT }),
      new TextRun({ text, font: 'Arial', size: pt(10), color: DARK_TEXT })
    ],
    spacing: { after: mm(1) },
    indent: { left: mm(5) }
  });
}

function makePersonaTable(persona) {
  const avatarCell = new TableCell({
    width: { size: mm(18), type: WidthType.DXA },
    shading: { fill: GREY_MED, type: ShadingType.CLEAR },
    children: [new Paragraph({
      children: [new TextRun({ text: '👤', size: pt(18) })],
      alignment: AlignmentType.CENTER,
      spacing: { before: mm(2), after: mm(2) }
    })]
  });

  const infoCell = new TableCell({
    shading: { fill: GREY_LIGHT, type: ShadingType.CLEAR },
    children: [
      new Paragraph({
        children: [new TextRun({ text: persona.name || 'User', font: 'Arial', size: pt(10), bold: true, color: DARK_TEXT })],
        spacing: { before: mm(2), after: mm(0.5) }
      }),
      new Paragraph({
        children: [new TextRun({ text: persona.role || 'Process Manager', font: 'Arial', size: pt(9), color: '555555' })],
        spacing: { after: mm(2) }
      })
    ]
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [avatarCell, infoCell] })],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE }
    }
  });
}

async function makeImageParagraph(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return new Paragraph({
      children: [new TextRun({ text: '[Screenshot not available]', font: 'Arial', size: pt(9), color: '999999', italics: true })],
      spacing: { after: mm(3) }
    });
  }

  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(imagePath);
  } catch {
    return new Paragraph({
      children: [new TextRun({ text: '[Screenshot could not be read]', font: 'Arial', size: pt(9), color: '999999', italics: true })],
      spacing: { after: mm(3) }
    });
  }

  let srcWidth = 1440;
  let srcHeight = 900;
  try {
    const meta = await sharp(imageBuffer).metadata();
    srcWidth = meta.width || 1440;
    srcHeight = meta.height || 900;
  } catch {}

  // A4 with 20mm margins: content width = 170mm = 643px at 96dpi
  const TARGET_WIDTH_PX = 643;
  const imgHeight = Math.round(TARGET_WIDTH_PX * (srcHeight / srcWidth));

  return new Paragraph({
    children: [new ImageRun({
      data: imageBuffer,
      transformation: { width: TARGET_WIDTH_PX, height: imgHeight }
    })],
    spacing: { after: mm(4) },
    alignment: AlignmentType.CENTER
  });
}

function makeGreyPlaceholderBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { fill: 'F0F0F0', type: ShadingType.CLEAR },
        children: [new Paragraph({
          children: [new TextRun({ text, font: 'Arial', size: pt(9), color: '888888', italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: mm(8), after: mm(8) }
        })]
      })]
    })],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: GREY_MED },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY_MED },
      left: { style: BorderStyle.SINGLE, size: 4, color: GREY_MED },
      right: { style: BorderStyle.SINGLE, size: 4, color: GREY_MED },
      insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE }
    }
  });
}

// ─── Cover page ───────────────────────────────────────────────────────────
function buildCoverPage(description, processHierarchy) {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  return [
    new Paragraph({ spacing: { after: mm(20) } }),
    new Paragraph({
      children: [new TextRun({ text: 'SAP Interactive Demo Script', font: 'Arial', size: pt(28), bold: true, color: SAP_BLUE })],
      alignment: AlignmentType.CENTER,
      spacing: { after: mm(6) }
    }),
    new Paragraph({
      children: [new TextRun({ text: description, font: 'Arial', size: pt(20), bold: true, color: DARK_TEXT })],
      alignment: AlignmentType.CENTER,
      spacing: { after: mm(10) }
    }),
    makeHRule(),
    new Paragraph({ spacing: { after: mm(6) } }),
    makeParagraph('Process Hierarchy', { size: 10, bold: true }),
    makeParagraph(processHierarchy || description, { size: 10, color: '555555' }),
    new Paragraph({ spacing: { after: mm(16) } }),
    makeParagraph(`Generated: ${today}`, { size: 9, color: '888888', align: AlignmentType.RIGHT }),
    new Paragraph({ children: [], pageBreakBefore: true })
  ];
}

// ─── Template-based generation ────────────────────────────────────────────
async function tryPatchTemplate(templatePath, patches) {
  const templateBuffer = fs.readFileSync(templatePath);
  const output = await patchDocument({ outputType: 'nodebuffer', data: templateBuffer, patches });
  return output;
}

function buildTextPatch(text) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun({ text, font: 'Arial', size: 20 })]
  };
}

// ─── Main generator ───────────────────────────────────────────────────────
async function generateDocx({ scriptData, annotatedMap, description, templatePath, outputPath, log }) {
  // Derive processHierarchy from first section that has it
  let processHierarchy = '';
  for (const sec of scriptData) {
    if (sec.processHierarchy) { processHierarchy = sec.processHierarchy; break; }
  }

  // If a .docx template is provided and contains our placeholder tokens, use patchDocument
  if (templatePath && fs.existsSync(templatePath) && path.extname(templatePath).toLowerCase() === '.docx') {
    try {
      const templateText = fs.readFileSync(templatePath).toString('latin1');
      const hasPlaceholders = templateText.includes('{{DEMO_TITLE}}') || templateText.includes('{{PROCESS_HIERARCHY}}');

      if (hasPlaceholders) {
        log('   Using template with placeholders...');
        const patches = {
          'DEMO_TITLE': buildTextPatch(description),
          'PROCESS_HIERARCHY': buildTextPatch(processHierarchy || description),
          'GENERATED_DATE': buildTextPatch(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }))
        };
        const output = await tryPatchTemplate(templatePath, patches);
        fs.writeFileSync(outputPath, output);
        log(`   Template-based document saved to ${path.basename(outputPath)}`);
        return;
      }
    } catch (patchErr) {
      log(`   ⚠️  Template patching failed (${patchErr.message}), generating from scratch`, 'warn');
    }
  }

  const children = [];

  // Cover page uses raw user description + AI-derived processHierarchy
  children.push(...buildCoverPage(description, processHierarchy));

  // Overview section before 3.1
  children.push(makeHeading1('Overview'));
  children.push(makeHRule());
  children.push(makeParagraph(
    `This demo script documents the ${description} process in SAP S/4HANA. ` +
    `The following sections walk through each step of the process, with annotated screenshots and presenter guidance.`,
    { size: 10, spaceAfter: 4 }
  ));
  children.push(makeGreyPlaceholderBox('[Overview screenshot placeholder]'));
  children.push(new Paragraph({ spacing: { after: mm(6) } }));

  let stepGlobal = 0;

  for (const section of scriptData) {
    // Global action counter resets per section
    let sectionActionCounter = 0;

    // Section heading
    children.push(makeHeading1(`${section.sectionNumber}. ${section.sectionTitle}`));
    children.push(makeHRule());
    if (section.sectionDescription) {
      children.push(makeParagraph(section.sectionDescription, { size: 10, spaceAfter: 4 }));
    }

    for (const subSection of section.subSections) {
      // Sub-section heading
      children.push(makeHeading2(`${subSection.subSectionNumber}. ${subSection.subSectionTitle}`));

      // Benefits block
      if (subSection.benefits && subSection.benefits.length > 0) {
        children.push(makeParagraph('Benefits', { size: 10, bold: true, spaceAfter: 1 }));
        for (const b of subSection.benefits) {
          children.push(makeCheckmarkBullet(b));
        }
        children.push(new Paragraph({ spacing: { after: mm(3) } }));
      }

      // Persona — shaded 2-col table
      if (subSection.persona) {
        children.push(makePersonaTable(subSection.persona));
        children.push(new Paragraph({ spacing: { after: mm(3) } }));
      }

      // Activity title + description
      if (subSection.activityTitle) {
        children.push(new Paragraph({
          children: [new TextRun({ text: subSection.activityTitle, font: 'Arial', size: pt(11), bold: true })],
          spacing: { before: mm(2), after: mm(1) }
        }));
      }
      if (subSection.activityDescription) {
        children.push(makeParagraph(subSection.activityDescription, { size: 10, spaceAfter: 4 }));
      }

      // Action steps
      for (const action of subSection.actions) {
        stepGlobal++;
        sectionActionCounter++;
        const stepKey = `step_${stepGlobal}`;

        // Action heading uses section-scoped counter
        children.push(makeActionHeading(subSection.subSectionTitle, sectionActionCounter, action.stepNumber || sectionActionCounter));

        // Talk track (italic, below heading)
        if (action.talkTrack) {
          const tt = makeTalkTrack(action.talkTrack);
          if (tt) children.push(tt);
        }

        // Sub-actions numbered list
        for (let i = 0; i < (action.subActions || []).length; i++) {
          children.push(makeNumberedItem(i + 1, action.subActions[i]));
        }

        // Annotated screenshot
        const imgPath = annotatedMap[stepKey];
        children.push(await makeImageParagraph(imgPath));
        children.push(new Paragraph({ spacing: { after: mm(2) } }));
      }

      children.push(new Paragraph({ spacing: { after: mm(6) } }));
    }

    // Page break between sections
    children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: mm(210), height: mm(297) },
          margin: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) }
        }
      },
      children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  log(`   Document saved to ${path.basename(outputPath)}`);
}

module.exports = generateDocx;
