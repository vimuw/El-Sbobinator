import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUG_REPORT_URL, SUPPORT_EMAIL } from '../../branding';
import { FeedbackImageError, type FeedbackImage } from '../../feedback/images';
import { loadReportHistory, resetReportHistoryForTests } from '../../feedback/history';
import type { FeedbackInput, FeedbackResult } from '../../monitoring/sentry';
import { MASK } from '../../monitoring/scrub';
import { FORM_HEIGHT_CLASS, FeedbackModal } from './FeedbackModal';
import { UNSAVED_CHANGES_HINT } from './UnsavedChangesHint';

const GEMINI_KEY = 'AIzaSyPrimary1234567890123';
const REPORT = `## El Sbobinator (web)\n- Versione: v1.5.0\n- Errore recente con ${GEMINI_KEY}`;

function image(index: number): FeedbackImage {
  return { data: new Uint8Array([index]), filename: `immagine-${index + 1}.jpg`, previewUrl: `blob:image-${index}` };
}

function setup(result: FeedbackResult = { ok: true, code: 'A1B2C3D4' }) {
  const send = vi.fn<(input: FeedbackInput) => Promise<FeedbackResult>>(async () => result);
  const encodeImage = vi.fn(async (_file: File, index: number) => image(index));
  const onClose = vi.fn();
  const view = render(<FeedbackModal onClose={onClose} send={send} encodeImage={encodeImage} loadReport={async () => REPORT} />);
  return { send, encodeImage, onClose, ...view };
}

function chooseKind(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Tipo di segnalazione' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
}

function write(text: string) {
  fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: text } });
}

function addImages(count: number) {
  const files = Array.from({ length: count }, (_, index) => new File(['x'], `foto-${index}.png`, { type: 'image/png' }));
  return act(async () => {
    fireEvent.change(screen.getByTestId('feedback-image-input'), { target: { files } });
  });
}

