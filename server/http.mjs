// Мелкие помощники HTTP: чтение тела с лимитом, JSON-ответы, раздача файлов.
import { gzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { extname, join, normalize, sep } from 'node:path';

// Ошибка с кодом ответа; её текст показывается человеку, поэтому он по-русски.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooBig = new HttpError(413, 'Слишком большой файл или текст');
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) return chunks.push(chunk);
      // Лишнее не храним, но дочитываем, чтобы человек получил понятный ответ; явный перебор обрываем.
      chunks = [];
      if (size > limit * 8) {
        req.destroy();
        reject(tooBig);
      }
    });
    req.on('end', () => (size > limit ? reject(tooBig) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 128 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Ожидался JSON');
  const body = await readBody(req, limit);
  let value;
  try {
    value = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Не получилось разобрать запрос');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Не получилось разобрать запрос');
  return value;
}

export function sendJson(req, res, status, data, extra = {}) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = { 'content-type': TYPES['.json'], 'cache-control': 'no-store', ...extra };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }
  res.writeHead(status, headers).end(body);
}

// Путь внутри корня; выход за его пределы — как «не найдено».
export function resolveInside(root, urlPath) {
  const file = normalize(join(root, urlPath));
  if (!file.startsWith(root + sep)) throw new HttpError(404, 'Не найдено');
  return file;
}

export async function sendFile(req, res, file, cacheControl) {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, 'Не найдено');
  }
  if (!info.isFile()) throw new HttpError(404, 'Не найдено');

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': cacheControl,
    etag,
  };
  if (req.headers['if-none-match'] === etag) return res.writeHead(304, headers).end();
  headers['content-length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  // pipeline закрывает файл, если посетитель оборвал загрузку, и не роняет сервер,
  // если файл не открылся или чтение сорвалось: ответ просто обрывается.
  pipeline(createReadStream(file), res, (err) => {
    if (err) res.destroy();
  });
}
