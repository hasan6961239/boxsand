import { svg } from './dom.js';

/**
 * Icons.
 *
 * Self-hosted path data rather than an icon package from a CDN. Two reasons:
 * the dashboard has to work on a home network with no internet at all, and the
 * Content-Security-Policy on the panel forbids third-party script and style —
 * so a CDN would be blocked anyway. The set is deliberately small; add a path
 * here when a view needs one.
 *
 * Geometry follows the 24×24 stroke-2 convention used by Feather and Lucide.
 */
const PATHS = {
  home: [['path', { d: 'M3 10.5 12 3l9 7.5' }], ['path', { d: 'M5 9.5V21h14V9.5' }]],
  layers: [
    ['path', { d: 'm12 2 9 5-9 5-9-5 9-5Z' }],
    ['path', { d: 'm3 12 9 5 9-5' }],
    ['path', { d: 'm3 17 9 5 9-5' }],
  ],
  rocket: [
    ['path', { d: 'M5 13c-1.5 1.5-2 5-2 6 1 0 4.5-.5 6-2' }],
    ['path', { d: 'M14.5 4.5C17 2 21 2 21 2s0 4-2.5 6.5L13 14l-4-4 5.5-5.5Z' }],
    ['path', { d: 'm9 10-4 1 1.5-3.5L11 6' }],
    ['path', { d: 'm14 15 1-4 1.5 4.5L14 19' }],
  ],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M3 12h18' }],
    ['path', { d: 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z' }],
  ],
  folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }]],
  file: [
    ['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z' }],
    ['path', { d: 'M14 3v5h5' }],
  ],
  server: [
    ['rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }],
    ['rect', { x: 3, y: 13, width: 18, height: 7, rx: 2 }],
    ['path', { d: 'M7 7.5h.01M7 16.5h.01' }],
  ],
  terminal: [['path', { d: 'm5 8 4 4-4 4' }], ['path', { d: 'M13 16h6' }]],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z' }],
  ],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
  logout: [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }], ['path', { d: 'm16 17 5-5-5-5' }], ['path', { d: 'M21 12H9' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.5-3.5' }]],
  menu: [['path', { d: 'M4 6h16M4 12h16M4 18h16' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  check: [['path', { d: 'm4 12 5 5L20 6' }]],
  alert: [['path', { d: 'M12 8v5M12 17h.01' }], ['circle', { cx: 12, cy: 12, r: 9 }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 16v-5M12 8h.01' }]],
  warning: [['path', { d: 'M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }], ['path', { d: 'M12 9v4M12 17h.01' }]],
  upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7 9 5-5 5 5' }], ['path', { d: 'M12 4v12' }]],
  download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7 11 5 5 5-5' }], ['path', { d: 'M12 16V4' }]],
  external: [['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }], ['path', { d: 'M15 3h6v6' }], ['path', { d: 'M10 14 21 3' }]],
  copy: [['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
  trash: [['path', { d: 'M3 6h18' }], ['path', { d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }], ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }], ['path', { d: 'M10 11v6M14 11v6' }]],
  edit: [['path', { d: 'M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5' }], ['path', { d: 'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z' }]],
  refresh: [['path', { d: 'M21 12a9 9 0 1 1-2.6-6.4' }], ['path', { d: 'M21 3v6h-6' }]],
  rotate: [['path', { d: 'M3 12a9 9 0 1 0 2.6-6.4' }], ['path', { d: 'M3 3v6h6' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  database: [['ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }], ['path', { d: 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5' }], ['path', { d: 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }]],
  cpu: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }], ['path', { d: 'M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4' }]],
  battery: [['rect', { x: 2, y: 7, width: 17, height: 10, rx: 2 }], ['path', { d: 'M22 11v2' }]],
  thermometer: [['path', { d: 'M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z' }]],
  activity: [['path', { d: 'M3 12h4l3 8 4-16 3 8h4' }]],
  save: [['path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z' }], ['path', { d: 'M17 21v-8H7v8M7 3v5h8' }]],
  archive: [['rect', { x: 2, y: 4, width: 20, height: 5, rx: 1 }], ['path', { d: 'M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9' }], ['path', { d: 'M10 13h4' }]],
  shield: [['path', { d: 'M12 3l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z' }]],
  link: [['path', { d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1' }], ['path', { d: 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' }]],
  chevronRight: [['path', { d: 'm9 6 6 6-6 6' }]],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  chevronLeft: [['path', { d: 'm15 6-6 6 6 6' }]],
  arrowLeft: [['path', { d: 'M19 12H5' }], ['path', { d: 'm12 19-7-7 7-7' }]],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
  monitor: [['rect', { x: 2, y: 4, width: 20, height: 13, rx: 2 }], ['path', { d: 'M8 21h8M12 17v4' }]],
  languages: [['path', { d: 'M2 5h11M7 3v2c0 4.4-2.2 8-5 8' }], ['path', { d: 'M4 9c0 2.5 2.7 4.7 6 5' }], ['path', { d: 'm12 20 4.5-10 4.5 10M14.5 16h5' }]],
  eye: [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  pause: [['rect', { x: 6, y: 5, width: 4, height: 14, rx: 1 }], ['rect', { x: 14, y: 5, width: 4, height: 14, rx: 1 }]],
  play: [['path', { d: 'M7 4.5v15l13-7.5-13-7.5Z' }]],
  qr: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
    ['path', { d: 'M14 14h3v3h-3zM19 14h2M14 19h3M19 19h2' }],
  ],
  filePlus: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z' }], ['path', { d: 'M14 3v5h5M12 11v6M9 14h6' }]],
  folderPlus: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }], ['path', { d: 'M12 11v6M9 14h6' }]],
  list: [['path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }]],
  history: [['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }], ['path', { d: 'M3 3v5h5' }], ['path', { d: 'M12 7v5l4 2' }]],
};

export function icon(name, options = {}) {
  const paths = PATHS[name];
  if (!paths) {
    // A missing icon should be visible in development, not silently blank.
    console.warn(`[icons] unknown icon: ${name}`);
    return svg(PATHS.info, options);
  }
  return svg(paths, options);
}

export const iconNames = Object.keys(PATHS);
