// Thin-stroke outline icons (lucide paths, 24px grid) for the alabaster
// chrome. One component, a name → path-set table; icons are decorative
// (aria-hidden), the control that holds them carries the label.
import { For, type JSX } from 'solid-js';

const PATHS = {
  search: ['M11 3a8 8 0 1 0 0 16a8 8 0 0 0 0-16z', 'm21 21-4.3-4.3'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  user: ['M12 3a5 5 0 1 0 0 10a5 5 0 0 0 0-10z', 'M20 21a8 8 0 0 0-16 0'],
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9Z'],
  terminal: ['M12 19h8', 'm4 17 6-6-6-6'],
  layers: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12',
    'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17',
  ],
  palette: ['M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z'],
  box: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
  branch: ['M15 6a9 9 0 0 0-9 9V3', 'M18 3a3 3 0 1 0 0 6a3 3 0 0 0 0-6z', 'M6 15a3 3 0 1 0 0 6a3 3 0 0 0 0-6z'],
  check: ['M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20z', 'm9 12 2 2 4-4'],
  arrowUpRight: ['M7 7h10v10', 'M7 17 17 7'],
  chevronDown: ['m6 9 6 6 6-6'],
  tick: ['M20 6 9 17l-5-5'],
  filter: ['M3 6h18', 'M7 12h10', 'M10 18h4'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  alert: ['M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20z', 'M12 8v4', 'M12 16h.01'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  info: ['M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  command: ['M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3'],
  play: ['M6 3l14 9-14 9z'],
  download: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  keyboard: ['M2 6h20v12H2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'],
  server: ['M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M6 6h.01', 'M6 18h.01'],
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 8a1 1 0 1 0 0 2a1 1 0 0 0 0-2z', 'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M16 13H8', 'M16 17H8'],
  compass: ['M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20z', 'm16.24 7.76-1.8 5.4-5.4 1.8 1.8-5.4z'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; class?: string }): JSX.Element {
  return (
    <svg
      class={props.class ? `sa-icon ${props.class}` : 'sa-icon'}
      width={props.size ?? 15}
      height={props.size ?? 15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.85"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <For each={PATHS[props.name]}>{(d) => <path d={d} />}</For>
    </svg>
  );
}

/** The bare folded-S mark in obsidian ink (inherits currentColor). */
export function BrandMark(): JSX.Element {
  return (
    <svg class="sa-shell__brand-mark" width="20" height="20" viewBox="320 220 620 810" fill="none" aria-hidden="true">
      <g fill="currentColor" stroke="currentColor" stroke-width="20" stroke-linejoin="round">
        <path d="M368 448 L575 254 L704 252 L739 308 L902 452 L868 527 L818 535 L716 449 Z" />
        <path d="M364 490 L868 630 L889 664 L889 786 L386 654 L364 622 Z" opacity="0.72" />
        <path d="M364 772 L424 736 L861 861 L657 992 L382 832 L364 802 Z" opacity="0.45" />
      </g>
    </svg>
  );
}
