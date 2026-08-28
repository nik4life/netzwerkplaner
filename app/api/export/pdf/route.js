import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_DIR = process.env.NETZWERKPLANER_DATA_DIR || '/app/data';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const TYPE_INFO = {
  bruestsung: { label: 'Brüstungskanal', color: rgb(0.09, 0.41, 0.88) },
  aufputz: { label: 'Aufputz', color: rgb(0.85, 0.42, 0.06) },
  decke: { label: 'Deckendose', color: rgb(0.07, 0.52, 0.34) },
  sonder: { label: 'Sonderbedarf', color: rgb(0.48, 0.29, 0.72) },
};

function safeFilename(value = 'netzwerkplan') {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'netzwerkplan';
}

async function getUpload(plan) {
  if (!plan?.id) throw new Error('Plan-ID fehlt.');
  const entries = await readdir(UPLOAD_DIR);
  const filename = entries.find((entry) => entry.startsWith(`${plan.id}__`));
  if (!filename) throw new Error('Originalplan wurde nicht gefunden.');
  return { filename, bytes: await readFile(path.join(UPLOAD_DIR, filename)) };
}

function yFromPercent(pageHeight, value) {
  return pageHeight - (Number(value || 0) / 100) * pageHeight;
}

function xFromPercent(pageWidth, value) {
  return (Number(value || 0) / 100) * pageWidth;
}

function totalPorts(markers = []) {
  return markers.reduce((sum, marker) => sum + Number(marker.ports || 0), 0);
}

function drawLegend(page, font, bold, floor) {
  const { width, height } = page.getSize();
  const markers = floor.markers || [];
  const boxWidth = Math.min(250, width * 0.26);
  const rows = Object.entries(TYPE_INFO);
  const boxHeight = 48 + rows.length * 17;
  const x = 14;
  const y = height - boxHeight - 14;

  page.drawRectangle({ x, y, width: boxWidth, height: boxHeight, color: rgb(1, 1, 1), opacity: 0.9, borderColor: rgb(0.55, 0.6, 0.65), borderWidth: 0.7 });
  page.drawText(`${floor.name || 'Etage'} - ${totalPorts(markers)} Ports`, { x: x + 10, y: y + boxHeight - 18, size: 10, font: bold, color: rgb(0.05, 0.1, 0.15) });
  page.drawText(`${markers.length} Portpunkte`, { x: x + 10, y: y + boxHeight - 32, size: 8, font, color: rgb(0.3, 0.35, 0.4) });

  rows.forEach(([key, info], index) => {
    const typeMarkers = markers.filter((marker) => marker.type === key);
    const ports = totalPorts(typeMarkers);
    const rowY = y + boxHeight - 51 - index * 17;
    page.drawRectangle({ x: x + 10, y: rowY + 1, width: 8, height: 8, color: info.color });
    page.drawText(info.label, { x: x + 24, y: rowY, size: 7.5, font, color: rgb(0.1, 0.14, 0.18) });
    page.drawText(`${ports} P / ${typeMarkers.length} Punkte`, { x: x + boxWidth - 88, y: rowY, size: 7.5, font: bold, color: rgb(0.1, 0.14, 0.18) });
  });
}

function drawPlanAnnotations(page, font, bold, floor) {
  const { width, height } = page.getSize();

  for (const channel of floor.channels || []) {
    page.drawLine({
      start: { x: xFromPercent(width, channel.x1), y: yFromPercent(height, channel.y1) },
      end: { x: xFromPercent(width, channel.x2), y: yFromPercent(height, channel.y2) },
      thickness: Math.max(1.2, width / 850),
      color: rgb(0.86, 0.08, 0.1),
      opacity: 0.9,
    });
  }

  const markerSize = Math.max(5, Math.min(10, width / 140));
  for (const marker of floor.markers || []) {
    const info = TYPE_INFO[marker.type] || TYPE_INFO.sonder;
    const x = xFromPercent(width, marker.x);
    const y = yFromPercent(height, marker.y);
    page.drawRectangle({ x: x - markerSize / 2, y: y - markerSize / 2, width: markerSize, height: markerSize, color: info.color, borderColor: rgb(1, 1, 1), borderWidth: 0.8 });
    const text = String(Number(marker.ports || 0));
    const size = Math.max(4.5, markerSize * 0.55);
    const tw = bold.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x - tw / 2, y: y - size * 0.35, size, font: bold, color: rgb(1, 1, 1) });
  }

  drawLegend(page, font, bold, floor);
}

