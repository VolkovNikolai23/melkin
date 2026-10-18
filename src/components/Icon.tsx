const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  cards: 'M7 4h12v14H7zM4 7v13h12',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  folder: 'M3 6h6l2 2h10v11H3z',
  note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  notebook: 'M6 3h13v18H6zM6 3v18M3 7h3M3 12h3M3 17h3M10 8h6',
  plus: 'M12 5v14M5 12h14',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  marker: 'M9 15l-4 5h6l2-3M9 15l7-11 4 3-7 11z',
  eraser: 'M8 20h12M4 16l9-11 7 6-8 9H8z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  indent: 'M4 6h16M10 12h10M10 18h10M4 10l3 2-3 2',
  outdent: 'M4 6h16M10 12h10M10 18h10M7 10l-3 2 3 2',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  sigma: 'M18 5H6l6 7-6 7h12',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  zoomIn: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M8 11h6',
  heart: 'M12 20C5 15 3 12 3 9a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 3-2 6-9 11z',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  pdf: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h2a1.5 1.5 0 0 1 0 3H9v-5M9 16v2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  highlight: 'M5 20h14M8 16l-2-2 9-9 4 4-9 9zM6 14l-2 4 4-2',
  heading: 'M6 4v16M18 4v16M6 12h12',
  listNumber: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M4 15h2.5L4 18.5h3',
  card: 'M4 6h16v12H4zM8 12h8M13 9l3 3-3 3',
  cardOff: 'M4 6h16v12H4zM4 6l16 12',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  portal: 'M4 4h16v16H4zM9 9h6v6H9zM4 4l5 5M20 20l-5-5',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  template: 'M4 4h16v4H4zM4 11h7v9H4zM14 11h6v4h-6zM14 18h6',
  props: 'M4 6h5M4 12h5M4 18h5M12 6h8M12 12h8M12 18h8',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  today: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 13v4M10 15h4',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  lasso: 'M12 4c5 0 8 2.5 8 5.5S17 15 12 15s-8-2.5-8-5.5S7 4 12 4zM7 14c-1 2 0 4 2 4s2 2 0 3',
  backlink: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6M4 20l6-6M4 15v5h5',
  // набор для предметов и папок
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  flask: 'M9 3h6M10 3v6L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9',
  atom: 'M12 12h.01M12 3c2 0 3 4 3 9s-1 9-3 9-3-4-3-9 1-9 3-9zM4.2 7.5c1-1.7 5.1-.6 9.4 1.9s7.2 5.6 6.2 7.3-5.1.6-9.4-1.9-7.2-5.6-6.2-7.3zM4.2 16.5c-1-1.7 1.9-4.8 6.2-7.3s8.4-3.6 9.4-1.9-1.9 4.8-6.2 7.3-8.4 3.6-9.4 1.9z',
  dna: 'M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9M8 6h8M8 18h8M9.5 9.5h5M9.5 14.5h5',
  leaf: 'M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l8-8',
  microscope: 'M9 4l4 2-3 6-4-2zM11 11l2 3M6 21h12M8 21a6 6 0 0 1 10-7M15 17h3',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  calculator: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  hanzi: 'M5 6h14M12 3v8M7 11h10l-1 9H8zM12 11v9',
  laptop: 'M5 5h14v10H5zM3 19h18',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  palette: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 4 0 5-1c1.5-1.5 1-4-.5-6A9 9 0 0 0 12 3zM8 10h.01M12 7h.01M16 10h.01',
  lecture: 'M3 5h18v11H3zM8 20h8M12 16v4M7 9h6M7 12h10',
  trash2: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  restore: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  split: 'M4 5h16v14H4zM12 5v14',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z',
  folderPlus: 'M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5h5',
  warning: 'M12 3l10 18H2zM12 9v5M12 17h.01',
  eyedropper: 'M14 4l6 6M17 7l-9.5 9.5L4 20l3.5-3.5M19.5 4.5a2.1 2.1 0 0 0-3 0L14 7l3 3 2.5-2.5a2.1 2.1 0 0 0 0-3z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  shapes: 'M3 21l5-9 5 9zM14 3h7v7h-7zM17.5 14a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 9l8-1 1 7-9 1z',
  sheet: 'M6 3h12v18H6zM6 8h12M6 13h12M10 3v18',
  fileExport: 'M6 3h9l4 4v14H6zM14 3v5h5M12 11v6M9.5 14.5L12 17l2.5-2.5',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
