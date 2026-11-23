// A small question dialog: a message, an optional text field, OK and Cancel.

function node<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export interface AskOptions {
  title: string;
  /** Show a text field with this starting value. */
  value?: string;
  ok: string;
  /** Style the confirm button as a warning. */
  danger?: boolean;
}

/** Resolves with the text (or "" when there is no field), or null if cancelled. */
export function ask(options: AskOptions): Promise<string | null> {
  const dialog = node<HTMLDivElement>('ask');
  const input = node<HTMLInputElement>('ask-input');
  const ok = node<HTMLButtonElement>('ask-ok');
  const cancel = node<HTMLButtonElement>('ask-cancel');
  node('ask-title').textContent = options.title;
  input.hidden = options.value === undefined;
  input.value = options.value ?? '';
  ok.textContent = options.ok;
  ok.classList.toggle('danger', !!options.danger);
  dialog.hidden = false;
  if (!input.hidden) {
    input.focus();
    input.select();
  }
  return new Promise((resolve) => {
    const done = (result: string | null): void => {
      dialog.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = (): void => done(input.hidden ? '' : input.value.trim());
    const onCancel = (): void => done(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') onOk();
      else if (e.key === 'Escape') onCancel();
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}
