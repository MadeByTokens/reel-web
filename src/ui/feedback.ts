// Small pieces of feedback shared by every screen: the toast, the busy
// dialog with its progress bar, and the "Ready, Save" dialog.

import { el } from '../editor';

let toastTimer = 0;

export function toast(message: string): void {
  const node = el<HTMLDivElement>('toast');
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (node.hidden = true), 4000);
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

let busyCount = 0;

/**
 * Shows a progress dialog while a task runs. The dialog always closes, even
 * if the task throws. With `abort`, a Cancel button is offered.
 */
export async function busy<T>(text: string, task: (progress: (fraction: number) => void) => Promise<T>, abort?: AbortController): Promise<T> {
  const dialog = el<HTMLDivElement>('busy');
  const bar = el<HTMLProgressElement>('busy-bar');
  const cancel = el<HTMLButtonElement>('busy-cancel');
  el('busy-text').textContent = text;
  bar.removeAttribute('value');
  cancel.hidden = !abort;
  const onCancel = (): void => abort?.abort();
  cancel.addEventListener('click', onCancel);
  dialog.hidden = false;
  busyCount++;
  try {
    return await task((fraction) => {
      bar.value = Math.max(0, Math.min(1, fraction));
    });
  } finally {
    cancel.removeEventListener('click', onCancel);
    if (--busyCount === 0) dialog.hidden = true;
  }
}

export function isBusy(): boolean {
  return busyCount > 0;
}

/** Resolves false when the user closed the share sheet without choosing anything. */
async function deliver(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      // Closing the share sheet is not an error; anything else falls back to a download.
      if (err instanceof DOMException && err.name === 'AbortError') return false;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  return true;
}

/**
 * Offers a finished file. Making it may have taken long enough that the
 * browser no longer counts the original tap, and sharing is only allowed
 * straight after one, so a "Save" button asks for a fresh tap.
 */
export function saveFile(blob: Blob, name: string, notes: string[] = []): Promise<void> {
  return new Promise((resolve) => {
    const dialog = el<HTMLDivElement>('ready');
    const save = el<HTMLButtonElement>('ready-save');
    const close = el<HTMLButtonElement>('ready-close');
    const size = blob.size > 1 << 20 ? `${(blob.size / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
    el('ready-name').textContent = `${name} (${size})`;
    el('ready-notes').textContent = notes.join(' ');
    dialog.hidden = false;
    const done = (): void => {
      dialog.hidden = true;
      save.removeEventListener('click', onSave);
      close.removeEventListener('click', done);
      resolve();
    };
    const onSave = (): void => {
      // A share sheet closed by accident must not throw the finished file away: stay open.
      void deliver(blob, name).then((saved) => {
        if (saved) done();
      });
    };
    save.addEventListener('click', onSave);
    close.addEventListener('click', done);
  });
}

export function safeName(name: string, fallback: string): string {
  return (name.trim() || fallback).replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
}
