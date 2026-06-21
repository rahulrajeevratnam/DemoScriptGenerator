'use strict';

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  AlignmentType, BorderStyle, TableRow, TableCell, Table,
  WidthType, ShadingType, CheckBox, NumberFormat,
  convertInchesToTwip, convertMillimetersToTwip,
  PageOrientation, UnderlineType, SectionType,
  LevelFormat, AbstractNumbering, Numbering,
  LineRuleType
} = require('docx');

const fs = require('fs');
const path = require('path');

// ─── Colours ──────────────────────────────────────────────────────────────
const SAP_BLUE = '0070F2';
const ORANGE = 'FF6B00';
const GREY_LIGHT = 'F5F5F5';
const GREY_MED = 'CCCCCC';
const WHITE = 'FFFFFF';
const BLACK = '000000';
const DARK_TEXT = '1A1A1A';

// ─── Helpers ──────────────────────────────────────────────────────────────
function pt(n) { return n * 2; } // half-points (docx unit)
function mm(n) { return convertMillimetersToTwip(n); }

function spacingAfter(pt_val) {
  return { after: pt(pt_val) };
}

function makeHRule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: SAP_BLUE } },
    spacing: { after: mm(4) }
  });
}

function makeParagraph(text, opts = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: 'Arial',
        size: pt(opts.size || 10),
        bold: opts.bold || false,
        color: opts.color || DARK_TEXT,
        italics: opts.italic || false
      })
    ],
    spacing: { after: mm(opts.spaceAfter !== undefined ? opts.spaceAfter : 2) },
    alignment: opts.align || AlignmentType.LEFT
  });
}

function makeHeading1(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: 'Arial',
        size: pt(18),
        bold: true,
        color: DARK_TEXT
      })
    ],
    spacing: { before: mm(6), after: mm(3) }
  });
}

function makeHeading2(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: 'Arial',
        size: pt(14),
        bold: true,
        color: DARK_TEXT
      })
    ],
    spacing: { before: mm(5), after: mm(2) }
  });
}

function makeActionHeading(sectionTitle, actionNum, stepNum) {
  return new Paragraph({
    children: [
      new TextRun({
        text: `Action ${actionNum} - ${sectionTitle}: Step ${stepNum}`,
        font: 'Arial',
        size: pt(11),
        bold: true,
        color: SAP_BLUE
      })
    ],
    spacing: { before: mm(4), after: mm(2) }
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

function makeLabeledBlock(label, content) {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: label, font: 'Arial', size: pt(10), bold: true, color: DARK_TEXT })
      ],
      spacing: { before: mm(2), after: mm(1) }
    }),
    ...(Array.isArray(content) ? content : [content])
  ];
}

async function makeImageParagraph(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return new Paragraph({
      children: [
        new TextRun({ text: '[Screenshot not available]', font: 'Arial', size: pt(9), color: '999999', italics: true })
      ],
      spacing: { after: mm(3) }
    });
  }

  const imageBuffer = fs.readFileSync(imagePath);

  // Get actual image dimensions via sharp
  let srcWidth = 1440;
  let srcHeight = 900;
  try {
    const sharp = require('sharp');
    const meta = await sharp(imageBuffer).metadata();
    srcWidth = meta.width || 1440;
    srcHeight = meta.height || 900;
  } catch {}

  // docx ImageRun.transformation uses pixels at 96 DPI.
  // A4 content width with 20mm margins = 170mm = 170/25.4 * 96 ≈ 643 px.
  const TARGET_WIDTH_PX = 643;
  const aspectRatio = srcHeight / srcWidth;
  const imgWidth = TARGET_WIDTH_PX;
  const imgHeight = Math.round(TARGET_WIDTH_PX * aspectRatio);

  return new Paragraph({
    children: [
      new ImageRun({
        data: imageBuffer,
        transformation: { width: imgWidth, height: imgHeight }
      })
    ],
    spacing: { after: mm(4) },
    alignment: AlignmentType.CENTER
  });
}

