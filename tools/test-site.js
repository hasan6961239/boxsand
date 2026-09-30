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

const pad = x => (x<10?'0':'')+x;
const dayKey = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const TODAY = dayKey(new Date()), YDAY = dayKey(new Date(Date.now()-864e5));
const PAYLOAD = { ok:true, branches:[
  { at: ago(6), branch:{id:'misrata',name:'مكتبة دار الحكمة',city:'مصراتة',phone:'091 234 5678'},
    items:[
      {n:'أساسيات الهندسة لتقنيات الورش',a:'د. سالم القدّافي',b:'9789991234567',c:'هندسة',k:'K0001',q:12,st:9,p:25,m:5,t:'book',l:'D',s:'1',d:'دار المعرفة',nt:'التخصص: هندسة ميكانيكية\nكتاب تمهيدي لطلبة السنة الأولى.'},
      {n:'تشريح جسم الإنسان',a:'د. منى الفيتوري',b:'',c:'طب بشري',k:'K0002',q:0,p:60,m:3,t:'book',l:'A',s:'2',d:'',nt:''},
      {n:'قلم جاف أزرق',b:'55512345',q:4,p:1.5,m:10,t:'stat',loc:'رف A',u:'قطعة',sl:210},
      {n:'دفتر 100 ورقة',b:'55599999',c:'أمراض النساء والتوليد (Obstetrics and Gynecology / MRCOG Part 1 Preparation) مرجع طويل جداً',q:150,p:3,m:20,t:'stat',loc:'رف C',u:'قطعة'},
      {n:'أساسيات الهندسة لتقنيات الورش',a:'د. عمر الشريف',b:'9789990000111',c:'هندسة',k:'K0009',q:3,p:30,m:1,t:'book',l:'A',s:'1',d:'دار أخرى'}
    ],
    whs:[{id:'w1',name:'مخزن سوق الثلاثاء',place:'الطابق السفلي',phone:'092-111-2222',
      items:[{n:'أساسيات الهندسة لتقنيات الورش',q:40,p:25,b:'9789991234567',t:'book'}]}],
    /* منظومة 2.6: لوحة اليوم والزبائن وتأكيد فواتير التلفون */
    dash:{ today:TODAY, cur:'د.ل', days:{ [TODAY]:{v:175,n:3,q:5}, [YDAY]:{v:60,n:1,q:2} },
      recent:[{no:3,d:TODAY,at:'10:05',t:75,m:'cash',k:'sale',n:'أساسيات الهندسة لتقنيات الورش',q:3},
              {no:2,d:TODAY,at:'09:40',t:100,m:'credit',k:'sale',c:'محمد الفيتوري',n:'تشريح جسم الإنسان',q:2,ph:1}] },
    cust:[{id:'c1',n:'محمد الفيتوري',ph:'0912345678',b:85},{id:'c2',n:'مكتبة الأمل',ph:'',b:0},{id:'c3',n:'أحمد',ph:'0923334444',b:12.5}],
    acks:{}, phoneSell:true },
  { at: ago(60*24*4), branch:{id:'tripoli',name:'فرع طرابلس',city:'طرابلس',phone:''},
    items:[{n:'أساسيات الهندسة لتقنيات الورش',a:'د. سالم القدّافي',b:'9789991234567',c:'هندسة',q:5,p:25,m:5,t:'book',l:'B',s:'3'}],
    whs:[] }
]};

