// Open state of the two overlay sheets: the command palette and the shortcuts
// help. Kept apart from the views so commands can open them without a cycle.
import { createSignal } from 'solid-js';
import { modalOpen } from './modal';

export const [paletteOpen, setPaletteOpen] = createSignal(false);
export const [helpOpen, setHelpOpen] = createSignal(false);

/** Open the palette unless another modal already owns the screen. */
export function openPalette(): void {
  if (modalOpen() && !paletteOpen()) return;
  setHelpOpen(false);
  setPaletteOpen(true);
}

export function openHelp(): void {
  if (modalOpen() && !helpOpen()) return;
  setPaletteOpen(false);
  setHelpOpen(true);
}