// ─── Cover page ───────────────────────────────────────────────────────────
function buildCoverPage(description) {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  return [
    new Paragraph({ spacing: { after: mm(20) } }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'SAP Interactive Demo Script',
          font: 'Arial',
          size: pt(28),
          bold: true,
          color: SAP_BLUE
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: mm(6) }
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: description,
          font: 'Arial',
          size: pt(20),
          bold: true,
          color: DARK_TEXT
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: mm(10) }
    }),
    makeHRule(),
    new Paragraph({ spacing: { after: mm(8) } }),
    makeParagraph('Process Hierarchy', { size: 10, bold: true }),
    makeParagraph('Procure to Receipt  >  Manage Purchase Requisitions  >  Purchase Requisition Processing', {
      size: 10,
      color: '555555'
    }),
    new Paragraph({ spacing: { after: mm(16) } }),
    makeParagraph(`Generated: ${today}`, { size: 9, color: '888888', align: AlignmentType.RIGHT }),
    new Paragraph({
      children: [],
      pageBreakBefore: true
    })
  ];
}

// ─── Main generator ───────────────────────────────────────────────────────
async function generateDocx({ scriptData, annotatedMap, description, outputPath, log }) {
  const children = [];

  // Cover page
  children.push(...buildCoverPage(description));

  let stepGlobal = 0;

  for (const section of scriptData) {
    // Section heading
    children.push(makeHeading1(`${section.sectionNumber}. ${section.sectionTitle}`));
    children.push(makeHRule());
    children.push(makeParagraph(section.sectionDescription, { size: 10, spaceAfter: 4 }));

    for (const subSection of section.subSections) {
      // Sub-section heading
      children.push(makeHeading2(`${subSection.subSectionNumber}. ${subSection.subSectionTitle}`));

      // Benefits block
      children.push(...makeLabeledBlock('Benefits', subSection.benefits.map(b => makeCheckmarkBullet(b))));

      // Persona block
      children.push(new Paragraph({ spacing: { before: mm(3), after: mm(1) } }));
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Persona:  ', font: 'Arial', size: pt(10), bold: true }),
          new TextRun({ text: `${subSection.persona.name}`, font: 'Arial', size: pt(10), bold: true }),
          new TextRun({ text: `  —  ${subSection.persona.role}`, font: 'Arial', size: pt(10), color: '555555' })
        ],
        spacing: { after: mm(3) }
      }));

      // Activity title + description
      children.push(new Paragraph({
        children: [
          new TextRun({ text: subSection.activityTitle, font: 'Arial', size: pt(11), bold: true })
        ],
        spacing: { before: mm(2), after: mm(1) }
      }));
      children.push(makeParagraph(subSection.activityDescription, { size: 10, spaceAfter: 4 }));

      // End-state screenshot (last action's screenshot)
      const lastAction = subSection.actions[subSection.actions.length - 1];
      if (lastAction) {
        const lastKey = `step_${stepGlobal + subSection.actions.length}`;
        const lastAnnotated = annotatedMap[lastKey];
        if (lastAnnotated) {
          const endStatePara = await makeImageParagraph(lastAnnotated);
          children.push(makeParagraph('End-State Result:', { size: 9, bold: true, color: '555555' }));
          children.push(endStatePara);
        }
      }

      // Action steps
      for (const action of subSection.actions) {
        stepGlobal++;
        const stepKey = `step_${stepGlobal}`;

        children.push(makeActionHeading(subSection.subSectionTitle, action.actionNumber, action.stepNumber));

        // Sub-actions numbered list
        for (let i = 0; i < action.subActions.length; i++) {
          children.push(makeNumberedItem(i + 1, action.subActions[i]));
        }

        // Annotated screenshot
        const imgPath = annotatedMap[stepKey];
        const imgPara = await makeImageParagraph(imgPath);
        children.push(imgPara);
        children.push(new Paragraph({ spacing: { after: mm(2) } }));
      }

      children.push(new Paragraph({ spacing: { after: mm(6) } }));
    }

    // Page break between sections
    children.push(new Paragraph({
      children: [],
      pageBreakBefore: true
    }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: mm(210), height: mm(297) },
            margin: {
              top: mm(20),
              bottom: mm(20),
              left: mm(20),
              right: mm(20)
            }
          }
        },
        children
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  log(`   Document saved to ${path.basename(outputPath)}`);
}

module.exports = generateDocx;
