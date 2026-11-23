// Tooltips for every button. With a mouse or a hovering pencil they appear
// after a short pause; with a finger, on a long press (which then does not
// count as a tap).

import { el } from '../editor';

const TARGETS = 'button, [data-tip]';
const HOVER_MS = 450;
const PRESS_MS = 550;

export function installTooltips(): void {
  const tip = el<HTMLDivElement>('tooltip');
  let timer = 0;
  let suppressClick = false;

  const hide = (): void => {
    window.clearTimeout(timer);
    tip.hidden = true;
  };
  const show = (target: HTMLElement): void => {
    const text = target.dataset.tip ?? target.getAttribute('aria-label');
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    // Beside the tools on the left edge; otherwise above or below, whichever has room.
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.top > window.innerHeight / 2 ? r.top - t.height - 8 : r.bottom + 8;
    if (target.closest('#actions')) {
      x = r.right + 10;
      y = r.top + r.height / 2 - t.height / 2;
    }
    tip.style.left = `${Math.min(Math.max(6, x), window.innerWidth - t.width - 6)}px`;
    tip.style.top = `${Math.min(Math.max(6, y), window.innerHeight - t.height - 6)}px`;
  };
  const targetOf = (e: Event): HTMLElement | null =>
    e.target instanceof Element ? e.target.closest<HTMLElement>(TARGETS) : null;

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const target = targetOf(e);
    hide();
    if (target) timer = window.setTimeout(() => show(target), HOVER_MS);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'touch') hide();
  });
  document.addEventListener(
    'pointerdown',
    (e) => {
      hide();
      suppressClick = false;
      const target = targetOf(e);
      if (e.pointerType !== 'touch' || !target) return;
      timer = window.setTimeout(() => {
        show(target);
        suppressClick = true;
      }, PRESS_MS);
    },
    true,
  );
  const release = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    window.clearTimeout(timer);
    if (!tip.hidden) timer = window.setTimeout(hide, 1200);
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  // A long press that showed a tooltip was a question, not a command.
  document.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
