// Notification center: everything that needs attention now, plus the card
// that turns on push notifications (shared with Settings → الإشعارات).

import { h, icon } from '../ui/dom.js';
import { layout, header, section, card, list, row, button, empty, toast, busy, stagger } from '../ui/kit.js';
import * as store from '../core/store.js';
import * as push from '../core/push.js';
import * as auth from '../core/auth.js';
import { go, rerender, current } from '../core/router.js';
import { on } from '../core/bus.js';
import { today } from '../core/util.js';
import { attention } from '../core/reminders.js';

on('auth', () => {
  const c = current();
  if (c && (c.path === '/notifications' || c.path === '/settings/notifications')) rerender();
});

const IOS_STEPS = [
  ['share', 'افتح الموقع من Safari واضغط زر المشاركة'],
  ['square-plus', 'اختار «إضافة إلى الشاشة الرئيسية»'],
  ['smartphone', 'افتح «مصروفي» من الأيقونة الجديدة'],
];

/**
 * Push status card. Resolves the state asynchronously and fills itself in,
 * so it can be dropped into any page.
 */
export function pushCard({ compact = false } = {}) {
  const box = h('div.push-card', card(h('div.push-loading', h('span.skeleton', { style: { height: '18px', width: '60%' } }), h('span.skeleton', { style: { height: '14px', width: '85%' } }))));
  push.state().then((s) => box.replaceChildren(renderState(s, compact))).catch(() => box.replaceChildren());
  return box;
}

function renderState(s, compact) {
  const wrap = (tone, ic, title, body, extra) => card([
    h('div.push-head', h('span.push-ic', { class: `tone-${tone}` }, icon(ic, { size: 22 })), h('div', h('b', title), body ? h('p', body) : null)),
    extra,
  ], { cls: 'push-state' });

  if (s.reason === 'install') {
    return wrap('info', 'smartphone', 'الإشعارات تحتاج تثبيت التطبيق', 'على الآيفون الإشعارات تخدم بس لما التطبيق يكون على الشاشة الرئيسية:',
      h('ol.push-steps', IOS_STEPS.map(([ic, text], i) => h('li', h('span.push-step-n', String(i + 1)), icon(ic, { size: 18 }), h('span', text)))));
  }
  if (s.reason === 'unsupported') return wrap('muted', 'bell', 'المتصفح هذا ما يدعمش الإشعارات', 'جرّب من Safari على آيفون بنظام iOS 16.4 أو أحدث، بعد ما تضيف التطبيق للشاشة الرئيسية.');
  if (s.reason === 'denied') return wrap('warn', 'bell', 'الإشعارات مقفولة', 'فعّلها من: الإعدادات ← الإشعارات ← مصروفي ← السماح بالإشعارات. وبعدين ارجع هنا.');
  if (s.reason === 'account') {
    return wrap('info', 'cloud', 'سجّل دخول عشان توصلك التنبيهات', 'التذكيرات تتبعث من السيرفر حتى والتطبيق مقفول، فتحتاج حساب.',
      auth.isAvailable() === false ? null : button({ label: 'الحساب', icon: 'log-in', variant: 'soft', block: true, onClick: () => go('/settings/account') }));
  }
  if (s.reason === 'server') return wrap('warn', 'cloud-off', 'السيرفر مش جاهز للإشعارات', 'مفاتيح الإشعارات مش مضبوطة في الموقع لسه.');
  if (s.subscribed) {
    return wrap('pos', 'bell-ring', 'الإشعارات شغالة ✓', compact ? null : 'توصلك التذكيرات حتى والتطبيق مقفول.', h('div.push-actions',
      button({
        label: 'جرّب إشعار', icon: 'zap', variant: 'soft', size: 'sm',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const r = await push.test();
            toast(r.sent ? 'بعثنا إشعار تجربة — شوف فوق 👆' : 'ما وصلش لأي جهاز', { tone: r.sent ? 'pos' : 'warn' });
          } catch {
            toast('تعذّر إرسال التجربة', { tone: 'neg' });
          }
        }),
      }),
      button({
        label: 'إيقاف على هالجهاز', variant: 'plain', size: 'sm',
        onClick: async () => { await push.disable(); toast('وقّفنا الإشعارات على هالجهاز'); rerender(); },
      })));
  }
  return wrap('accent', 'bell', 'فعّل الإشعارات', 'نذكّرك بتسجيل المصاريف، يوم المرتب، مواعيد الديون، والميزانية.', button({
    label: 'فعّل الإشعارات', icon: 'bell-ring', block: true,
    // must run straight from the tap: iOS only shows the permission prompt for a user gesture
    onClick: (e) => busy(e.currentTarget, async () => {
      try {
        await push.enable();
        toast('تمام! الإشعارات شغالة 🔔', { tone: 'pos' });
      } catch (err) {
        toast(push.errorText(err), { tone: String(err && err.message) === 'retry' ? 'default' : 'warn', duration: 5000 });
      }
      rerender();
    }),
  }));
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const items = attention(data, t, { exists: store.exists, horizon: 14 });
    const now = items.filter((i) => i.date <= t || i.tone === 'neg' || i.rank <= 1);
    const soon = items.filter((i) => !now.includes(i));
    const rows = (list_) => list(list_.map((it) => row({
      lead: { icon: it.icon, tone: it.tone },
      title: it.title,
      sub: it.body,
      chevron: true,
      onClick: () => { location.hash = it.url; },
    })));
    const body = h('div.notifs',
      pushCard({ compact: true }),
      items.length ? null : card(empty({ emoji: '✨', title: 'ما فيش شي يحتاج انتباهك', body: 'كل شي تمام. لما يقرب المرتب أو موعد دين أو تقرب تخلص الميزانية يطلعلك هنا.' })),
      now.length ? section('توة', rows(now)) : null,
      soon.length ? section('قريباً', rows(soon)) : null);
    stagger(body);
    return layout(header({ title: 'التنبيهات', back: true }), body);
  },
};