beforeEach(() => {
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  resetReportHistoryForTests();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
  return spy;
}

async function sendReport() {
  write('L’editor non salva il titolo della sbobina.');
  chooseKind('Suggerimento');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
}

describe('FeedbackModal', () => {
  it('sends only once a type is chosen and the description says enough', async () => {
    const { send } = setup();
    const submit = screen.getByRole('button', { name: 'Invia' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    write('Non va');
    expect(screen.getByText('Almeno 10 caratteri.')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    write('L’editor non salva il titolo della sbobina.');
    expect(screen.getByText('43/5000')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    chooseKind('Bug');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Email (facoltativa)'), { target: { value: 'non-una-email' } });
    expect(screen.getByText('Controlla l’indirizzo email.')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email (facoltativa)'), { target: { value: ' io@example.com ' } });
    await waitFor(() => expect(screen.getByTestId('feedback-tech-report').textContent).toContain('v1.5.0'));
    await act(async () => { fireEvent.click(submit); });
    expect(send).toHaveBeenCalledWith({
      kind: 'bug',
      message: 'L’editor non salva il titolo della sbobina.',
      email: 'io@example.com',
      images: [],
      techReport: REPORT.replace(GEMINI_KEY, MASK),
    });
    // The thanks fade in after the form fades out, and take the focus from the gone "Invia".
    expect((await screen.findByText('Grazie! Messaggio ricevuto.')).closest('[role=status]')).not.toBeNull();
    expect(screen.getByText('A1B2C3D4')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chiudi' }));
  });

  it('keeps the code of a sent report in this browser and copies it on request', async () => {
    const writeText = stubClipboard(async () => {});
    setup({ ok: true, code: 'E5F60718' });
    await sendReport();

    expect(loadReportHistory()).toEqual([{ code: 'E5F60718', sentAt: expect.any(String), kind: 'idea', excerpt: 'L’editor non salva il titolo della sbobina.' }]);
    expect((await screen.findByText(/Impostazioni → Assistenza/)).closest('[role=status]')).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copia codice' })); });
    expect(writeText).toHaveBeenCalledWith('E5F60718');
    expect(screen.getByRole('button', { name: 'Copiato' })).toBeTruthy();
  });

  it('leaves the focus on "Copia codice" after copying, so a second Enter does not close the window', async () => {
    stubClipboard(async () => {});
    const { onClose } = setup({ ok: true, code: 'E5F60718' });
    await sendReport();
    // "Chiudi" takes the focus once, when the thanks appear.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chiudi' })));
    const copy = screen.getByRole('button', { name: 'Copia codice' });
    copy.focus();
    await act(async () => { fireEvent.click(copy); });
    // The copy state re-renders the thanks: the focus must not jump back to "Chiudi".
    expect(screen.getByRole('button', { name: 'Copiato' })).toBe(copy);
    expect(document.activeElement).toBe(copy);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says to copy the code by hand when the clipboard refuses', async () => {
    stubClipboard(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    setup({ ok: true, code: 'E5F60718' });
    await sendReport();
    const copy = await screen.findByRole('button', { name: 'Copia codice' });
    await act(async () => { fireEvent.click(copy); });
    expect(screen.getByText('Non riesco a copiarlo: selezionalo e copialo a mano.')).toBeTruthy();
  });

  it('keeps no code when the report does not go', async () => {
    setup({ ok: false, reason: 'unavailable' });
    await sendReport();
    expect(loadReportHistory()).toEqual([]);
  });

  it('shows the tech info that goes, without keys, and leaves it out when turned off', async () => {
    const { send } = setup();
    const preview = await screen.findByTestId('feedback-tech-report');
    await waitFor(() => expect(preview.textContent).toContain('Versione: v1.5.0'));
    expect(preview.textContent).not.toContain(GEMINI_KEY);
    fireEvent.click(screen.getByRole('switch', { name: 'Allega informazioni tecniche' }));
    expect(screen.queryByTestId('feedback-tech-report')).toBeNull();
    chooseKind('Suggerimento');
    write('Vorrei poter esportare in PDF.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    expect(send.mock.calls[0][0]).toMatchObject({ kind: 'idea', techReport: undefined, email: undefined });
  });

  it('keeps the form one height when the tech preview opens, and lets the thanks shrink', async () => {
    setup();
    const dialog = screen.getByTestId('feedback-dialog');
    expect(dialog.className).toContain(FORM_HEIGHT_CLASS);
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    const preview = await screen.findByTestId('feedback-tech-report');
    fireEvent.click(screen.getByText('Mostra cosa viene inviato'));
    expect((preview.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(dialog.className).toContain(FORM_HEIGHT_CLASS);
    await sendReport();
    await screen.findByText('Grazie! Messaggio ricevuto.');
    expect(dialog.className).not.toContain(FORM_HEIGHT_CLASS);
  });

  it('attaches up to three images, removes one and renumbers the rest', async () => {
    const { send, encodeImage } = setup();
    await addImages(4);
    expect(encodeImage).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Puoi allegare al massimo 3 immagini.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Aggiungi/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi immagine 1' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-0');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    chooseKind('Altro');
    write('Ecco cosa vedo sullo schermo.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    expect(send.mock.calls[0][0].images).toEqual([
      { data: new Uint8Array([1]), filename: 'immagine-1.jpg' },
      { data: new Uint8Array([2]), filename: 'immagine-2.jpg' },
    ]);
  });

  it('says why an image could not be added', async () => {
    const { encodeImage } = setup();
    encodeImage.mockRejectedValueOnce(new FeedbackImageError('"foto-0.png" supera 10 MB.'));
    await addImages(1);
    expect(screen.getByRole('alert').textContent).toBe('"foto-0.png" supera 10 MB.');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('offers an email to the developer when the report cannot be sent', async () => {
    setup({ ok: false, reason: 'unavailable' });
    chooseKind('Bug');
    write('La coda resta ferma al 40%.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    expect(screen.getByRole('alert').textContent).toContain('Non riesco a inviare ora.');
    const email = screen.getByRole('link', { name: SUPPORT_EMAIL });
    expect(email.getAttribute('href')).toBe(BUG_REPORT_URL);
    expect(BUG_REPORT_URL).toMatch(new RegExp(`^mailto:${SUPPORT_EMAIL}\\?subject=`));
    // What was written stays, to try again.
    expect((screen.getByLabelText('Descrizione') as HTMLTextAreaElement).value).toBe('La coda resta ferma al 40%.');
  });

  it('asks to wait after too many messages', async () => {
    setup({ ok: false, reason: 'rate_limited' });
    chooseKind('Bug');
    write('La coda resta ferma al 40%.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    expect(screen.getByRole('alert').textContent).toContain('riprova tra qualche minuto');
    expect(screen.queryByRole('link', { name: SUPPORT_EMAIL })).toBeNull();
  });

  it('closes on a click outside or Esc when empty, and keeps what was written otherwise', () => {
    vi.useFakeTimers();
    const { onClose, container } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    write('Una frase lunga abbastanza.');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('feedback-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.modal-card')?.classList.contains('is-shaking')).toBe(true);
    expect(screen.getAllByRole('status').some(node => node.textContent === UNSAVED_CHANGES_HINT)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('lets Esc close only the open type menu first, without reaching the window underneath', () => {
    // The Settings modal underneath listens for Esc on window, in the bubble phase.
    const underneath = vi.fn();
    window.addEventListener('keydown', underneath);
    try {
      const { onClose } = setup();
      const trigger = screen.getByRole('button', { name: 'Tipo di segnalazione' });

      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(onClose).not.toHaveBeenCalled();

      // Focus moved on with the menu still open: Esc still closes just the menu.
      write('Una frase lunga abbastanza.');
      fireEvent.click(trigger);
      fireEvent.keyDown(screen.getByLabelText('Descrizione'), { key: 'Escape' });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(onClose).not.toHaveBeenCalled();
      expect(underneath).not.toHaveBeenCalled();

      // With the menu closed, Esc is the window's again: guarded with text, closing when empty.
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      write('');
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', underneath);
    }
  });
});
