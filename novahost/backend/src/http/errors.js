/**
 * Application errors.
 *
 * Every failure the client can see carries a stable `code`. The frontend
 * translates codes into Arabic or English, so the English `message` here is a
 * fallback and a log line — never the thing a user is expected to read.
 *
 * Rule: no error ever leaks a filesystem path, a SQL fragment or a stack trace
 * to the client. Those go to the log, where they belong.
 */
export class AppError extends Error {
  constructor(code, message, { status = 400, details = null, cause = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    if (cause) this.cause = cause;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (this.details) error.details = this.details;
    return { success: false, error };
  }
}

export const errors = {
  badRequest: (code, message, details) => new AppError(code, message, { status: 400, details }),

  validation: (details, message = 'Some fields are invalid') =>
    new AppError('VALIDATION_ERROR', message, { status: 422, details }),

  unauthorised: (message = 'You need to sign in') =>
    new AppError('UNAUTHORIZED', message, { status: 401 }),

  forbidden: (message = 'You are not allowed to do that') =>
    new AppError('FORBIDDEN', message, { status: 403 }),

  notFound: (code = 'NOT_FOUND', message = 'Not found') =>
    new AppError(code, message, { status: 404 }),

  conflict: (code, message) => new AppError(code, message, { status: 409 }),

  tooLarge: (code, message) => new AppError(code, message, { status: 413 }),

  unsupportedMedia: (message = 'Unsupported content type') =>
    new AppError('UNSUPPORTED_MEDIA_TYPE', message, { status: 415 }),

  rateLimited: (message = 'Too many requests, slow down', retryAfter = 60) =>
    new AppError('RATE_LIMITED', message, { status: 429, details: { retryAfter } }),

  internal: (message = 'Something went wrong on the server', cause = null) =>
    new AppError('INTERNAL_ERROR', message, { status: 500, cause }),

  unavailable: (code = 'SERVICE_UNAVAILABLE', message = 'Temporarily unavailable') =>
    new AppError(code, message, { status: 503 }),
};

/**
 * Turn any thrown value into an AppError.
 * ValidationError instances from util/validate.js become a 422 with the failing
 * field attached; everything unexpected becomes a generic 500 so an internal
 * message never reaches the browser.
 */
export function normaliseError(err) {
  if (err instanceof AppError) return err;

  if (err?.name === 'ValidationError' && err.field) {
    return errors.validation([{ field: err.field, code: err.code, message: err.message }]);
  }

  // Path-safety failures from util/fsx.js.
  if (err?.code === 'PATH_TRAVERSAL' || err?.code === 'INVALID_PATH') {
    return new AppError('INVALID_PATH', 'That file path is not allowed', { status: 400 });
  }

  if (err?.code === 'ENOENT') return errors.notFound('FILE_NOT_FOUND', 'File not found');
  if (err?.code === 'EACCES' || err?.code === 'EPERM') {
    return new AppError('PERMISSION_DENIED', 'The server cannot access that file', { status: 500 });
  }
  if (err?.code === 'ENOSPC') {
    return new AppError('DISK_FULL', 'The device has run out of storage', { status: 507 });
  }
  if (err?.code === 'ENOTEMPTY') {
    return new AppError('DIRECTORY_NOT_EMPTY', 'That folder is not empty', { status: 409 });
  }

  // SQLite surfaces constraint violations as a message, not a structured code.
  if (typeof err?.message === 'string' && /UNIQUE constraint failed/i.test(err.message)) {
    return errors.conflict('ALREADY_EXISTS', 'That already exists');
  }

  return errors.internal('Something went wrong on the server', err);
}
