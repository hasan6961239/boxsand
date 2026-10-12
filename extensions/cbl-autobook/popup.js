const DEFAULTS = {
  abEnabled: true,
  abBank: 'مصرف الأمان',
  abRequestType: 'بطاقة',
  abDepositType: 'تحويل بنكي',
  abCity: 'مصراتة',
  abAmount: '2000',
};
const $ = (id) => document.getElementById(id);
const flash = (t) => { $('msg').textContent = t; setTimeout(() => ($('msg').textContent = ''), 2000); };

chrome.storage.local.get(DEFAULTS, (cfg) => {
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'abEnabled') $(k).checked = !!cfg[k];
    else $(k).value = cfg[k];
  }
});

$('save').addEventListener('click', () => {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = k === 'abEnabled' ? $(k).checked : ($(k).value.trim() || DEFAULTS[k]);
  }
  out.abAmount = out.abAmount.replace(/[^\d.]/g, '') || DEFAULTS.abAmount;
  chrome.storage.local.set(out, () => flash('تم الحفظ ✓'));
});

$('reset').addEventListener('click', () => {
  chrome.storage.local.set({ abResetAt: Date.now() }, () => flash('بدأت من جديد في صفحة المنصة المفتوحة ✓'));
});
