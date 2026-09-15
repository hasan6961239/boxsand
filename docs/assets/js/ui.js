/* =========================================================================
   UI — renders every section from the loaded state.
   ========================================================================= */
(function (global) {
  'use strict';

  const D = global.RatesData;
  const $ = (sel) => document.querySelector(sel);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CURRENCY_LABEL = { USD: 'الدولار', EUR: 'اليورو' };
  /** Shown on every card. The fuller history lives in the charts below. */
  const BASELINE_LABELS = [
    ['morning', 'منذ صباح اليوم'],
    ['yesterday', 'أمس في نفس الوقت'],
  ];
  /** The euro strip is secondary — one line of context is enough. */
  const COMPACT_BASELINES = [['morning', 'منذ الصباح']];

  /* ------------------------------------------------------------- fragments */

  /** Status chip. Direction is carried by an arrow and a sign, never by color alone. */
  function deltaChip(delta, digits = 3) {
    if (!delta) return '<span class="delta is-empty">—</span>';
    // A move too small to show at the printed precision is "unchanged", not a
    // signed zero — otherwise the chip reads "−0.00" and implies a fall.
    const epsilon = 0.5 * 10 ** -digits;
    if (Math.abs(delta.abs) < epsilon) return '<span class="delta"><i class="arrow" aria-hidden="true">▬</i>دون تغيّر</span>';
    const up = delta.abs > 0;
    return `<span class="delta ${up ? 'is-up' : 'is-down'}"><i class="arrow" aria-hidden="true">${up ? '▲' : '▼'}</i>` +
           `<span class="num">${D.fmtSigned(delta.abs, digits)}</span>` +
           `<span class="pct num">${D.fmtPct(delta.pct)}</span></span>`;
  }

  /** Comparison rows, showing only the baselines that exist yet. */
  function deltaRows(base, compact) {
    const rows = (compact ? COMPACT_BASELINES : BASELINE_LABELS).filter(([k]) => base[k]);
    if (!rows.length) {
      return `<div class="rc-deltas"><p class="rc-waiting">تُعرض المقارنات (منذ الصباح، أمس، الأسبوع) فور تراكم قراءات كافية.</p></div>`;
    }
    return `<div class="rc-deltas">${rows.map(([k, label]) =>
      `<div class="delta-row"><span class="dl">${label}</span>${deltaChip(base[k])}</div>`).join('')}</div>`;
  }

  /**
   * How a city's number was arrived at. A reading from a source that named the
   * city carries no tag — that is the plain good case. Everything else says so.
   */
  function tagsFor(state, currency, city) {
    const meta = state.latest?.meta || {};
    const level = meta.confidence?.[`${currency}.${city}`];
    const offset = meta.offsets?.[city];
    const out = [];

    if (level === 'published' && city !== 'tripoli') {
      out.push('<span class="tag tag-published" title="السعر المنشور للسوق. المصادر الليبية تنشر رقماً واحداً — وهو سعر سوق المشير بطرابلس — ولم يُنشر رقم خاص بهذه المدينة.">سعر السوق</span>');
    }
    if (level === 'estimated') {
      const sign = offset > 0 ? '+' : '−';
      out.push(`<span class="tag tag-estimated" title="${esc(meta.offsetNote || '')} لم يُنشر رقم خاص بهذه المدينة، فعُرض السعر المنشور معدَّلاً بالفرق المرصود.">تقدير ${sign}${D.fmtMoney(Math.abs(offset || 0))}</span>`);
    }
    if ((meta.carried || []).includes(`parallel.${currency}.${city}`)) {
      out.push('<span class="tag tag-stale" title="لم يصل رقم جديد في آخر عملية جمع — هذه آخر قيمة معروفة">قديم</span>');
    }
    if (state.latest?.seeded) {
      out.push('<span class="tag tag-seed" title="قيمة أولية موثّقة بتاريخها">أولي</span>');
    }
    return out.join(' ');
  }

  /* ------------------------------------------------------------------ hero */

  function renderHero(state) {
    const { latest, history } = state;
    const usd = latest?.parallel?.USD || {};
    const headlineCity = D.CITY_ORDER.find((c) => Number.isFinite(usd[c])) || 'misrata';
    const usdValue = usd[headlineCity];
    const resolved = D.resolveGold(latest, state.live);
    const gold21 = resolved.gold?.parallel?.[headlineCity]?.[21] ?? resolved.gold?.official?.[21];

    const usdPoints = D.cityUsd(history, headlineCity);
    const usdBase = D.baselines(usdPoints, usdValue);
    const goldPoints = D.goldGramCity(history, headlineCity, 21);
    const goldBase = D.baselines(goldPoints, gold21);

    const tiles = [
      { label: `الدولار — ${D.CITY_META[headlineCity].ar}`, value: D.fmtRate(usdValue), unit: 'د.ل', delta: usdBase.morning || usdBase.last, digits: 3 },
      { label: 'ذهب عيار 21 — الجرام', value: D.fmtMoney(gold21), unit: 'د.ل', delta: goldBase.morning || goldBase.last, digits: 2 },
      { label: 'السعر الرسمي للدولار', value: D.fmtRate4(latest?.official?.USD), unit: 'د.ل', delta: null, digits: 3 },
    ];

    $('#hero-figures').innerHTML = tiles.map((t) => `
      <div class="hero-figure">
        <span class="hf-label">${esc(t.label)}</span>
        <span class="hf-value num">${t.value}<span class="hf-unit">${t.unit}</span></span>
        ${t.delta ? `<div style="margin-top:8px">${deltaChip(t.delta, t.digits)}</div>` : ''}
      </div>`).join('');

    const note = [];
    if (usdBase.morning) note.push(D.changeSentence(`الدولار في ${D.CITY_META[headlineCity].ar}`, usdBase.morning, 'دينار منذ صباح اليوم'));
    else if (usdBase.yesterday) note.push(D.changeSentence(`الدولار في ${D.CITY_META[headlineCity].ar}`, usdBase.yesterday, 'دينار عن أمس'));
    if (goldBase.yesterday) note.push(D.changeSentence('وجرام عيار 21', goldBase.yesterday, 'دينار عن أمس'));
    $('#hero-note').textContent = note.filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------ rate cards */

  function renderCityCards(hostSel, currency, state) {
    const host = $(hostSel);
    const compact = host.classList.contains('is-compact');
    const rates = state.latest?.parallel?.[currency] || {};
    const pick = currency === 'USD' ? D.cityUsd : D.cityEur;

    host.innerHTML = D.CITY_ORDER.map((city) => {
      const meta = D.CITY_META[city];
      const value = rates[city];
      const points = pick(state.history, city);
      const base = D.baselines(points, value);
      const tags = tagsFor(state, currency, city);

      const body = Number.isFinite(value)
        ? `<div class="rc-value"><b class="num">${D.fmtRate(value)}</b><span>دينار ليبي</span></div>
           ${compact ? '' : `<div class="rc-spark" data-spark="${currency}:${city}"></div>`}
           ${deltaRows(base, compact)}`
        : `<p class="rc-missing">لم يصل رقم لهذه المدينة بعد — يظهر تلقائياً عند أول رصد منشور.</p>`;

      return `
        <article class="rate-card" style="--accent: var(${meta.varName})" data-tilt>
          <div class="tilt-inner">
            <div class="rc-head">
              <span class="rc-city"><i class="rc-swatch" aria-hidden="true"></i>${meta.ar} ${tags}</span>
              <span class="rc-market">${meta.market}</span>
            </div>
            ${body}
          </div>
        </article>`;
    }).join('');

    // Sparklines need a laid-out box, so they are drawn after insertion.
    host.querySelectorAll('[data-spark]').forEach((box) => {
      const [cur, city] = box.dataset.spark.split(':');
      const points = D.withinDays((cur === 'USD' ? D.cityUsd : D.cityEur)(state.history, city), 7);
      if (points.length < 2) return;
      global.Chart.render(box, {
        spark: true,
        series: [{ key: city, label: D.CITY_META[city].ar, color: cssVar(D.CITY_META[city].varName), points }],
        format: D.fmtRate,
        ariaLabel: `اتجاه ${CURRENCY_LABEL[cur]} في ${D.CITY_META[city].ar} خلال أسبوع`,
      });
    });
  }

  /* ---------------------------------------------------------------- spread */

  /**
   * Where each city sits relative to the published rate.
   *
   * The numbers differ by a qirsh or two, so a bar from zero would render three
   * identical bars. A dot plot on a scale zoomed to the actual range shows the
   * gap that matters, and every dot is labelled with its own rate.
   */
  function renderSpread(state) {
    const host = $('#spread-body');
    const code = state.spreadCurrency;
    const rates = state.latest?.parallel?.[code] || {};
    const meta = state.latest?.meta || {};

    const rows = D.CITY_ORDER
      .map((city) => ({ city, value: rates[city], level: meta.confidence?.[`${code}.${city}`] }))
      .filter((r) => Number.isFinite(r.value));

    if (rows.length < 2) {
      host.innerHTML = '<p class="chart-empty">بانتظار أسعار كافية للمقارنة.</p>';
      return;
    }

    const values = rows.map((r) => r.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const reference = Number.isFinite(rates.tripoli) ? rates.tripoli : D.median(values);
    const span = max - min;

    // Fitting the actual spread to the full width would make three qirsh look
    // like a chasm. The scale is at least ten qirsh wide, so a small gap reads
    // as a small gap and a real divergence still fills the track.
    const MIN_RANGE = 0.10;
    const range = Math.max(span, MIN_RANGE);
    const centre = (min + max) / 2;
    const lo = centre - range / 2;
    const pos = (v) => 6 + ((v - lo) / range) * 88;

    const qirsh = (v) => Math.round((v - reference) * 100);

    host.innerHTML = `
      <div class="spread-rows">
        ${rows.map((r) => {
          const diff = qirsh(r.value);
          const dir = diff > 0 ? 'is-above' : diff < 0 ? 'is-below' : 'is-level';
          return `
          <div class="spread-row">
            <span class="spread-city"><i class="rc-swatch" style="--accent: var(${D.CITY_META[r.city].varName})" aria-hidden="true"></i>${D.CITY_META[r.city].ar}</span>
            <div class="spread-track">
              <span class="spread-ref" style="inset-inline-start:${pos(reference).toFixed(1)}%"></span>
              <span class="spread-dot ${dir}" style="inset-inline-start:${pos(r.value).toFixed(1)}%; --accent: var(${D.CITY_META[r.city].varName})"></span>
            </div>
            <span class="spread-value num">${D.fmtRate(r.value)}</span>
            <span class="spread-diff ${dir}">${diff === 0 ? 'كالمرجع' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'قرش' : 'قروش'}`}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="spread-scale" aria-hidden="true">
        <span class="num">${D.fmtRate(lo)}</span>
        <span>مقياس ${Math.round(range * 100)} قرشاً</span>
        <span class="num">${D.fmtRate(lo + range)}</span>
      </div>
      <p class="panel-note">${
        span < 1e-9
          ? 'كل الأسواق على نفس السعر المنشور حالياً.'
          : `أوسع فرق <b class="num">${Math.round(span * 100)}</b> ${Math.round(span * 100) === 1 ? 'قرش' : 'قروش'} — الخط الرأسي هو سعر طرابلس المرجعي.`
      } ${meta.offsetNote ? esc(meta.offsetNote) : ''}</p>`;
  }

  /* -------------------------------------------------------------- official */

  function renderOfficial(state) {
    const official = state.latest?.official || {};
    const parallel = state.latest?.parallel || {};
    const officialPoints = D.officialUsd(state.history);

    const rows = [
      { code: 'USD', label: 'الدولار الأمريكي', value: official.USD, points: officialPoints },
      { code: 'EUR', label: 'اليورو', value: official.EUR, points: [] },
    ];

    $('#official-cards').innerHTML = rows.map((row) => {
      const street = D.CITY_ORDER.map((c) => parallel[row.code]?.[c]).find(Number.isFinite);
      const gap = Number.isFinite(street) && Number.isFinite(row.value) ? ((street - row.value) / row.value) * 100 : null;
      const base = row.points.length ? D.baselines(row.points, row.value) : null;

      return `
        <article class="rate-card official-card" data-tilt>
          <div class="tilt-inner">
            <div class="rc-head">
              <span class="rc-city"><i class="rc-swatch" aria-hidden="true"></i>${row.label}</span>
              <span class="rc-market">مصرف ليبيا المركزي</span>
            </div>
            <div class="rc-value"><b class="num">${D.fmtRate4(row.value)}</b><span>دينار ليبي</span></div>
            ${gap != null ? `
              <div class="spread-bar">
                <div class="spread-track"><div class="spread-fill" style="width:${Math.min(100, Math.max(2, gap)).toFixed(1)}%"></div></div>
                <div class="spread-label">
                  <span>فارق السوق الموازية</span>
                  <span class="num">${D.fmtPct(gap)}</span>
                </div>
              </div>` : ''}
            ${base?.week ? `<div class="rc-deltas"><div class="delta-row"><span class="dl">خلال أسبوع</span>${deltaChip(base.week)}</div></div>` : ''}
          </div>
        </article>`;
    }).join('') + `
      <article class="rate-card official-card" data-tilt>
        <div class="tilt-inner">
          <div class="rc-head"><span class="rc-city"><i class="rc-swatch" aria-hidden="true"></i>مصدر السعر الرسمي</span></div>
          <p class="rc-missing">${official.basis === 'cbl'
            ? 'مقروء من صفحة أسعار الصرف في مصرف ليبيا المركزي.'
            : official.basis === 'international'
              ? 'تعذّر الوصول لصفحة المصرف المركزي في آخر جمع — الرقم من مرجع دولي.'
              : 'آخر قيمة معروفة محفوظة من جمعٍ سابق.'}</p>
        </div>
      </article>`;
  }

  /* ------------------------------------------------------------------ gold */

  function renderGold(state) {
    const resolved = D.resolveGold(state.latest, state.live);
    const gold = resolved.gold || {};
    const metals = resolved.metals || {};
    const basis = state.goldBasis;
    const table = basis === 'official' ? gold.official : gold.parallel?.[basis];
    const rateUsed = basis === 'official' ? state.latest?.official?.USD : state.latest?.parallel?.USD?.[basis];

    const spotPoints = D.goldSpot(state.history);
    const spotBase = D.baselines(spotPoints, metals.XAU);
    const g21Points = basis === 'official' ? D.goldGramOfficial(state.history, 21) : D.goldGramCity(state.history, basis, 21);
    const g21Base = D.baselines(g21Points, table?.[21]);
    const g18Points = basis === 'official' ? D.goldGramOfficial(state.history, 18) : D.goldGramCity(state.history, basis, 18);
    const g18Base = D.baselines(g18Points, table?.[18]);

    $('#gold-top').innerHTML = `
      <div class="gold-tile is-hero">
        <div class="gt-label">جرام عيار 21 — ${basis === 'official' ? 'بالسعر الرسمي' : D.CITY_META[basis].ar}</div>
        <div class="gt-value num">${D.fmtMoney(table?.[21])}<span class="gt-unit">د.ل</span></div>
        <div class="gt-foot">${deltaChip(g21Base.yesterday || g21Base.morning || g21Base.last, 2)}<span class="rc-market">مقارنة بالأمس</span></div>
      </div>
      <div class="gold-tile is-hero">
        <div class="gt-label">جرام عيار 18 — ${basis === 'official' ? 'بالسعر الرسمي' : D.CITY_META[basis].ar}</div>
        <div class="gt-value num">${D.fmtMoney(table?.[18])}<span class="gt-unit">د.ل</span></div>
        <div class="gt-foot">${deltaChip(g18Base.yesterday || g18Base.morning || g18Base.last, 2)}<span class="rc-market">مقارنة بالأمس</span></div>
      </div>
      <div class="gold-tile">
        <div class="gt-label">أونصة الذهب عالمياً ${resolved.isLive ? '<span class="tag tag-live">مباشر</span>' : ''}</div>
        <div class="gt-value num">${D.fmtMoney(metals.XAU)}<span class="gt-unit">دولار</span></div>
        <div class="gt-foot">${deltaChip(spotBase.yesterday || spotBase.last, 2)}<span class="rc-market">${resolved.isLive ? `محدَّث ${D.relTime(new Date(resolved.liveAt).toISOString())}` : 'XAU/USD'}</span></div>
      </div>
      <div class="gold-tile">
        <div class="gt-label">جرام عيار 24</div>
        <div class="gt-value num">${D.fmtMoney(table?.[24])}<span class="gt-unit">د.ل</span></div>
        <div class="gt-foot"><span class="rc-market">نقاء 99.9%</span></div>
      </div>
      ${Number.isFinite(state.latest?.localGold?.k18PerGram) ? `
      <div class="gold-tile">
        <div class="gt-label">كسر الذهب عيار 18 — سعر السوق</div>
        <div class="gt-value num">${D.fmtMoney(state.latest.localGold.k18PerGram)}<span class="gt-unit">د.ل</span></div>
        <div class="gt-foot"><span class="rc-market">سعر معلن من السوق الليبي، لا محسوب من الأونصة</span></div>
      </div>` : `
      <div class="gold-tile">
        <div class="gt-label">أونصة الفضة عالمياً</div>
        <div class="gt-value num">${D.fmtMoney(metals.XAG)}<span class="gt-unit">دولار</span></div>
        <div class="gt-foot"><span class="rc-market">XAG/USD</span></div>
      </div>`}`;

    const karats = [24, 22, 21, 18, 14];
    $('#gold-table tbody').innerHTML = karats.map((k) => {
      const gram = table?.[k];
      const points = basis === 'official' ? D.goldGramOfficial(state.history, k) : D.goldGramCity(state.history, basis, k);
      const daily = D.baselines(points, gram).yesterday;
      return `<tr>
        <td><span class="karat-chip"><i class="karat-dot" aria-hidden="true"></i>عيار ${k}</span></td>
        <td class="num">${(D.PURITY[k] * 100).toFixed(1)}%</td>
        <td class="t-strong num">${D.fmtMoney(gram)}</td>
        <td class="num">${Number.isFinite(gram) ? D.fmtWhole(gram * D.TROY_OUNCE_G) : '—'}</td>
        <td>${deltaChip(daily, 2)}</td>
      </tr>`;
    }).join('');

    $('#gold-basis-note').innerHTML = Number.isFinite(rateUsed)
      ? `محسوب بسعر دولار <b class="num">${basis === 'official' ? D.fmtRate4(rateUsed) : D.fmtRate(rateUsed)}</b> د.ل ` +
        `(${basis === 'official' ? 'السعر الرسمي لمصرف ليبيا المركزي' : `السوق الموازية في ${D.CITY_META[basis].ar}`})` +
        ` وأونصة عالمية <b class="num">${D.fmtMoney(metals.XAU)}</b> دولار. الأسعار للمعدن الخام دون أجرة الصياغة.`
      : 'بانتظار سعر دولار لهذا الأساس.';
  }

  /* ---------------------------------------------------------------- charts */

  function chartDefs(state) {
    const H = state.history;
    const cityColor = (c) => cssVar(D.CITY_META[c].varName);
    const citySeries = (pick) => D.CITY_ORDER
      .map((c) => ({ key: c, label: D.CITY_META[c].ar, color: cityColor(c), points: pick(H, c) }))
      .filter((s) => s.points.length);

    return [
      {
        id: 'usd', title: 'الدولار في السوق الموازية', sub: 'دينار ليبي لكل دولار — حسب المدينة',
        series: citySeries(D.cityUsd), format: D.fmtRate,
      },
      {
        id: 'eur', title: 'اليورو في السوق الموازية', sub: 'دينار ليبي لكل يورو — حسب المدينة',
        series: citySeries(D.cityEur), format: D.fmtRate,
      },
      {
        id: 'gold21', title: 'الذهب عيار 21 — سعر الجرام', sub: 'دينار ليبي للجرام — بالسعر الرسمي مقابل سعر السوق',
        series: [
          { key: 'official', label: 'بالسعر الرسمي', color: cssVar('--s-gold'), points: D.goldGramOfficial(H, 21) },
          { key: 'misrata', label: 'سوق مصراتة', color: cssVar('--s-misrata'), points: D.goldGramCity(H, 'misrata', 21) },
        ].filter((s) => s.points.length),
        format: D.fmtMoney,
      },
      {
        id: 'spot', title: 'أونصة الذهب عالمياً', sub: 'دولار أمريكي للأونصة (XAU/USD)',
        series: [{ key: 'xau', label: 'الذهب', color: cssVar('--s-gold'), points: D.goldSpot(H) }].filter((s) => s.points.length),
        format: D.fmtMoney,
      },
    ];
  }

  function renderCharts(state) {
    const host = $('#chart-grid');
    const defs = chartDefs(state);

    host.innerHTML = defs.map((def) => `
      <section class="panel chart-card" data-chart="${def.id}">
        <div class="panel-head">
          <div class="chart-title-wrap">
            <h3>${esc(def.title)}</h3>
            <p class="chart-sub">${esc(def.sub)}</p>
          </div>
          <button class="chart-toggle" type="button" data-view="chart" aria-pressed="false">عرض كجدول</button>
        </div>
        ${def.series.length > 1 ? `<div class="chart-legend">${def.series.map((s) => `<span class="legend-item"><i class="legend-dash" style="--c:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : ''}
        <div class="chart-body" data-body="${def.id}"></div>
      </section>`).join('');

    for (const def of defs) {
      const body = host.querySelector(`[data-body="${def.id}"]`);
      const windowed = def.series
        .map((s) => ({ ...s, points: D.withinDays(s.points, state.range) }))
        .filter((s) => s.points.length);

      const draw = (asTable) => {
        body.textContent = '';
        if (asTable) {
          if (!windowed.length) { body.innerHTML = '<p class="chart-empty">لا توجد بيانات في هذه الفترة بعد.</p>'; return; }
          body.appendChild(global.Chart.table(windowed, def));
        } else {
          global.Chart.render(body, { series: windowed, format: def.format, axisFormat: def.format, ariaLabel: def.title });
        }
      };
      draw(false);

      const toggle = host.querySelector(`[data-chart="${def.id}"] .chart-toggle`);
      toggle.addEventListener('click', () => {
        const asTable = toggle.dataset.view === 'chart';
        toggle.dataset.view = asTable ? 'table' : 'chart';
        toggle.setAttribute('aria-pressed', String(asTable));
        toggle.textContent = asTable ? 'عرض كمخطط' : 'عرض كجدول';
        draw(asTable);
      });
      body._redraw = () => draw(toggle.dataset.view === 'table');
    }
  }

  /* --------------------------------------------------------------- sources */

  const SOURCE_KIND = {
    'telegram-lydollar': 'السوق الموازية', 'almashhadlibya.com': 'السوق الموازية',
    'libyaakhbar.com': 'السوق الموازية', 'eanlibya.com': 'السوق الموازية',
    cbl: 'السعر الرسمي', 'er-api': 'مرجع دولي', 'currency-api': 'مرجع دولي',
    'gold-api': 'المعادن', 'goldprice-org': 'المعادن', paxg: 'المعادن',
  };
  const STATUS_LABEL = { ok: 'يعمل', down: 'متعذّر', skipped: 'متجاوَز' };

  function renderSources(state) {
    const rows = state.latest?.sources || [];
    const body = $('#sources-table tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="src-detail">لم تُسجَّل عملية جمع بعد — تظهر الحالة بعد أول تشغيل للمجمّع.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label || r.id)}</a>` : esc(r.label || r.id)}</td>
        <td>${esc(SOURCE_KIND[r.id] || '—')}</td>
        <td><span class="status-pill ${esc(r.status)}">${STATUS_LABEL[r.status] || esc(r.status)}</span></td>
        <td class="src-detail">${esc(r.detail || '')}</td>
      </tr>`).join('');
  }

  /* ---------------------------------------------------------------- alerts */

  const ALERTS_KEY = 'marsad-alerts';
  /** Do not renotify for the same alert within this window. */
  const REARM_MS = 60 * 60 * 1000;

  function loadAlerts() {
    try { return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch { return []; }
  }
  function saveAlerts(alerts) {
    try { localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)); } catch { /* private mode */ }
  }

  function renderAlerts(state) {
    const list = $('#alert-list');
    const hint = $('#alert-hint');
    const alerts = state.alerts || [];

    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    hint.textContent =
      permission === 'unsupported' ? 'متصفحك لا يدعم الإشعارات — سيظهر التنبيه داخل الصفحة.'
      : permission === 'denied' ? 'الإشعارات محظورة لهذا الموقع — سيظهر التنبيه داخل الصفحة.'
      : permission === 'granted' ? 'الإشعارات مفعّلة. اترك الصفحة مفتوحة ليصلك التنبيه.'
      : 'سيُطلب إذن الإشعارات عند أول تنبيه.';

    if (!alerts.length) {
      list.innerHTML = '<li class="alert-empty">لا توجد تنبيهات بعد.</li>';
      return;
    }
    list.innerHTML = alerts.map((a) => {
      const now = D.metricValue(state.latest, state.live, a.metric);
      const met = Number.isFinite(now) && (a.dir === 'above' ? now >= a.value : now <= a.value);
      return `<li class="alert-item ${met ? 'is-met' : ''}">
        <span class="alert-desc">${esc(D.metricLabel(a.metric))} ${a.dir === 'above' ? 'يتجاوز' : 'ينزل تحت'} <b class="num">${D.fmtRate(a.value)}</b></span>
        <span class="alert-now">الآن <b class="num">${D.fmtRate(now)}</b></span>
        <button type="button" class="alert-remove" data-remove="${esc(a.id)}" aria-label="حذف التنبيه">✕</button>
      </li>`;
    }).join('');
  }

  /**
   * Fire any alert whose condition has become true.
   *
   * There is no server here, so notifications arrive while the page is open —
   * a pinned tab keeps them coming. Each alert re-arms after an hour so a rate
   * hovering on the threshold does not notify on every refresh.
   */
  function checkAlerts(state, notify) {
    const alerts = state.alerts || [];
    let changed = false;
    for (const alert of alerts) {
      const value = D.metricValue(state.latest, state.live, alert.metric);
      if (!Number.isFinite(value)) continue;
      const met = alert.dir === 'above' ? value >= alert.value : value <= alert.value;
      if (!met) { if (alert.armed === false) { alert.armed = true; changed = true; } continue; }
      if (alert.armed === false && Date.now() - (alert.firedAt || 0) < REARM_MS) continue;
      alert.armed = false;
      alert.firedAt = Date.now();
      changed = true;
      notify(
        `${D.metricLabel(alert.metric)} ${alert.dir === 'above' ? 'تجاوز' : 'نزل تحت'} ${D.fmtRate(alert.value)}`,
        `السعر الآن ${D.fmtRate(value)} دينار`
      );
    }
    if (changed) saveAlerts(alerts);
  }

  /* ------------------------------------------------------------- converter */

  function renderConverter(state) {
    const amount = parseFloat(String($('#conv-amount').value).replace(/[^\d.]/g, ''));
    const currency = $('#conv-currency').value;
    const basisSelect = $('#conv-basis');
    // Before the user has picked anything, land on a basis that has a rate.
    if (!basisSelect.dataset.touched) {
      const usable = [...D.CITY_ORDER, 'official'].find((b) =>
        Number.isFinite(b === 'official' ? state.latest?.official?.USD : state.latest?.parallel?.USD?.[b]));
      if (usable && basisSelect.value !== usable &&
          !Number.isFinite(state.latest?.parallel?.USD?.[basisSelect.value])) basisSelect.value = usable;
    }
    const basis = basisSelect.value;
    const out = $('#conv-out');

    const usdRate = basis === 'official' ? state.latest?.official?.USD : state.latest?.parallel?.USD?.[basis];
    const eurRate = basis === 'official' ? state.latest?.official?.EUR : state.latest?.parallel?.EUR?.[basis];
    const resolvedGold = D.resolveGold(state.latest, state.live).gold || {};
    const gold21 = basis === 'official' ? resolvedGold.official?.[21] : resolvedGold.parallel?.[basis]?.[21];
    const basisLabel = basis === 'official' ? 'السعر الرسمي' : `السوق الموازية — ${D.CITY_META[basis].ar}`;

    if (!Number.isFinite(amount)) { out.innerHTML = '—'; return; }

    const rateFor = { USD: usdRate, EUR: eurRate, GOLD21: gold21, LYD: 1 }[currency];
    if (!Number.isFinite(rateFor)) { out.innerHTML = `—<small>لا يتوفر سعر لهذا الاختيار حالياً</small>`; return; }

    if (currency === 'LYD') {
      const parts = [
        Number.isFinite(usdRate) ? `${D.fmtMoney(amount / usdRate)} دولار` : null,
        Number.isFinite(eurRate) ? `${D.fmtMoney(amount / eurRate)} يورو` : null,
        Number.isFinite(gold21) ? `${D.fmtMoney(amount / gold21)} جرام ذهب 21` : null,
      ].filter(Boolean);
      out.innerHTML = `<span class="num">${parts.join(' · ')}</span><small>${D.fmtWhole(amount)} دينار بـ${basisLabel}</small>`;
      return;
    }

    const unitName = { USD: 'دولار', EUR: 'يورو', GOLD21: 'جرام ذهب عيار 21' }[currency];
    out.innerHTML = `<span class="num">${D.fmtMoney(amount * rateFor)}</span> دينار ليبي` +
      `<small>${D.fmtMoney(amount)} ${unitName} × ${D.fmtRate(rateFor)} — ${basisLabel}</small>`;
  }

  global.UI = { renderHero, renderCityCards, renderSpread, renderOfficial, renderGold, renderCharts, renderSources, renderConverter, renderAlerts, checkAlerts, loadAlerts, saveAlerts, cssVar };
})(window);
