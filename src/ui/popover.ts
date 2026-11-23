// At most one popover is open at a time. Tapping outside closes it, and that
// tap does nothing else, so dismissing a menu never leaves a mark on the drawing.

interface Open {
  el: HTMLElement;
  anchor: HTMLElement | null;
}

let current: Open | null = null;

export function closePopover(): void {
  if (!current) return;
  current.el.hidden = true;
  current.anchor?.setAttribute('aria-expanded', 'false');
  current = null;
}

export function isPopoverOpen(el?: HTMLElement): boolean {
  return current !== null && (!el || current.el === el);
}

export function openPopover(el: HTMLElement, anchor: HTMLElement | null): void {
  closePopover();
  el.hidden = false;
  anchor?.setAttribute('aria-expanded', 'true');
  current = { el, anchor };
}

export function togglePopover(el: HTMLElement, anchor: HTMLElement | null): boolean {
  if (isPopoverOpen(el)) {
    closePopover();
    return false;
  }
  openPopover(el, anchor);
  return true;
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (!current) return;
    const target = e.target as Node;
    if (current.el.contains(target) || current.anchor?.contains(target)) return;
    closePopover();
    if (target instanceof HTMLCanvasElement) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover();
});
