import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Resolve a user-supplied relative path inside `root`, or throw.
 *
 * This is the single chokepoint every user-controlled path must pass through.
 * Getting it wrong is the difference between a file manager and an arbitrary
 * file-write vulnerability, so each step matters:
 *
 *  1. Reject NUL and control characters — they can truncate a path at the
 *     syscall boundary while looking harmless in a log line.
 *  2. Reject backslashes and drive letters so a Windows-style path cannot
 *     escape on a Windows host.
 *  3. Reject absolute paths outright.
 *  4. Normalise, then reject any remaining '..' segment.
 *  5. Resolve to an absolute path and verify it is the root itself or sits
 *     under `root + separator`. The trailing separator matters: a bare
 *     startsWith(root) check would happily accept "/data/storage-evil"
 *     when the root is "/data/storage".
 */
export function safeJoin(root, userPath) {
  const rootResolved = path.resolve(root);

  let rel = String(userPath ?? '');
  try {
    // Accept both encoded and decoded input; a malformed escape is an error.
    if (rel.includes('%')) rel = decodeURIComponent(rel);
  } catch {
    throw Object.assign(new Error('Invalid path encoding'), { code: 'INVALID_PATH' });
  }

  if (rel.includes('\0') || /[\u0000-\u001f\u007f]/.test(rel)) {
    throw Object.assign(new Error('Invalid characters in path'), { code: 'INVALID_PATH' });
  }
  if (rel.includes('\\')) {
    throw Object.assign(new Error('Backslashes are not allowed in paths'), { code: 'INVALID_PATH' });
  }
  if (/^[a-zA-Z]:/.test(rel)) {
    throw Object.assign(new Error('Drive letters are not allowed'), { code: 'INVALID_PATH' });
  }

  rel = rel.replace(/^\/+/, '');
  const normalised = path.posix.normalize(rel);
  if (normalised === '..' || normalised.startsWith('../') || normalised.split('/').includes('..')) {
    throw Object.assign(new Error('Path escapes the project directory'), { code: 'PATH_TRAVERSAL' });
  }

  const target = path.resolve(rootResolved, normalised === '.' ? '' : normalised);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw Object.assign(new Error('Path escapes the project directory'), { code: 'PATH_TRAVERSAL' });
  }
  return target;
}

/** Same rules as safeJoin but returns null instead of throwing. */
export function trySafeJoin(root, userPath) {
  try {
    return safeJoin(root, userPath);
  } catch {
    return null;
  }
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function removeRecursive(p) {
  await fsp.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

/**
 * Write a file by writing a sibling temp file and renaming it into place.
 * rename(2) is atomic within a filesystem, so a reader never observes a
 * half-written file — which matters for current.txt and manifest.json.
 */
export async function atomicWriteFile(target, data) {
  const dir = path.dirname(target);
  await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Recursively walk a directory, returning entries relative to `root`.
 * Symlinks are reported but never followed: following them would let a link
 * planted inside a project expose files from outside it.
 */
export async function walkDir(root, { maxEntries = 100_000 } = {}) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        out.push({ path: childRel, type: 'symlink', size: 0 });
        continue;
      }
      if (entry.isDirectory()) {
        out.push({ path: childRel, type: 'dir', size: 0 });
        stack.push(childRel);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await fsp.stat(path.join(root, childRel))).size;
        } catch { /* file vanished mid-walk; report it as zero rather than fail */ }
        out.push({ path: childRel, type: 'file', size });
      }
      if (out.length >= maxEntries) return out;
    }
  }
  return out;
}

/** Total bytes of every regular file under `dir`. Returns 0 for a missing dir. */
export async function directorySize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        try {
          total += (await fsp.stat(abs)).size;
        } catch { /* ignore */ }
      }
    }
  }
  return total;
}

/** Free bytes on the filesystem holding `dir`, or null when unsupported. */
export async function diskSpace(dir) {
  try {
    const st = await fsp.statfs(dir);
    return {
      total: Number(st.blocks) * Number(st.bsize),
      free: Number(st.bavail) * Number(st.bsize),
    };
  } catch {
    return null;
  }
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/** True when the path exists and is a plain file (not a symlink to one). */
export async function isRegularFile(p) {
  try {
    const st = await fsp.lstat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(p) {
  try {
    const st = await fsp.lstat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursive directory copy.
 *
 * Hand-written rather than fs.cp so the behaviour is explicit on the two points
 * that matter here: symlinks are skipped entirely (never copied, never
 * followed), and the copied byte count comes back so the caller can update the
 * project's storage figure without a second pass over the tree.
 */
export async function copyDirectory(source, destination) {
  let files = 0;
  let bytes = 0;

  async function copyInto(srcDir, destDir) {
    await ensureDir(destDir);
    let entries;
    try {
      entries = await fsp.readdir(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const from = path.join(srcDir, entry.name);
      const to = path.join(destDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await copyInto(from, to);
      } else if (entry.isFile()) {
        await fsp.copyFile(from, to);
        files += 1;
        try {
          bytes += (await fsp.stat(to)).size;
        } catch { /* ignore */ }
      }
    }
  }

  await copyInto(source, destination);
  return { files, bytes };
}

/** Read a small JSON file, returning `fallback` when missing or corrupt. */
export async function readJson(file, fallback = null) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
