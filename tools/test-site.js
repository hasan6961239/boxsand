/* اختبار موقع المخزون: خادم يقلّد الـWorker، ومتصفح حقيقي.
   شغّله وحده: node tools/test-site.js */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'site');
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = {'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};

/* الترويسات من netlify.toml نفسه، لا مكتوبة هنا بيدنا.
   بدونها كان الاختبار يفحص الملفات لا الموقع المنشور: سياسة الأمان
   منعت السكربت السطري على Netlify فظهرت صفحة بيضاء، والاختبار
   يمرّ لأن خادمه لم يكن يرسل السياسة أصلاً. */
function tomlHeaders(file) {
  const t = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const b of t.split(/\[\[headers\]\]/).slice(1)) {
    const m = b.match(/for\s*=\s*"([^"]+)"/);
    if (!m || m[1] !== '/*') continue;
    for (const h of b.matchAll(/^\s{4}([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)) out[h[1]] = h[2];
  }
  return out;
}
const HEADERS = tomlHeaders(path.join(SITE, 'netlify.toml'));
const ago = m => new Date(Date.now()-m*60000).toISOString().slice(0,16).replace('T',' ');

const PAYLOAD = { ok:true, branches:[
  { at: ago(6), branch:{id:'misrata',name:'مكتبة دار الحكمة',city:'مصراتة',phone:'091 234 5678'},
    items:[
      {n:'أساسيات الهندسة لتقنيات الورش',a:'د. سالم القدّافي',b:'9789991234567',c:'هندسة',k:'K0001',q:12,p:25,m:5,t:'book',l:'D',s:'1',d:'دار المعرفة',nt:'التخصص: هندسة ميكانيكية\nكتاب تمهيدي لطلبة السنة الأولى.'},
      {n:'تشريح جسم الإنسان',a:'د. منى الفيتوري',b:'',c:'طب بشري',k:'K0002',q:0,p:60,m:3,t:'book',l:'A',s:'2',d:'',nt:''},
      {n:'قلم جاف أزرق',b:'55512345',q:4,p:1.5,m:10,t:'stat',loc:'رف A',u:'قطعة'},
      {n:'دفتر 100 ورقة',b:'55599999',q:150,p:3,m:20,t:'stat',loc:'رف C',u:'قطعة'},
      {n:'أساسيات الهندسة لتقنيات الورش',a:'د. عمر الشريف',b:'9789990000111',c:'هندسة',k:'K0009',q:3,p:30,m:1,t:'book',l:'A',s:'1',d:'دار أخرى'}
    ],
    whs:[{id:'w1',name:'مخزن سوق الثلاثاء',place:'الطابق السفلي',phone:'092-111-2222',
      items:[{n:'أساسيات الهندسة لتقنيات الورش',q:40,p:25,b:'9789991234567',t:'book'}]}] },
  { at: ago(60*24*4), branch:{id:'tripoli',name:'فرع طرابلس',city:'طرابلس',phone:''},
    items:[{n:'أساسيات الهندسة لتقنيات الورش',a:'د. سالم القدّافي',b:'9789991234567',c:'هندسة',q:5,p:25,m:5,t:'book',l:'B',s:'3'}],
    whs:[] }
]};

const srv = http.createServer((q,s)=>{
  const u = new URL(q.url,'http://x');
  if (u.pathname === '/w/all') {
    if (q.headers['x-shop-key'] !== 'sirr') { s.writeHead(401,{'access-control-allow-origin':'*'}); return s.end('{"ok":false,"error":"unauthorized"}'); }
    s.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});
    return s.end(JSON.stringify(PAYLOAD));
  }
  const f = path.join(SITE, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, Object.assign({'content-type':MIME[path.extname(f)]||'text/plain'}, HEADERS));
  s.end(fs.readFileSync(f));
});

