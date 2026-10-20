// STUB
import { h } from '../ui/dom.js';
import { layout, header } from '../ui/kit.js';
export default { render: () => layout(header({ title: 'settings', back: true }), h('p', 'settings')) };
export const settingsSection = { render: (p) => layout(header({ title: p.section, back: true }), h('p', p.section)) };
