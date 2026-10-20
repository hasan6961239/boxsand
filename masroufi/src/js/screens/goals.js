// STUB
import { h } from '../ui/dom.js';
import { layout, header } from '../ui/kit.js';
export default { render: () => layout(header({ title: 'goals', back: true }), h('p', 'goals')) };
export const goalScreen = { render: (p) => layout(header({ title: 'goal', back: true }), h('p', p.id)) };