(async()=>{
  await new Promise(r=>srv.listen(18800,r));
  const b = await chromium.launch({executablePath:EXE, args:['--no-sandbox']});
  const pg = await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; 
  pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{
    const t = m.text();
    if (/Content Security Policy|Refused to/.test(t)) { errs.push('CSP: ' + t.slice(0,120)); return; }
    if (m.type()==='error' && !/favicon|404|Failed to load resource/.test(t)) errs.push('console: '+t);
  });
  let fail=0;
  const ok=(n,c,d)=>{console.log((c?'✓':'✗')+' '+n+(c?'':'  ← '+(d||''))); if(!c)fail++;};
  const SHOT = process.env.SHOT_DIR ? (process.env.SHOT_DIR + '/') : null;

  await pg.goto('http://127.0.0.1:18800/');
  await pg.waitForTimeout(500);

  // 0) الترويسات تصل فعلاً، وسياسة الأمان صارمة
  ok('سياسة الأمان مُرسَلة وصارمة',
     /script-src 'self'/.test(HEADERS['Content-Security-Policy']||'') &&
     !/unsafe-inline/.test(HEADERS['Content-Security-Policy']||''),
     HEADERS['Content-Security-Policy']);
  const inlineFree = await pg.evaluate(() => ({
    scripts: Array.from(document.querySelectorAll('script')).filter(s2 => !s2.src).length,
    handlers: document.querySelectorAll('[onclick],[oninput],[onchange],[onsubmit]').length
  }));
  ok('لا سكربت سطري في الصفحة', inlineFree.scripts === 0, JSON.stringify(inlineFree));
  ok('ولا معالج سطري', inlineFree.handlers === 0, JSON.stringify(inlineFree));
  ok('ولا نمط سطري (style-src صارم أيضاً)',
     /style-src 'self'/.test(HEADERS['Content-Security-Policy']||''),
     HEADERS['Content-Security-Policy']);

  // 1) شاشة الربط
  ok('شاشة الربط تظهر أولاً', await pg.isVisible('#gate') && !(await pg.isVisible('#app')));
  if (SHOT) await pg.screenshot({path:SHOT+'site-1-gate.png', fullPage:true});

  // 2) مفتاح خاطئ
  await pg.fill('#gUrl','http://127.0.0.1:18800/w');
  await pg.fill('#gKey','ghalat');
  await pg.click('#gateBtn'); await pg.waitForTimeout(900);
  const err = await pg.textContent('#gateErr');
  ok('كلمة سر خاطئة تُقال صراحةً', /غير صحيحة/.test(err||''), err);
  ok('ويبقى في شاشة الربط', await pg.isVisible('#gate'));

  // 3) ربط صحيح
  await pg.fill('#gKey','sirr');
  await pg.click('#gateBtn'); await pg.waitForTimeout(1200);
  ok('الربط الصحيح يدخل للتطبيق', await pg.isVisible('#app') && !(await pg.isVisible('#gate')));
  const shop = await pg.textContent('#shopName');
  ok('واسم المحل من اللقطة', /دار الحكمة/.test(shop||''), shop);
  if (SHOT) await pg.screenshot({path:SHOT+'site-2-home.png', fullPage:true});

  // 4) الأرقام
  const tiles = await pg.$$eval('.tile b', e=>e.map(x=>x.textContent.trim()));
  // 4 أصناف في مصراتة + 1 مخزن (نفس الكتاب) + طرابلس (نفس الكتاب) => 4 أصناف فريدة
  // خمسة أصناف: الكتابان المتشابهان اسماً يبقيان منفصلين بباركوديهما
  ok('عدد الأصناف الفريدة = 5', tiles[0]==='5', tiles.join(','));
  ok('القطع = 214 (12+40+5+0+4+150+3)', tiles[1]==='214', tiles.join(','));
  // المجموع هو الحَكَم: أساسيات مجموعها 57 فليست قاربت، والقلم 4 وحدّه 10
  ok('قارب على النفاد = 1 (القلم وحده)', tiles[2]==='1', tiles.join(','));
  ok('نفد = 1 (التشريح)', tiles[3]==='1', tiles.join(','));

  // 5) البحث بالاسم
  await pg.fill('#q','هندسة'); await pg.waitForTimeout(400);
  let rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('البحث بالاسم يجد الكتابين المتشابهين', rows.length===2, JSON.stringify(rows));

  // 6) البحث بالمؤلف
  await pg.fill('#q','الفيتوري'); await pg.waitForTimeout(400);
  rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('البحث بالمؤلف', rows.length===1 && /تشريح/.test(rows[0]), JSON.stringify(rows));

  // 7) البحث بالباركود
  await pg.fill('#q','55599999'); await pg.waitForTimeout(400);
  rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('البحث بالباركود', rows.length===1 && /دفتر/.test(rows[0]), JSON.stringify(rows));

  // 8) تطبيع الهمزة
  await pg.fill('#q','اساسيات'); await pg.waitForTimeout(400);
  rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('«اساسيات» تجد «أساسيات»', rows.length===2, JSON.stringify(rows));

  // 9) كلمتان
  await pg.fill('#q','هندسة ورش'); await pg.waitForTimeout(400);
  rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('كلمتان: كلتاهما يجب أن توجد', rows.length===2, JSON.stringify(rows));

  await pg.fill('#q','هندسة تشريح'); await pg.waitForTimeout(400);
  rows = await pg.$$eval('.row', e=>e.length);
  ok('كلمتان متنافيتان: لا نتائج', rows===0, 'rows='+rows);
  if (SHOT) await pg.screenshot({path:SHOT+'site-3-empty.png'});

  await pg.click('#qx'); await pg.waitForTimeout(400);
  ok('زر المسح يرجع الكل', (await pg.$$eval('.row', e=>e.length))===5);

  // 10) صفحة الصنف
  await pg.fill('#q','9789991234567'); await pg.waitForTimeout(400);
  await pg.click('.row'); await pg.waitForTimeout(600);
  const det = await pg.textContent('#sheet');
  ok('صفحة الصنف تفتح', await pg.isVisible('#sheet'));
  ok('فيها الاسم والمؤلف', /أساسيات/.test(det) && /سالم/.test(det));
  ok('وفيها الباركود', /9789991234567/.test(det));
  ok('وفيها الملاحظة', /هندسة ميكانيكية/.test(det));
  ok('وفيها المجموع 57 (12+40+5)', /57/.test(det), det.slice(0,60));
  ok('وتعرض الأماكن الثلاثة', (await pg.$$eval('.wrow', e=>e.length))===3);
  const stale = await pg.$$eval('.wrow.stale', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  ok('وطرابلس معلَّم قديماً (4 أيام)', stale.length===1 && /طرابلس/.test(stale[0]) && /4 يوم/.test(stale[0]), JSON.stringify(stale));
  ok('وفيه زر اتصال', (await pg.$$eval('a[href^="tel:"]', e=>e.length))>=1);
  if (SHOT) await pg.screenshot({path:SHOT+'site-4-detail.png'});
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  ok('Escape يغلق', !(await pg.isVisible('#sheet')));
  await pg.click('#qx'); await pg.waitForTimeout(300);

  // 11) الرقاقات
  const chips = await pg.$$eval('.chip', e=>e.map(x=>x.textContent.trim()));
  ok('رقاقة لكل تصنيف موجود', chips.some(c=>/هندسة/.test(c)) && chips.some(c=>/طب بشري/.test(c)), JSON.stringify(chips));
  await pg.click('.chip:has-text("نفد")'); await pg.waitForTimeout(500);
  rows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('فلترة «نفد»', rows.length===1 && /تشريح/.test(rows[0]), JSON.stringify(rows));
  await pg.click('.chip.on'); await pg.waitForTimeout(400);
  ok('الضغط ثانية يلغي الفلترة', (await pg.$$eval('.row', e=>e.length))===5);

  // 12) بلا باركود
  await pg.fill('#q','تشريح'); await pg.waitForTimeout(400);
  const noBc = await pg.textContent('.row');
  ok('الصنف بلا باركود معلَّم', /بلا باركود/.test(noBc), noBc.replace(/\s+/g,' ').slice(0,80));
  await pg.click('#qx'); await pg.waitForTimeout(300);

  // 13) الرأس يفرّق بين أحدث وأقدم
  const fresh = await pg.textContent('#freshLine');
  ok('الرأس يفصل أحدث عن أقدم', /أحدثها/.test(fresh)&&/أقدمها/.test(fresh), fresh);

  // 14) الإعدادات
  await pg.click('[aria-label="الإعدادات"]'); await pg.waitForTimeout(500);
  const st = await pg.textContent('#view');
  ok('الإعدادات تعرض الأماكن', /مخزن سوق الثلاثاء/.test(st) && /فرع طرابلس/.test(st));
  if (SHOT) await pg.screenshot({path:SHOT+'site-5-settings.png', fullPage:true});
  await pg.click('button:has-text("رجوع للمخزون")'); await pg.waitForTimeout(400);

  // 15) بلا إنترنت
  srv.close();
  await pg.click('#btnRefresh'); await pg.waitForTimeout(1500);
  ok('بلا اتصال يعرض آخر نسخة', (await pg.$$eval('.row', e=>e.length))===5);
  const warn = await pg.textContent('#toasts');
  ok('ويقول إنها ليست جديدة', /آخر نسخة/.test(warn||''), warn);

  // 16) يتذكّر بعد إعادة الفتح (نعيد تشغيل الخادم أولاً)
  const srv2 = http.createServer(srv.listeners('request')[0]);
  await new Promise(r=>srv2.listen(18800,r));
  await pg.reload({waitUntil:'domcontentloaded'}); await pg.waitForTimeout(1400);
  ok('يتذكّر الربط والبيانات بعد إعادة الفتح',
     await pg.isVisible('#app') && (await pg.$$eval('.row', e=>e.length))===5);

  /* النمط السطري يُمنع بصمت: لا خطأ في التنفيذ، فقط تنسيق لا يُطبَّق.
     لذلك نفحص الصفحة نفسها بعد أن امتلأت. */
  const inlineStyles = await pg.$$eval('[style]', e => e.length);
  ok('لا عنصر يحمل style سطرياً بعد الرسم', inlineStyles === 0, 'count=' + inlineStyles);

  // 17) الخطأ الذي بلّغ عنه صاحب المحل: كتابان باسم واحد كانا يندمجان
  const grouped = await pg.evaluate(() => {
    const all = UI.items();
    const eng = all.filter(g => g.n.indexOf('أساسيات') >= 0);
    return { count: eng.length, totals: eng.map(g => g.total).sort((a,b)=>b-a),
             recs: UI.S.snap ? null : null };
  });
  ok('كتابان مختلفان باسم واحد يبقيان صنفين', grouped.count===2, JSON.stringify(grouped));
  ok('ولا تُجمع كميتاهما (57 و3 لا 60)',
     grouped.totals[0]===57 && grouped.totals[1]===3, JSON.stringify(grouped.totals));

  // 18) النمط: تلقائي ← فاتح ← ليلي ← تلقائي
  const themes = [];
  for (let i=0;i<4;i++){
    themes.push(await pg.evaluate(()=>document.documentElement.getAttribute('data-theme')));
    await pg.click('#btnTheme'); await pg.waitForTimeout(250);
  }
  ok('زر النمط يدور بين الثلاثة',
     themes.join(',')==='auto,light,dark,auto', themes.join(','));
  const kept = await pg.evaluate(()=>({
    saved: JSON.parse(localStorage.getItem('maktaba_stock_v2')).theme,
    dom: document.documentElement.getAttribute('data-theme')
  }));
  ok('والاختيار يُحفظ ويطابق المعروض', kept.saved===kept.dom, JSON.stringify(kept));

  // 19) تصفّح المكتبات والرفوف
  await pg.click('#tabs button[data-arg="browse"]'); await pg.waitForTimeout(600);
  const libs = await pg.$$eval('.lib-card .lib-badge', e=>e.map(x=>x.textContent.trim()));
  ok('شاشة الرفوف تعرض المكتبات', libs.length>=2 && libs.indexOf('A')>=0 && libs.indexOf('D')>=0,
     JSON.stringify(libs));

  await pg.click('.lib-card'); await pg.waitForTimeout(500);
  const shelfTiles = await pg.$$eval('.shelf-tile .sh-n', e=>e.map(x=>x.textContent.trim()));
  ok('واختيار مكتبة يعرض رفوفها', shelfTiles.length>=1, JSON.stringify(shelfTiles));

  await pg.click('.shelf-tile'); await pg.waitForTimeout(500);
  const onShelfRows = await pg.$$eval('.row-name', e=>e.map(x=>x.textContent.trim()));
  ok('واختيار رف يعرض ما فيه وحده', onShelfRows.length>=1 && onShelfRows.length<5,
     JSON.stringify(onShelfRows));
  const crumbs = await pg.$$eval('.crumb button, .crumb .cur', e=>e.map(x=>x.textContent.trim()));
  ok('ومسار الرجوع ظاهر', crumbs.length===3, JSON.stringify(crumbs));
  await pg.click('.crumb button'); await pg.waitForTimeout(450);
  ok('والرجوع يعمل', (await pg.$$eval('.lib-card', e=>e.length))>=2);

  // 20) شاشة الملخّص
  await pg.click('#tabs button[data-arg="stats"]'); await pg.waitForTimeout(600);
  const heroTxt = await pg.textContent('.hero');
  ok('الملخّص يعرض قيمة المخزون', /قيمة المخزون/.test(heroTxt), heroTxt.slice(0,50));
  const catRows = await pg.$$eval('.cat-row .cat-n', e=>e.map(x=>x.textContent.trim()));
  ok('ويعرض التصنيفات', catRows.indexOf('هندسة')>=0, JSON.stringify(catRows));
  await pg.click('.cat-row'); await pg.waitForTimeout(500);
  ok('والضغط على تصنيف يصفّي به', (await pg.$$eval('.row', e=>e.length))>=1);

  // 21) الترتيب
  await pg.evaluate(()=>UI.go('home')); await pg.waitForTimeout(400);
  await pg.evaluate(()=>{ UI.S.filter=''; UI.render(); }); await pg.waitForTimeout(300);
  await pg.click('.sortbar button[data-arg="qty"]'); await pg.waitForTimeout(450);
  const byQty = await pg.$$eval('.pill', e=>e.map(x=>parseInt(x.textContent,10)));
  ok('الترتيب بالأكثر عدداً يعمل',
     byQty.length>1 && byQty[0]>=byQty[1], JSON.stringify(byQty));

  // 22) رابط التهيئة يملأ البيانات ويمسح نفسه
  await pg.evaluate(()=>localStorage.removeItem('maktaba_stock_v2'));
  await pg.goto('http://127.0.0.1:18800/#u=http%3A%2F%2F127.0.0.1%3A18800%2Fw&k=sirr');
  await pg.waitForTimeout(1300);
  ok('رابط التهيئة يربط مباشرة بلا إدخال يدوي', await pg.isVisible('#app'));
  ok('ويمسح كلمة السر من شريط العنوان',
     !/k=|sirr/.test(await pg.evaluate(()=>location.href)),
     await pg.evaluate(()=>location.href));

  ok('لا أخطاء JavaScript ولا انتهاك لسياسة الأمان', errs.length===0, errs.slice(0,3).join(' | '));

  await b.close(); srv2.close();
  console.log('\n' + '='.repeat(46));
  console.log(fail ? '  فشل: ' + fail : '  كل اختبارات الموقع نجحت');
  console.log('='.repeat(46) + '\n');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
