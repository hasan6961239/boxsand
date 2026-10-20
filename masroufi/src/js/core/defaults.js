// Seed data and static metadata. Pure module (shared with the server).
//
// Seeded records use fixed ids ('cat:food', 'settings', …) so two devices that
// each run first-time setup converge on the same records instead of
// duplicating them when they sync.

export const DEFAULT_CATEGORIES = [
  // expense
  { id: 'cat:food', kind: 'expense', name: 'أكل ومطاعم', emoji: '🍔', color: '#F97316' },
  { id: 'cat:coffee', kind: 'expense', name: 'قهوة وشاهي', emoji: '☕', color: '#B45309' },
  { id: 'cat:grocery', kind: 'expense', name: 'سوق ومواد غذائية', emoji: '🛒', color: '#16A34A' },
  { id: 'cat:fuel', kind: 'expense', name: 'بنزين ومواصلات', emoji: '⛽', color: '#0EA5E9' },
  { id: 'cat:car', kind: 'expense', name: 'سيارة وصيانة', emoji: '🚗', color: '#64748B' },
  { id: 'cat:bills', kind: 'expense', name: 'فواتير', emoji: '🧾', color: '#6366F1' },
  { id: 'cat:phone', kind: 'expense', name: 'رصيد ونت', emoji: '📱', color: '#8B5CF6' },
  { id: 'cat:home', kind: 'expense', name: 'بيت', emoji: '🏠', color: '#14B8A6' },
  { id: 'cat:clothes', kind: 'expense', name: 'ملابس', emoji: '👕', color: '#EC4899' },
  { id: 'cat:health', kind: 'expense', name: 'صحة ودواء', emoji: '💊', color: '#EF4444' },
  { id: 'cat:family', kind: 'expense', name: 'عائلة', emoji: '👨‍👩‍👧', color: '#F59E0B' },
  { id: 'cat:gifts', kind: 'expense', name: 'هدايا ومناسبات', emoji: '🎁', color: '#D946EF' },
  { id: 'cat:fun', kind: 'expense', name: 'ترفيه وطلعات', emoji: '🎮', color: '#22C55E' },
  { id: 'cat:edu', kind: 'expense', name: 'تعليم', emoji: '📚', color: '#3B82F6' },
  { id: 'cat:other', kind: 'expense', name: 'أخرى', emoji: '📦', color: '#94A3B8' },
  // income
  { id: 'cat:in-bonus', kind: 'income', name: 'مكافأة', emoji: '🎉', color: '#10B981' },
  { id: 'cat:in-side', kind: 'income', name: 'شغل جانبي', emoji: '💼', color: '#0EA5E9' },
  { id: 'cat:in-gift', kind: 'income', name: 'هدية', emoji: '🎁', color: '#D946EF' },
  { id: 'cat:in-sale', kind: 'income', name: 'بيع حاجة', emoji: '🏷️', color: '#F59E0B' },
  { id: 'cat:in-other', kind: 'income', name: 'دخل آخر', emoji: '➕', color: '#94A3B8' },
].map((c, i) => ({ ...c, col: 'cat', order: i }));

export const FALLBACK_CATEGORY = { id: 'cat:other', name: 'أخرى', emoji: '📦', color: '#94A3B8', kind: 'expense' };

/** Colors offered when creating categories, people and goals. */
export const SWATCHES = ['#10B981', '#0EA5E9', '#6366F1', '#8B5CF6', '#D946EF', '#EC4899', '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#14B8A6', '#64748B'];

export const EMOJI_CHOICES = ['🍔', '🍕', '🥙', '☕', '🧃', '🛒', '🥩', '🍞', '⛽', '🚗', '🚕', '🔧', '🧾', '💡', '💧', '📱', '🌐', '🏠', '🛋️', '🧹', '👕', '👟', '💊', '🏥', '👨‍👩‍👧', '👶', '🎁', '💍', '🎮', '⚽', '🎬', '✈️', '📚', '✏️', '🚬', '💈', '🐑', '🕌', '💰', '💼', '🏷️', '🎉', '📦', '➕', '❤️', '🎯', '🚙', '🏍️', '💻', '📷', '🛠️', '🪙', '💵', '🏦', '🧑‍💼', '🤝'];

export const TXN_TYPES = {
  expense: { label: 'مصروف', icon: 'arrow-up-right', tone: 'neg' },
  income: { label: 'دخل', icon: 'arrow-down-left', tone: 'pos' },
  advance: { label: 'سحب من الدرج', icon: 'hand-coins', tone: 'pos' },
  salary: { label: 'مرتب المكتب', icon: 'briefcase', tone: 'pos' },
  state: { label: 'مرتب الدولة', icon: 'landmark', tone: 'pos' },
  adjust: { label: 'تعديل الرصيد', icon: 'sliders-horizontal', tone: 'muted' },
  carry: { label: 'مرحّل من سحوبات الدرج', icon: 'history', tone: 'muted' },
};

export const ACCENTS = {
  emerald: { name: 'زمردي', a: '#10B981', b: '#059669', ink: '#FFFFFF' },
  teal: { name: 'فيروزي', a: '#14B8A6', b: '#0D9488', ink: '#FFFFFF' },
  blue: { name: 'أزرق', a: '#3B82F6', b: '#2563EB', ink: '#FFFFFF' },
  violet: { name: 'بنفسجي', a: '#8B5CF6', b: '#7C3AED', ink: '#FFFFFF' },
  rose: { name: 'وردي', a: '#F43F5E', b: '#E11D48', ink: '#FFFFFF' },
  orange: { name: 'برتقالي', a: '#F97316', b: '#EA580C', ink: '#FFFFFF' },
  gold: { name: 'ذهبي', a: '#D4A21B', b: '#B7860B', ink: '#FFFFFF' },
  graphite: { name: 'رمادي', a: '#475569', b: '#334155', ink: '#FFFFFF' },
};

export function defaultSettings(todayStr) {
  // First office salary to track: this month's if its payday (20th) hasn't passed yet.
  const [y, m, d] = todayStr.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const since = d <= 20 ? todayStr.slice(0, 7) : next;
  return {
    id: 'settings',
    col: 'settings',
    name: '',
    opening: 0, // milli — cash on hand when the user started
    openingDate: todayStr,
    office: { on: true, amount: 2000000, day: 20, since },
    state: { on: true, amount: 650000 },
    period: 'payday', // budget/report month: 'payday' (20 → 19) or 'month' (1 → end)
    notif: {
      daily: { on: true, time: '21:00' },
      salary: true,
      debts: true,
      budget: true,
      recurring: true,
    },
    look: { mode: 'auto', accent: 'emerald', motion: 'full', digits: 'latin', size: 'm' },
    tz: 'Africa/Tripoli',
    onboarded: false,
  };
}
