import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_DIR = process.env.NETZWERKPLANER_DATA_DIR || '/app/data';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function safeName(name = 'plan') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'plan';
}

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Keine Datei übermittelt.' }, { status: 400 });
  }

  const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
  if (!allowed.has(file.type)) {
    return Response.json({ error: 'Unterstützt werden PDF, PNG, JPG und WEBP.' }, { status: 415 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const id = randomUUID();
  const filename = `${id}__${safeName(file.name)}`;
  const target = path.join(UPLOAD_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(target, buffer);

  return Response.json({
    id,
    name: file.name,
    mime: file.type,
    size: buffer.length,
    url: `/api/plans?id=${encodeURIComponent(id)}`,
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'Plan-ID fehlt.' }, { status: 400 });

  await mkdir(UPLOAD_DIR, { recursive: true });
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(UPLOAD_DIR));
  const filename = entries.find((entry) => entry.startsWith(`${id}__`));
  if (!filename) return Response.json({ error: 'Plan nicht gefunden.' }, { status: 404 });

  const filePath = path.join(UPLOAD_DIR, filename);
  const data = await readFile(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  return new Response(data, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
    },
  });
}