function drawTableHeader(page, font, bold, projectName, floor, pageNumber, totalPages) {
  const { width, height } = page.getSize();
  const margin = 34;
  page.drawText(projectName || 'Netzwerkplaner', { x: margin, y: height - 42, size: 18, font: bold, color: rgb(0.05, 0.1, 0.15) });
  page.drawText(`Auswertung ${floor.name || 'Etage'} - ${(floor.markers || []).length} Portpunkte - ${totalPorts(floor.markers || [])} Ports`, { x: margin, y: height - 62, size: 10, font, color: rgb(0.3, 0.35, 0.4) });
  page.drawText(`Seite ${pageNumber}/${totalPages}`, { x: width - margin - 55, y: height - 42, size: 8, font, color: rgb(0.4, 0.45, 0.5) });
}

function drawTablePages(pdfDoc, font, bold, projectName, floor) {
  const markers = floor.markers || [];
  const pageSize = [841.89, 595.28]; // A4 landscape
  const margin = 34;
  const rowHeight = 17;
  const firstRowY = pageSize[1] - 92;
  const rowsPerPage = Math.max(1, Math.floor((firstRowY - 45) / rowHeight) - 1);
  const totalPages = Math.max(1, Math.ceil(markers.length / rowsPerPage));
  const cols = [
    { label: '#', width: 34 },
    { label: 'Montageart', width: 135 },
    { label: 'Ports', width: 50 },
    { label: 'Kanal', width: 62 },
    { label: 'Position X', width: 64 },
    { label: 'Position Y', width: 64 },
    { label: 'Notiz', width: 330 },
  ];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdfDoc.addPage(pageSize);
    const { width } = page.getSize();
    drawTableHeader(page, font, bold, projectName, floor, pageIndex + 1, totalPages);

    let y = firstRowY;
    let x = margin;
    page.drawRectangle({ x: margin, y: y - 3, width: width - margin * 2, height: rowHeight + 5, color: rgb(0.92, 0.94, 0.96) });
    for (const col of cols) {
      page.drawText(col.label, { x: x + 4, y: y + 3, size: 8, font: bold, color: rgb(0.08, 0.12, 0.16) });
      x += col.width;
    }
    y -= rowHeight;

    const start = pageIndex * rowsPerPage;
    const end = Math.min(markers.length, start + rowsPerPage);
    for (let index = start; index < end; index += 1) {
      const marker = markers[index];
      const values = [
        String(index + 1),
        TYPE_INFO[marker.type]?.label || marker.type || '',
        String(marker.ports || 0),
        marker.channelId ? 'ja' : 'nein',
        `${Number(marker.x || 0).toFixed(1)} %`,
        `${Number(marker.y || 0).toFixed(1)} %`,
        String(marker.note || '').replace(/[\r\n]+/g, ' ').slice(0, 90),
      ];
      x = margin;
      page.drawLine({ start: { x: margin, y: y - 3 }, end: { x: width - margin, y: y - 3 }, thickness: 0.35, color: rgb(0.83, 0.86, 0.89) });
      values.forEach((value, colIndex) => {
        page.drawText(value, { x: x + 4, y: y + 2, size: 7.2, font, color: rgb(0.12, 0.16, 0.2) });
        x += cols[colIndex].width;
      });
      y -= rowHeight;
    }
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const floor = body?.floor;
    if (!floor?.plan) return Response.json({ error: 'Für diese Etage ist kein Plan hinterlegt.' }, { status: 400 });

    const { bytes } = await getUpload(floor.plan);
    let pdfDoc;

    if (floor.plan.mime === 'application/pdf') {
      pdfDoc = await PDFDocument.load(bytes);
    } else {
      pdfDoc = await PDFDocument.create();
      let image;
      if (floor.plan.mime === 'image/png') image = await pdfDoc.embedPng(bytes);
      else if (floor.plan.mime === 'image/jpeg') image = await pdfDoc.embedJpg(bytes);
      else return Response.json({ error: 'WEBP-Planexport wird noch nicht unterstützt.' }, { status: 415 });
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    drawPlanAnnotations(pdfDoc.getPage(0), font, bold, floor);
    drawTablePages(pdfDoc, font, bold, body.projectName, floor);

    const output = await pdfDoc.save();
    const filename = `${safeFilename(body.projectName)}_${safeFilename(floor.name || 'Etage')}_Netzwerkplan.pdf`;
    return new Response(Buffer.from(output), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'PDF-Export fehlgeschlagen.' }, { status: 500 });
  }
}
