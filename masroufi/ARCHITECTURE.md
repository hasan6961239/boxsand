# مصروفي — architecture & contracts

Personal finance PWA for one person in Libya: expenses, debts (both directions),
office salary with drawer withdrawals, irregular state salary, budgets, goals,
fixed monthly expenses, reports, push reminders, sync between devices.
Installed on an **iPhone** from Safari ("Add to Home Screen").

## Product decisions (from the owner — do not change)

| Topic | Decision |
|---|---|
| Device | iPhone (Safari PWA, iOS 16.4+ for push) |
| Storage | Local-first (IndexedDB) **+ sync between devices** via an email/password account (Netlify Identity). App fully usable without an account. |
| Lock | None (no PIN) |
| Theme | Follows the phone (auto light/dark), switchable; several accent colors; default **emerald** |
| Style | **Soft & flat**: calm colors, rounded cards, light shadows, one gradient hero card |
| Font | IBM Plex Sans Arabic (self-hosted, `font-family: var(--font)`) |
| Notifications | Daily "log your spending" reminder (time chosen by user), office salary day + drawer withdrawals, debt due dates, budget 80% / 100% |
| Wallets | **One balance** (no cash/bank split) |
| Debts | Installment payments with remaining + progress, due date per debt (overdue in red), WhatsApp reminder button (+ call), ledger page per person |
| Extras | Charts & reports, monthly budget (total + per category, daily allowance until payday), savings goals, fixed monthly expenses (auto-posted on their day) |
| Office salary | 2000 د.ل paid on the **20th**. Money taken from the office drawer ("سحب من الدرج") is added to the balance immediately and deducted from the next salary: net = 2000 − withdrawals |
| State salary | 650 د.ل, arrives on random dates (e.g. June's salary on 18 July). **Just recorded when it arrives** (optional "which month" tag) — no tracking of pending months |
| Hosting | Netlify (static app + functions + blobs + identity) |

## Copy & language

- All UI text Arabic, RTL, friendly **Libyan-leaning** wording, short.
  Examples already used: «سجّل مصروف», «ليك عند الناس» / «عليك», «استلمت المرتب»,
  «سحب من الدرج», «ما سجّلتش», «بكرة», «توة», «هالشهر», «تقدر تصرف … في اليوم».
- Numbers use Western digits by default (user can switch to Arabic-Indic). Always
  format through `fmtMoney`/`fmtNumber`/`fmtPlain` so that setting applies.
- Currency label is `د.ل` (`CURRENCY`); dinars have **3 decimals** (dirham).

## Layout

```
src/
  index.html, manifest.webmanifest, sw.js
  css/  tokens.css base.css components.css   (design system)
        screens/<screen>.css                 (one file per screen, auto-imported by the build)
  js/main.js                                 (routes, tab bar, boot)
  js/core/  util defaults finance reminders store db bus sync auth push theme router automation
  js/ui/    dom kit keypad pickers rows charts icon-paths
  js/screens/*.js
  js/dev/demo.js                             (dev-only demo data, ?seed=demo)
netlify/functions/*.mts, netlify/lib/*       (backend)
scripts/build.mjs, scripts/make-icons.mjs
tests/*.test.mjs (node --test), tests/e2e/*.mjs (Playwright helpers)
```

## Data model

Every synced thing is a **record** `{ id, col, u, ...fields }` in `core/store.js`.
`u` = last modified ms, `d: 1` = deleted (tombstone), `dirty: 1` = not yet synced.
**Amounts are integer milli-dinars** (1 د.ل = 1000). **Dates are local `'YYYY-MM-DD'`**,
months/cycles `'YYYY-MM'`. Never store floats or Date objects.

| col | fields |
|---|---|
| `txn` | `type` ∈ `expense` · `income` · `advance` (drawer withdrawal) · `salary` (office, `amount` = net received, `gross`, `ded`) · `state` (state salary, optional `month`) · `adjust` (signed manual correction) · `carry` (no cash effect; withdrawals exceeding a salary, moved to the next cycle). Common: `amount`, `date`, `note?`, `cat?` (expense/income), `cycle?` (advance/salary/carry: payday month), `rule?` (posted by a recurring rule) |
| `cat` | `name, emoji, color, kind` (`expense`/`income`), `order`, `archived?`. Seeded ids `cat:food` … (fixed ids so devices don't duplicate) |
| `person` | `name, phone?, color?, note?` |
| `debt` | `person, dir` (`'in'` = «ليّ» they owe me · `'out'` = «عليّ» I owe), `amount, date, due?, note?, cash` (bool — did money actually change hands at creation; affects balance) |
| `pay` | `debt, amount, date, note?` — installment; always moves cash (in: +, out: −) |
| `goal` | `name, emoji, color, target, due?, archived?` |
| `gtx` | `goal, amount` (+ deposit / − withdrawal), `date, note?` — deposits leave the spendable balance |
| `rule` | fixed monthly expense: `name, amount, cat, day (1–31), active, start ('YYYY-MM' first month to post)`. Posted as `txn` with id `rec:<ruleId>:<YYYY-MM>` (deterministic → no duplicates across devices; a deleted occurrence is never re-posted) |
| `budget` | `id: 'budget:total'` or `'budget:cat:<catId>'` with `cat`, `amount` (per period) |
| `nlog` | `id: 'nlog:<alertKey>'` — budget alerts already shown (so the server doesn't push them again) |
| `settings` | single record `id: 'settings'` — see `defaultSettings()` in `core/defaults.js` (`name, opening, openingDate, office{on,amount,day,since}, state{on,amount}, period ('payday'|'month'), notif{daily{on,time},salary,debts,budget,recurring}, look{mode,accent,motion,digits,size}, tz, onboarded`) |

Balance = `settings.opening` + effects of all records dated ≥ `openingDate`
(see `finance.balance`). Budget/report "month" = salary period 20th → 19th by
default (`settings.period`), see `periodOf`.

## Core APIs (use these — don't re-implement)

- `core/store.js`: `data()` (snapshot `{txn, cat, person, debt, pay, goal, gtx, rule, budget, nlog, settings}` of live records, cached per change),
  `get(id)`, `exists(id)` (incl. deleted), `put(col, rec)` → record (new id if none), `patch(id, fields)`, `remove(id)`, `restore(rec)` (undo),
  `batch(fn)`, `settings()`, `setSettings(partial)` (merges nested objects one level), `memoize(key, fn)`, `exportAll()`, `importAll(list)`, `wipe()`, `counts()`.
- `core/finance.js` (pure): `balance`, `txnEffect`, `debtInfo`, `debtsOverview`, `personLedger`, `officeStatus`, `cycleForDate`, `salaryOf`, `deductionsOf`, `defaultAdvanceCycle`, `salaryDraft`, `stateSalaryStats`, `periodOf`, `periodByKey`, `shiftPeriod`, `periodLabel`, `inPeriod`, `periodTotals`, `spendByCategory`, `dailySpend`, `trend`, `insights`, `budgetLimits`, `budgetStatus`, `budgetAlerts`, `dailyAllowance`, `goalInfo`, `goalsOverview`, `dueRuleOccurrences`, `nextRuleDate`, `ruleTxnId`, `netWorth`, `activity`, `category`, `categories`, `catMap`.
- `core/reminders.js` (pure): `attention(data, today, {exists})` (notification center items), `pushDue(data, now, sentSet, {exists})` (server push), `badgeCount`.
- `core/util.js`: `uid, toMilli, fromMilli, milliToInput, fmtMoney(m,{sign,currency,compact}), fmtNumber, fmtPlain, fmtPercent, today(), addDays, diffDays, addMonths, monthKey, dayInMonth, fmtDate(s,'short'|'long'|'relative'), fmtMonth, fmtIn(days), fmtDays(n), fmtTime, greeting, intlPhone, fold (search), sum, groupBy, debounce, clamp, MONTHS, WEEKDAYS`.
- `core/router.js`: `go(path, {replace})`, `back(fallback)`, `current()`, `query()`, `rerender()`.
- `core/bus.js`: `on(evt, fn)`, `emit`. Events: `change` (store), `sync` (status), `auth` (user), `route`.
- `core/automation.js`: `postDueRecurring()`, `checkBudgets()` (call after saving an expense).
- `core/push.js`, `core/auth.js`, `core/sync.js`, `core/theme.js` — see file headers.

## UI kit (`ui/kit.js`, `ui/dom.js`, …)

- `h('div.cls#id', props, ...children)`, `icon(name, {size})` (Lucide names in `ui/icon-paths.js` — add more there if needed, copy from lucide.dev ISC).
- `layout(header(...), ...blocks)` — every screen returns this. `header({ title, sub, back, actions, large })`: tab roots use `large: true`, inner pages `back: true`.
- `section(title, content, {action})`, `card(children, {onClick})`, `list(rows)`, `row({lead, title, sub, end, endSub, onClick, chevron})`, `lead({emoji,color}|{icon,tone}|{name,color})`, `avatar`, `tag(text, tone, icon)`, `empty({emoji, title, body, action})`.
- `button({label, icon, variant: primary|soft|ghost|outline|plain|danger, size: lg|md|sm, block, onClick})`, `iconButton(name, {label, onClick, variant, badge})`, `busy(btn, asyncFn)`, `linkAction(label, fn)`.
- `sheet({title, sub, body: (api)=>Node, footer, full})` → `api.close(value)`, `api.result`; `confirm({title, body, ok, danger, icon})` → Promise<bool>; `actions({title, items})`; `toast(msg, {tone, icon, action:{label,onClick}})`.
- `segmented({options, value, onChange})`, `chips({options, value, onChange, multi, scroll})`, `toggle({checked, onChange})`, `field(label, control, {hint})`, `input({...})`, `textarea`.
- `progress(pct, {tone})`, `ring(pct, {size, label, sub, tone})`, `moneyEl(m, {sign, tone:'auto'|'pos'|'neg'|...})`, `countUp(el, to)`, `confetti()`, `haptic()`, `stagger(container)` (entrance animation for children).
- `ui/keypad.js` `amountPad({value, onChange, tone, quick})` → `{display, pad, get, set, destroy}`.
- `ui/pickers.js` `categoryGrid`, `dateChips({value, onChange, future})`, `emojiPicker`, `colorPicker`.
- `ui/rows.js` `activityRow(item, {showDate})`, `byDay(items)`, `dayHeader(group)`, `describe(item)`.
- `ui/charts.js` `donut({segments, center, onSelect})`, `bars({items, series})`, `dayBars({values, mark})`.

Tones: `accent pos neg warn info muted` (CSS classes `.tone-*` set `--tone` / `--tone-soft`).

## Screens

A screen module default-exports `{ render(params) → layout(...), live?: false, noTabbar?: true }`.
`render` is called again whenever data changes (scroll kept), so build from
`store.data()` each time and keep sheets (forms) outside the page DOM.
Routes are in `main.js`. Cross-module exports (owner → function):

| file | must export |
|---|---|
| `home.js` | default |
| `history.js` | default |
| `debts.js` | default |
| `person.js` | default (route `/person/:id`) |
| `debt-sheets.js` | `openDebtSheet({dir, person, id})`, `openPaySheet(debtId, {id})`, `openPersonSheet({id})` → Promise<personId\|null> |
| `salary.js` | default, `openSalarySheet(cycleKey, {id})` (record/edit office salary) |
| `budget.js` | default, `openBudgetSheet({cat})` |
| `reports.js` | default |
| `goals.js` | default, `goalScreen` (route `/goal/:id`), `openGoalSheet({id})`, `openGoalTxnSheet(goalId, {withdraw})` |
| `recurring.js` | default, `openRuleSheet({id})` |
| `categories.js` | default, `openCategorySheet({kind, id})` → Promise<catId\|null> |
| `settings.js` | default, `settingsSection` (route `/settings/:section`: `appearance`, `notifications`, `account`, `income`, `data`, `about`) |
| `notifications.js` | default |
| `more.js` | default |
| `welcome.js` | default (`noTabbar: true`; intro → account choice → onboarding wizard) |
| `account-sheets.js` | `openLogin()`, `openSignup()`, `openForgot()`, `openNewPassword()` |
| `txn-sheet.js` | `openTxnSheet({type, id, preset})`, `openTxnDetail(id)`, `openAdjustSheet()` |

## Style rules

- Only tokens from `css/tokens.css` (no hard-coded greys); must look right in light **and** dark.
- Screen CSS in `src/css/screens/<screen>.css`, classes prefixed by screen (`.debts-…`).
- Motion: use `stagger()` on screen blocks, `.tap`/`.ripple` on pressables, spring for small pops; everything must respect `[data-motion]` (`full`/`reduced`/`off`).
- Touch targets ≥ 44px, inputs ≥ 16px font (iOS zoom), icon-only buttons need `label`.
- Safe areas handled by `.page-head` / `.page-scroll` / sheets — don't fight them.
- No external libraries, CDNs or network calls except our own `/api/*` and Netlify Identity.

## Dev loop

- A watcher already rebuilds `dist/` on every save and serves it at `http://localhost:8787`
  (`npm run dev`). Build errors appear in `/tmp/serve.log` ("BUILD FAILED"); the last good
  build keeps being served. Don't start another build/server on `dist/`.
- Screenshots: `node tests/e2e/shoot.mjs --seed [--full] [--dark] /route …` → `/tmp/shots/*.png`
  (`--seed` loads demo data; prints console errors).
- Unit tests: `npm test` (`node --test tests/`).

## Backend (Netlify)

- `POST /api/sync` `{since, changes:[record], device}` → `{rev, changes:[record]}` — auth: Netlify Identity cookie (`nf_jwt`), per-user doc in Blobs, per-record last-writer-wins on `u`, optimistic concurrency with ETags.
- `GET /api/config` → `{vapidPublicKey, identity}`.
- `POST /api/push/subscribe` `{subscription, device, tz, ua}`, `POST /api/push/unsubscribe` `{endpoint}`, `POST /api/push/test`.
- Scheduled `notify` (every 15 min): for each user with subscriptions, `pushDue()` in the user's zone, send with VAPID, dedupe per key, drop dead endpoints.
- Identity `userValidate`: only the owner may sign up (first account, or `ALLOWED_EMAILS`).
