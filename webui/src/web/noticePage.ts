// A full page shown instead of the app: another tab has it, or the browser blocks the site's data.
// Plain DOM with inline styles, before the app mounts.

export interface Notice {
  title: string;
  text: string;
  button: string;
  /** The button's action; the button turns off after the first tap. */
  onClick: () => void;
}

/** Shows the notice over the page; returns its removal. */
export function showNoticePage(notice: Notice, target: Document = document): () => void {
  const page = target.createElement('div');
  page.setAttribute('role', 'alert');
  page.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg-base,#141414);color:var(--text-primary,#f5f5f5);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;z-index:2147483647';
  const box = target.createElement('div');
  box.style.cssText = 'max-width:440px;text-align:center;line-height:1.6';
  const title = target.createElement('h1');
  title.style.cssText = 'margin:0;font-size:1.25rem;font-weight:600';
  title.textContent = notice.title;
  const text = target.createElement('p');
  text.style.cssText = 'margin:10px 0 20px;color:var(--text-muted,#9ca3af);font-size:0.9rem';
  text.textContent = notice.text;
  const button = target.createElement('button');
  button.type = 'button';
  // The page's only action: the app's primary pill, wide enough that a short label isn't a stub.
  button.className = 'modal-action-button is-primary';
  button.style.minWidth = '8.5rem';
  button.textContent = notice.button;
  button.addEventListener('click', () => {
    button.disabled = true;
    notice.onClick();
  });
  box.append(title, text, button);
  page.append(box);
  target.body.append(page);
  return () => page.remove();
}