const PUTS = [];
const srv = http.createServer((q,s)=>{
  const u = new URL(q.url,'http://x');
  /* التلفون يرفع ملفه (طلبات البيع) كما يفعل أي فرع */
  if (u.pathname === '/w/put' && q.method === 'POST') {
    if (q.headers['x-shop-key'] !== 'sirr') { s.writeHead(401,{'access-control-allow-origin':'*'}); return s.end('{"ok":false}'); }
    let body=''; q.on('data',c=>body+=c); return q.on('end',()=>{
      const snap = JSON.parse(body); PUTS.push(snap);
      PAYLOAD.branches = PAYLOAD.branches.filter(b=>b.branch.id!==snap.branch.id).concat([snap]);
      s.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'}); s.end('{"ok":true}');
    });
  }
  if (q.method === 'OPTIONS') { s.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,X-Shop-Key'}); return s.end(); }
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

  // 3ب) الخطأ الذي صوّره صاحب المحل: تصنيف طويل كان يوسّع الصفحة
  const fit = await pg.evaluate(() => {
    const t = document.getElementById('tabs').getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, w: innerWidth, tabsBottom: Math.round(t.bottom), h: innerHeight };
  });
  ok('الصفحة لا تتّسع عن عرض التلفون مع تصنيف طويل', fit.sw <= fit.w, JSON.stringify(fit));
  ok('والشريط السفلي ظاهر داخل الشاشة', fit.tabsBottom <= fit.h && fit.tabsBottom > fit.h - 120, JSON.stringify(fit));

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
  ok('وتعرض الأماكن الأربعة (الرفوف، غرفة الخزين، المخزن، طرابلس)', (await pg.$$eval('.wrow', e=>e.length))===4);
  const split = await pg.$$eval('.det-split b', e=>e.map(x=>x.textContent.trim()));
  ok('وتفرّق بين الرفوف (3 مصراتة + 5 طرابلس) وغرفة الخزين (9)', split.join()==='8,9', JSON.stringify(split));
  ok('وصف الغرفة يذكر مكان الكتاب على الرفوف', /مكانه على الرفوف: D · رف 1/.test(det), det.slice(0,40));
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
  await pg.evaluate(()=>UI.go('browse')); await pg.waitForTimeout(600);
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
  await pg.evaluate(()=>UI.go('stats')); await pg.waitForTimeout(600);
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

  // 23) غرفة الخزين في الرئيسية والرفوف
  await pg.evaluate(()=>{ UI.S.filter=''; UI.S.q=''; UI.go('home'); }); await pg.waitForTimeout(700);
  const tiles2 = await pg.$$eval('.tile b', e=>e.map(x=>x.textContent.trim()));
  ok('المجموع لم يتغيّر بوجود غرفة الخزين (214)', tiles2[1]==='214', tiles2.join(','));
  ok('بطاقة «غرفة الخزين» في الرئيسية', /غرفة الخزين: 9 نسخة من 1 صنف/.test(await pg.textContent('.note-card.room')));
  ok('وشارة «في المخزن 9» على سطر الكتاب',
     (await pg.$$eval('.tag.rm', e=>e.map(x=>x.textContent.trim()))).some(t=>/في المخزن 9/.test(t)));
  await pg.click('.chip:has-text("في غرفة الخزين")'); await pg.waitForTimeout(500);
  ok('ورقاقة «في غرفة الخزين» تصفّي به', (await pg.$$eval('.row', e=>e.length))===1);
  await pg.evaluate(()=>{ UI.S.filter=''; }); 
  await pg.evaluate(()=>UI.go('browse')); await pg.waitForTimeout(700);
  ok('الرفوف تحت «المزيد» والكبسولة تنزلق إليه (الرابع)', await pg.$eval('#tabs .tab-glider', e=>e.classList.contains('p3')));
  await pg.click('.room-card'); await pg.waitForTimeout(600);
  ok('وصفحة الغرفة في شاشة الرفوف', /غرفة الخزين/.test(await pg.textContent('.sec-head')) &&
     (await pg.$$eval('.row', e=>e.length))===1);
  await pg.click('.crumb button'); await pg.waitForTimeout(500);
  const dLib = await pg.$$eval('.lib-card', e=>e.map(x=>x.textContent.replace(/\s+/g,' ')));
  ok('ومكتبة D تحسب الرفوف وحدها (3 لا 12)', dLib.some(t=>/مكتبة D/.test(t) && /3 قطعة/.test(t)), JSON.stringify(dLib));
  ok('ولا style سطري بعد الحركات', (await pg.$$eval('[style]:not(body)', e=>e.length))===0);

  // 22) رابط التهيئة يملأ البيانات ويمسح نفسه
  await pg.evaluate(()=>localStorage.removeItem('maktaba_stock_v2'));
  await pg.goto('http://127.0.0.1:18800/#u=http%3A%2F%2F127.0.0.1%3A18800%2Fw&k=sirr');
  await pg.waitForTimeout(1300);
  ok('رابط التهيئة يربط مباشرة بلا إدخال يدوي', await pg.isVisible('#app'));
  ok('ويمسح كلمة السر من شريط العنوان',
     !/k=|sirr/.test(await pg.evaluate(()=>location.href)),
     await pg.evaluate(()=>location.href));

  // 24) داخل تطبيق أندرويد: جسر مزيّف بدل التلفون
  {
    const actx = await b.newContext({viewport:{width:390,height:844}});
    const ap = await actx.newPage();
    ap.on('pageerror',e=>errs.push('APP PAGEERROR: '+e.message));
    await ap.addInitScript(() => { window.AndroidApp = { scan(){ window.__scans = (window.__scans||0) + 1; }, version(){ return '1.0'; } }; });
    await ap.goto('http://127.0.0.1:18800/#u=http%3A%2F%2F127.0.0.1%3A18800%2Fw&k=sirr'); await ap.waitForTimeout(1500);
    ok('التطبيق: زر الكاميرا يظهر بجانب البحث', await ap.isVisible('#qcam'));
    await ap.click('#qcam'); await ap.waitForTimeout(200);
    ok('والضغط عليه يطلب المسح من التلفون', await ap.evaluate(()=>window.__scans===1));
    await ap.evaluate(()=>UI.onScan('9789991234567')); await ap.waitForTimeout(700);
    ok('نتيجة المسح تفتح صفحة الكتاب مباشرة', await ap.isVisible('#sheet') && /أساسيات/.test(await ap.textContent('#sheet')));
    ok('والباركود في خانة البحث', await ap.inputValue('#q')==='9789991234567');
    ok('الرجوع يغلق صفحة الكتاب أولاً', await ap.evaluate(()=>UI.back())===true);
    await ap.waitForTimeout(400);
    ok('فتُغلق', !(await ap.isVisible('#sheet')));
    await ap.evaluate(()=>UI.go('stats')); await ap.waitForTimeout(400);
    ok('من صفحة داخل «المزيد» يرجع إلى «المزيد»', await ap.evaluate(()=>UI.back()===true && UI.S.screen==='more'));
    ok('ثم إلى «اليوم» (أول تبويب)', await ap.evaluate(()=>UI.back()===true && UI.S.screen==='dash'));
    ok('ثم يمسح البحث', await ap.evaluate(()=>UI.back())===true && await ap.inputValue('#q')==='');
    ok('ومن «اليوم» بلا بحث يسمح بإغلاق التطبيق', await ap.evaluate(()=>UI.back())===false);
    await ap.evaluate(()=>UI.onScan('000000')); await ap.waitForTimeout(400);
    ok('باركود غير موجود يُنبَّه عليه', /لا يوجد صنف بالباركود/.test(await ap.textContent('#toasts')));
    ok('ولا style سطري في وضع التطبيق', (await ap.$$eval('[style]:not(body)', e=>e.length))===0);
    if (SHOT) await ap.screenshot({path:SHOT+'app-home.png'});
    await actx.close();
  }
  // 25) شاشات التطبيق الجديدة والبيع من التلفون
  {
    const cx = await b.newContext({viewport:{width:390,height:844}});
    const ap = await cx.newPage();
    ap.on('pageerror',e=>errs.push('APP2 PAGEERROR: '+e.message));
    ap.on('console',m=>{ const t=m.text(); if (/Content Security Policy|Refused to/.test(t)) errs.push('APP2 CSP: '+t.slice(0,120)); });
    await ap.addInitScript(() => { window.__cfg = []; window.AndroidApp = { scan(){}, version(){ return '1.1'; }, setConfig(j){ window.__cfg.push(JSON.parse(j)); } }; });
    await ap.goto('http://127.0.0.1:18800/#u=http%3A%2F%2F127.0.0.1%3A18800%2Fw&k=sirr'); await ap.waitForTimeout(1600);
    const tabs = await ap.$$eval('#tabs button', e=>e.map(x=>x.getAttribute('data-tab')));
    ok('التطبيق: خمسة تبويبات (اليوم، المخزون، بيع، الخزين، المزيد)', tabs.join()==='dash,home,sell,room,more', tabs.join());
    ok('وبيانات الربط تصل لأندرويد للإشعارات', await ap.evaluate(()=>window.__cfg.length>0 && window.__cfg[window.__cfg.length-1].key==='sirr'));

    await ap.evaluate(()=>UI.go('dash')); await ap.waitForTimeout(900);
    ok('لوحة اليوم: مبيعات اليوم 175', /175\.00/.test(await ap.textContent('.dash-hero')));
    ok('وآخر الفواتير مع فاتورة التلفون معلَّمة', (await ap.$$eval('.row.inv', e=>e.length))===2 && /من التلفون/.test(await ap.textContent('.rows')));
    ok('ونقاط أيام الشهر', (await ap.$$eval('.mdots i', e=>e.length))>=28);
    if (SHOT) await ap.screenshot({path:SHOT+'app-dash.png'});

    await ap.evaluate(()=>UI.go('more')); await ap.waitForTimeout(700);
    ok('«المزيد»: ستّ بطاقات', (await ap.$$eval('.more-tile', e=>e.length))===6);
    if (SHOT) await ap.screenshot({path:SHOT+'app-more.png'});
    await ap.evaluate(()=>UI.go('debts')); await ap.waitForTimeout(600);
    ok('الديون: المجموع 97.50 على زبونين', /97\.50/.test(await ap.textContent('.debt-hero')) && (await ap.$$eval('.row.debt', e=>e.length))===2);
    const wa = await ap.$$eval('a.mini-btn.wa', e=>e.map(x=>x.href));
    ok('وتذكير واتساب برقم ليبي دولي', wa.some(h=>/wa\.me\/218912345678\?text=/.test(h)), wa[0]);
    await ap.evaluate(()=>UI.go('alerts')); await ap.waitForTimeout(600);
    const seg = await ap.$$eval('.seg2 button', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
    ok('التنبيهات: نفد 1، قارب 1، املأ الرفوف 0، راكد 1', seg.join('|')==='نفد 1|قارب 1|املأ الرفوف 0|راكد 1', seg.join('|'));
    await ap.click('.seg2 button[data-arg="slow"]'); await ap.waitForTimeout(400);
    ok('والراكد يذكر الأيام', /راكد 210 يوم/.test(await ap.textContent('#view')));
    await ap.evaluate(()=>UI.go('room')); await ap.waitForTimeout(600);
    ok('تبويب «الخزين» يعرض ما في الغرفة', /9/.test(await ap.textContent('.room-hero')) && (await ap.$$eval('.row', e=>e.length))===1);

    // البيع: الكاميرا في شاشة البيع تضيف للسلة
    await ap.evaluate(()=>UI.go('sell')); await ap.waitForTimeout(500);
    await ap.evaluate(()=>UI.onScan('9789991234567')); await ap.waitForTimeout(300);
    await ap.evaluate(()=>UI.onScan('9789991234567')); await ap.waitForTimeout(300);
    ok('مسح نفس الكتاب مرتين = كمية 2 في السلة', await ap.textContent('.cline .qty b')==='2');
    await ap.fill('#sellQ','قلم'); await ap.waitForTimeout(400);
    await ap.click('.sug'); await ap.waitForTimeout(400);
    ok('والبحث بالاسم يضيف القلم', (await ap.$$eval('.cline', e=>e.length))===2);
    ok('والصافي 51.50', /51\.50/.test(await ap.textContent('.grand')));
    await ap.click('.seg2.pay-m button[data-arg="credit"]'); await ap.waitForTimeout(300);
    await ap.click('button[data-act="checkout"]'); await ap.waitForTimeout(300);
    ok('الآجل يطلب الزبون أولاً', (await ap.$$eval('.cline', e=>e.length))===2);
    await ap.selectOption('#sellCust','c3'); await ap.fill('#sellPaid','20');
    if (SHOT) await ap.screenshot({path:SHOT+'app-sell.png'});
    const before = PUTS.length;
    await ap.click('button[data-act="checkout"]'); await ap.waitForTimeout(1200);
    ok('إتمام البيع يُفرغ السلة ويُظهر ✓', (await ap.$$eval('.cline', e=>e.length))===0);
    const put = PUTS[PUTS.length-1];
    ok('والطلب يُرفع لخادم الربط في ملف التلفون', PUTS.length>before && put.kind==='phone' && /^phone-/.test(put.branch.id) && put.orders.length===1, JSON.stringify(put&&put.orders));
    const o = put.orders[0];
    ok('بالأصناف والكميات والسعر والآجل والمدفوع', o.items.length===2 && o.items.some(l=>l.b==='9789991234567'&&l.q===2&&l.p===25) && o.method==='credit' && o.cust==='c3' && o.paid===20, JSON.stringify(o));
    ok('ولا يرفع التلفون أي مخزون', Array.isArray(put.items) && put.items.length===0);

    await ap.evaluate(()=>UI.refresh(true)); await ap.waitForTimeout(900);
    await ap.evaluate(()=>UI.go('home')); await ap.waitForTimeout(500);
    ok('الكمية المبيعة محجوزة في المعروض حتى يسجّلها الكمبيوتر', /محجوز 2/.test(await ap.textContent('#view')));
    ok('وملف التلفون ليس مكاناً في المخزون', await ap.evaluate(()=>UI.places().every(p=>!/^phone-/.test(p.key.slice(2)))));

    // الكمبيوتر يسجّلها فاتورة 77
    PAYLOAD.branches[0].acks = { [o.id]: 77 };
    await ap.evaluate(()=>UI.refresh(true)); await ap.waitForTimeout(1200);
    await ap.evaluate(()=>UI.go('orders')); await ap.waitForTimeout(600);
    ok('تأكيد الكمبيوتر يظهر: فاتورة رقم 77', /فاتورة رقم 77/.test(await ap.textContent('#view')));
    ok('والجرس يرنّ ويعدّ الجديد', await ap.evaluate(()=>{ const b=document.querySelector('#btnBell .bdg'); return !!b && +b.textContent>=1; }));
    const last = PUTS[PUTS.length-1];
    ok('وبعد التأكيد يُفرَّغ ملف التلفون من الطلب', last.orders.length===0, JSON.stringify(last.orders));
    await ap.click('#btnBell'); await ap.waitForTimeout(600);
    ok('لوحة الإشعارات تُفتح وفيها «سُجّلت فاتورة رقم 77»', /سُجّلت فاتورة رقم 77/.test(await ap.textContent('#sheet')));
    if (SHOT) await ap.screenshot({path:SHOT+'app-bell.png'});
    await ap.click('button[data-act="bellRead"]'); await ap.waitForTimeout(400);
    ok('و«تحديد الكل كمقروء» يُخفي العدّاد', !(await ap.$('#btnBell .bdg')));
    const st2 = await ap.$$eval('[style]:not(body)', e=>e.map(x=>x.tagName+'#'+x.id+'.'+x.className+' '+x.getAttribute('style')));
    ok('لا style سطري في شاشات التطبيق', st2.length===0, JSON.stringify(st2));
    const fit2 = await ap.evaluate(()=>({sw:document.documentElement.scrollWidth,w:innerWidth}));
    ok('ولا شيء يتّسع عن الشاشة', fit2.sw<=fit2.w, JSON.stringify(fit2));
    await cx.close();
  }

  const plainCam = await pg.$('#qcam');
  ok('في المتصفح العادي لا زر كاميرا', !plainCam);

  ok('لا أخطاء JavaScript ولا انتهاك لسياسة الأمان', errs.length===0, errs.slice(0,3).join(' | '));

  await b.close(); srv2.close();
  console.log('\n' + '='.repeat(46));
  console.log(fail ? '  فشل: ' + fail : '  كل اختبارات الموقع نجحت');
  console.log('='.repeat(46) + '\n');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
