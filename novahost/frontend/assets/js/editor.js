import { el } from './dom.js';

/**
 * Code editor.
 *
 * A transparent <textarea> layered over a highlighted <pre>. The textarea keeps
 * every native behaviour that matters — the phone keyboard, autocorrect off,
 * undo/redo, selection, accessibility — while the layer underneath provides
 * colour.
 *
 * Why not Monaco or CodeMirror: both would come from a CDN, and the panel's
 * Content-Security-Policy allows scripts only from this origin. Vendoring
 * either would add megabytes to a dashboard whose whole point is running on a
 * phone, to edit files that are usually under a hundred lines. This is about
 * 8 KB and works with the Wi-Fi router unplugged.
 *
 * The highlighter is regex-based and therefore approximate. It is honest about
 * that: it colours tags, strings, comments, keywords and numbers, and when it
 * is unsure it leaves text uncoloured rather than guessing wrong.
 */

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from',
  'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
  'instanceof', 'this', 'super', 'null', 'undefined', 'true', 'false', 'switch',
  'case', 'delete', 'in', 'of', 'yield', 'static', 'get', 'set', 'void',
]);

function escapeText(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * Tokenise into [class, text] pairs. Returning tokens rather than an HTML
 * string keeps the no-innerHTML rule: the caller builds real span elements.
 */
function tokenize(source, language) {
  const tokens = [];
  const push = (cls, text) => {
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous[0] === cls) previous[1] += text;
    else tokens.push([cls, text]);
  };

  if (language === 'html' || language === 'xml') {
    const pattern = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w:-]*)|("[^"]*"|'[^']*')|([a-zA-Z-]+)(?==)|(\/?>)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      push('', source.slice(last, match.index));
      if (match[1]) push('tok-comment', match[1]);
      else if (match[2]) push('tok-tag', match[2]);
      else if (match[3]) push('tok-string', match[3]);
      else if (match[4]) push('tok-attr', match[4]);
      else if (match[5]) push('tok-tag', match[5]);
      last = pattern.lastIndex;
    }
    push('', source.slice(last));
    return tokens;
  }

  if (language === 'css') {
    const pattern = /(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|(#[0-9a-fA-F]{3,8}\b)|(-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|fr|deg)?)|([a-zA-Z-]+)(?=\s*:)|(@[a-zA-Z-]+)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      push('', source.slice(last, match.index));
      if (match[1]) push('tok-comment', match[1]);
      else if (match[2]) push('tok-string', match[2]);
      else if (match[3]) push('tok-number', match[3]);
      else if (match[4]) push('tok-number', match[4]);
      else if (match[5]) push('tok-prop', match[5]);
      else if (match[6]) push('tok-keyword', match[6]);
      last = pattern.lastIndex;
    }
    push('', source.slice(last));
    return tokens;
  }

  if (language === 'json') {
    const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      push('', source.slice(last, match.index));
      if (match[1]) {
        push(match[2] ? 'tok-prop' : 'tok-string', match[1]);
        if (match[2]) push('', match[2]);
      } else if (match[3]) push('tok-number', match[3]);
      else if (match[4]) push('tok-keyword', match[4]);
      last = pattern.lastIndex;
    }
    push('', source.slice(last));
    return tokens;
  }

  if (language === 'javascript') {
    const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b([a-zA-Z_$][\w$]*)\b/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      push('', source.slice(last, match.index));
      if (match[1]) push('tok-comment', match[1]);
      else if (match[2]) push('tok-string', match[2]);
      else if (match[3]) push('tok-number', match[3]);
      else if (match[4]) push(KEYWORDS.has(match[4]) ? 'tok-keyword' : '', match[4]);
      last = pattern.lastIndex;
    }
    push('', source.slice(last));
    return tokens;
  }

  push('', source);
  return tokens;
}

export function createEditor({ value = '', language = 'text', onChange = null, onSave = null, readOnly = false }) {
  const highlight = el('pre.editor__highlight', { 'aria-hidden': 'true' });
  const gutter = el('.editor__gutter', { 'aria-hidden': 'true' });
  const input = el('textarea.editor__input', {
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    wrap: 'off',
    'aria-label': 'code editor',
    readonly: readOnly,
  });
  input.value = value;

  const pane = el('.editor__pane', highlight, input);
  const root = el('.editor', gutter, pane);

  function paint() {
    const source = input.value;
    const tokens = tokenize(source, language);

    const fragment = document.createDocumentFragment();
    for (const [cls, text] of tokens) {
      if (cls) fragment.append(el('span', { class: cls, text }));
      else fragment.append(document.createTextNode(text));
    }
    // A trailing newline keeps the last line scrollable into view.
    fragment.append(document.createTextNode('\n'));
    highlight.replaceChildren(fragment);

    const lines = source.split('\n').length;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');

    // The textarea must be at least as large as the content for the overlay to
    // line up while scrolling.
    input.style.height = `${Math.max(highlight.scrollHeight, 240)}px`;
    input.style.width = `${Math.max(highlight.scrollWidth, pane.clientWidth)}px`;
  }

  input.addEventListener('input', () => {
    paint();
    onChange?.(input.value);
  });

  input.addEventListener('keydown', (event) => {
    // Tab inserts two spaces instead of leaving the field. Shift+Tab still
    // moves focus, so the editor never becomes a keyboard trap.
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const { selectionStart, selectionEnd, value: text } = input;
      input.value = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`;
      input.selectionStart = input.selectionEnd = selectionStart + 2;
      paint();
      onChange?.(input.value);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave?.(input.value);
    }
  });

  // Keep the highlight layer aligned with the textarea while scrolling.
  pane.addEventListener('scroll', () => {
    gutter.style.transform = `translateY(${-pane.scrollTop}px)`;
  });

  paint();

  return {
    node: root,
    get value() { return input.value; },
    set value(next) {
      input.value = next;
      paint();
    },
    setLanguage(next) {
      language = next;
      paint();
    },
    focus() { input.focus(); },
    refresh: paint,
  };
}
