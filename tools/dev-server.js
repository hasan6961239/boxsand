/* خادم تطوير: يحاكي نواة Program.cs بنفس عقد الـAPI.
   للاختبار على لينكس/ماك فقط — المنتج النهائي هو الـEXE.
   شغّله:  node tools/dev-server.js   ثم افتح http://127.0.0.1:17845/ */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), APP = path.join(ROOT, 'app');
const DATA = process.env.QI_DATA || path.join(ROOT, '.devdata');
const STORE = path.join(DATA, 'store.json'), PREV = path.join(DATA, 'store.previous.json');
const BACKUPS = path.join(DATA, 'backups'), PROFIT = path.join(DATA, 'profit.hash');
const PORT = 17845;
fs.mkdirSync(BACKUPS, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

let owner = '', ownerSeen = 0;
const OWNER_TTL = 12000;
const hashCode = c => crypto.createHash('sha256').update('qirtasiya-profit-v1|' + c).digest('base64');

function json(res, o, code = 200) {
  const b = Buffer.from(JSON.stringify(o));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
}
function validJson(buf) { try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v); } catch { return false; } }
function isOwner(req) { return owner && Date.now() - ownerSeen <= OWNER_TTL && req.headers['x-owner'] === owner; }

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    let p = req.url.split('?')[0];
    try { p = decodeURIComponent(p); } catch { }

    if (p === '/api/release' && req.method === 'POST') {
      const m = req.url.match(/[?&]t=([^&]+)/);
      const tok = m ? decodeURIComponent(m[1]) : req.headers['x-owner'];
      if (owner && tok === owner) { owner = ''; ownerSeen = 0; }
      return json(res, { ok: true });
    }

    if (p.startsWith('/api/')) {
      const want = '127.0.0.1:' + PORT;
      if (req.headers.host !== want) return json(res, { ok: false, error: 'forbidden' }, 403);
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + want) return json(res, { ok: false, error: 'forbidden' }, 403);
      if (req.headers['x-qirtasiya'] !== '1') return json(res, { ok: false, error: 'forbidden' }, 403);

      const needOwner = ['/api/save', '/api/restore', '/api/backup', '/api/backup-dir',
        '/api/uninstall', '/api/profit-code', '/api/archive'].includes(p);
      if (needOwner && !isOwner(req)) return json(res, { ok: false, notOwner: true }, 409);
    }

    if (p === '/api/claim' && req.method === 'POST') {
      const force = body.toString().includes('"force":true');
      const free = !owner || Date.now() - ownerSeen > OWNER_TTL;
      if (free || force) { owner = crypto.randomBytes(16).toString('hex'); ownerSeen = Date.now(); return json(res, { ok: true, token: owner }); }
      return json(res, { ok: false, busy: true });
    }
    if (p === '/api/heartbeat' && req.method === 'POST') {
      if (owner && req.headers['x-owner'] === owner) { ownerSeen = Date.now(); return json(res, { ok: true }); }
      return json(res, { ok: false, notOwner: true });
    }
    if (p === '/api/profit-unlock' && req.method === 'POST') {
      let code = ''; try { code = (JSON.parse(body.toString()).code || '').trim(); } catch { }
      const want = fs.existsSync(PROFIT) ? fs.readFileSync(PROFIT, 'utf8').trim() : hashCode('Rtv8ss3i');
      return json(res, { ok: hashCode(code) === want });
    }
    if (p === '/api/profit-code' && req.method === 'POST') {
      let code = ''; try { code = (JSON.parse(body.toString()).code || '').trim(); } catch { }
      if (code.length < 4) return json(res, { ok: false, error: 'الرمز قصير جداً' });
      fs.writeFileSync(PROFIT, hashCode(code)); return json(res, { ok: true });
    }
    if (p === '/api/backup-dir') return json(res, { ok: true });

    if (p === '/api/archive' && req.method === 'POST') {
      let o = {}; try { o = JSON.parse(body.toString()); } catch { }
      if (!/^\d{4}$/.test(String(o.year || ''))) return json(res, { ok: false, error: 'سنة غير صالحة' });
      if (!Array.isArray(o.invoices) || !o.invoices.length) return json(res, { ok: false, error: 'لا توجد فواتير للأرشفة' });
      fs.mkdirSync(path.join(DATA, 'archive'), { recursive: true });
      fs.writeFileSync(path.join(DATA, 'archive', 'invoices-' + o.year + '.json'), JSON.stringify(o.invoices));
      return json(res, { ok: true, file: 'archive/invoices-' + o.year + '.json' });
    }
    if (p === '/api/archives') {
      const dir = path.join(DATA, 'archive');
      if (!fs.existsSync(dir)) return json(res, []);
      return json(res, fs.readdirSync(dir).filter(f => f.startsWith('invoices-')).sort().reverse()
        .map(f => ({ year: f.replace('invoices-', '').replace('.json', ''), size: fs.statSync(path.join(dir, f)).size })));
    }
    if (p === '/api/archive-read') {
      const m = req.url.match(/[?&]year=(\d{4})/);
      if (!m) return json(res, { ok: false, error: 'سنة غير صالحة' });
      const f = path.join(DATA, 'archive', 'invoices-' + m[1] + '.json');
      if (!fs.existsSync(f)) return json(res, { ok: false, error: 'لا يوجد أرشيف لهذه السنة' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(fs.readFileSync(f));
    }

    if (p === '/api/load') {
      let d = fs.existsSync(STORE) ? fs.readFileSync(STORE) : Buffer.from('null');
      if (d.length < 2 && fs.existsSync(PREV)) d = fs.readFileSync(PREV);
      if (d.length < 2) d = Buffer.from('null');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(d);
    }
    if (p === '/api/save' && req.method === 'POST') {
      if (!validJson(body)) return json(res, { ok: false, error: 'محتوى غير صالح — لم يُكتب شيء' });
      if (fs.existsSync(STORE)) fs.copyFileSync(STORE, PREV);
      fs.writeFileSync(STORE, body);
      return json(res, { ok: true });
    }
    if (p === '/api/backup' && req.method === 'POST') {
      const name = 'backup-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      if (fs.existsSync(STORE)) fs.copyFileSync(STORE, path.join(BACKUPS, name));
      return json(res, { ok: true, name });
    }
    if (p === '/api/backups') {
      const list = fs.readdirSync(BACKUPS).filter(f => f.startsWith('backup-')).sort().reverse()
        .map(f => { const st = fs.statSync(path.join(BACKUPS, f)); return { name: f, size: st.size, date: st.mtime.toISOString().slice(0, 16).replace('T', ' ') }; });
      return json(res, list);
    }
    if (p === '/api/restore' && req.method === 'POST') {
      let name = ''; try { name = JSON.parse(body.toString()).name || ''; } catch { }
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return json(res, { ok: false, error: 'اسم ملف غير صالح' });
      const src = path.join(BACKUPS, name);
      if (!fs.existsSync(src)) return json(res, { ok: false, error: 'النسخة غير موجودة' });
      fs.copyFileSync(src, STORE); return json(res, { ok: true });
    }
    if (p === '/api/license') return json(res, { ok: true, active: true, fp: 'ABCD-EFGH-JKLM', until: 'دائم' });
    if (p === '/api/activate') return json(res, { ok: true, until: 'دائم' });
    if (p === '/api/preset') return json(res, { ok: false });
    if (p === '/api/notify') { console.log('[notify]', body.toString().slice(0, 300)); return json(res, { ok: true }); }
    if (p === '/api/sync') { console.log('[sync]'); return json(res, { ok: true, branches: [] }); }
    if (p === '/api/open-folder' || p === '/api/quit' || p === '/api/uninstall') return json(res, { ok: true });

    /* تقليد /api/info في النواة: الإصدار وختم البناء */
    if (p === '/api/info') {
      const ver = (fs.readFileSync(path.join(ROOT, 'src', 'Program.cs'), 'utf8')
        .match(/AppVersion\s*=\s*"([^"]+)"/) || [])[1] || '?';
      const stamp = (fs.readFileSync(path.join(ROOT, 'src', 'BuildInfo.cs'), 'utf8')
        .match(/Stamp\s*=\s*"([^"]*)"/) || [])[1] || '';
      return json(res, { ok: true, version: ver, build: stamp, dataDir: DATA, port: PORT });
    }

    if (p === '/') p = '/index.html';
    if (p.includes('..')) { res.writeHead(400); return res.end('bad path'); }
    /* كود الـWorker مدمج في الـEXE باسم worker.js — نقلّد ذلك هنا */
    if (p === '/worker.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'cloud', 'worker.js')));
    }
    const root = APP + path.sep;
    const file = path.resolve(path.join(APP, p.replace(/^\/+/, '')));
    if (!file.startsWith(root)) { res.writeHead(400); return res.end('bad path'); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  });
}).listen(PORT, '127.0.0.1', () => console.log('dev core: http://127.0.0.1:' + PORT + '/  (data: ' + DATA + ')'));
