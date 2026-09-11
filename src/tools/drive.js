import fs from 'node:fs';
import path from 'node:path';
import { drive } from '../google.js';
import { config } from '../config.js';

// Drive's query language treats ' and \ specially inside literals.
function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function searchFiles({ query, limit = 10 }) {
  const clauses = ['trashed = false'];
  if (query) clauses.push(`name contains '${escapeQuery(query)}'`);
  if (config.env.driveFolderId) clauses.push(`'${escapeQuery(config.env.driveFolderId)}' in parents`);

  const res = await drive().files.list({
    q: clauses.join(' and '),
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: Math.min(limit, 25),
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = (res.data.files || []).map((f) => ({
    id: f.id,
    الاسم: f.name,
    النوع: f.mimeType,
    الحجم: humanSize(f.size),
    آخر_تعديل: f.modifiedTime,
  }));
  return files.length ? { count: files.length, files } : { count: 0, files: [], نص: 'ما لقيتش ملفات بهذا الاسم.' };
}

// Google-native docs must be exported rather than downloaded as-is.
const EXPORT_MAP = {
  'application/vnd.google-apps.document': {
    mime: 'application/pdf', ext: '.pdf',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx',
  },
};

export async function downloadFile({ fileId }) {
  const meta = await drive().files.get({
    fileId, fields: 'id, name, mimeType, size', supportsAllDrives: true,
  });
  const { name, mimeType } = meta.data;
  const exportAs = EXPORT_MAP[mimeType];

  const res = exportAs
    ? await drive().files.export({ fileId, mimeType: exportAs.mime }, { responseType: 'arraybuffer' })
    : await drive().files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });

  const fileName = exportAs && !name.endsWith(exportAs.ext) ? `${name}${exportAs.ext}` : name;
  const localPath = path.join(config.paths.tmp, `${Date.now()}-${fileName.replace(/[/\\]/g, '_')}`);
  fs.writeFileSync(localPath, Buffer.from(res.data));

  return { path: localPath, name: fileName, mimeType: exportAs ? exportAs.mime : mimeType };
}

export async function uploadFile({ localPath, name, mimeType }) {
  const requestBody = { name };
  if (config.env.driveFolderId) requestBody.parents = [config.env.driveFolderId];

  const res = await drive().files.create({
    requestBody,
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return { id: res.data.id, الاسم: res.data.name, الرابط: res.data.webViewLink, الحالة: 'تم الحفظ في درايف' };
}
