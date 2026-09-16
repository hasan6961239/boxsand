import { AppError, normaliseError } from './errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('http');

/**
 * Every API response uses the same envelope:
 *   success:  { "success": true,  "data": ... }
 *   failure:  { "success": false, "error": { "code": "...", "message": "..." } }
 *
 * One shape means the frontend has one code path for errors instead of a guess
 * per endpoint.
 */
export function json(res, data, status = 200, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = JSON.stringify({ success: true, data });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function noContent(res) {
  if (res.writableEnded) return;
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export function fail(res, err, context = {}) {
  if (res.writableEnded) return;
  const appError = normaliseError(err);

  if (appError.status >= 500) {
    log.error(appError.message, {
      code: appError.code,
      ...context,
      cause: appError.cause?.message,
      stack: appError.cause?.stack ?? err?.stack,
    });
  } else if (appError.status === 429 || appError.status === 401 || appError.status === 403) {
    log.warn(`${appError.code}: ${appError.message}`, context);
  } else {
    log.debug(`${appError.code}: ${appError.message}`, context);
  }

  const payload = appError.toJSON();
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  };
  if (appError.status === 429 && appError.details?.retryAfter) {
    headers['Retry-After'] = String(appError.details.retryAfter);
  }
  res.writeHead(appError.status, headers);
  res.end(body);
}

/** Plain-text/HTML response used by the site server, not the API. */
export function sendHtml(res, html, status = 200, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders,
  });
  res.end(body);
}

export { AppError };
