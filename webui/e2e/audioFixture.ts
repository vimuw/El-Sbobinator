import fs from 'node:fs';
import { expect, type Page } from '@playwright/test';

// Two seconds of 16 kHz mono silence, as a WAV the player can actually play. The specs
// name the file .mp3, since the web site accepts only .mp3, .m4a and .mp4; Chromium plays
// it by its content.
export function writeSilentWav(file: string): string {
  const samples = 32000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  fs.writeFileSync(file, wav);
  return file;
}

// The audio dock resolves after the editor appears: wait until the player holds
// the playback copy, so later layout reads see the page as it stays.
export async function expectPlaybackAudioReady(page: Page): Promise<void> {
  await expect(page.locator('.editor-player-dock audio')).toHaveCount(1, { timeout: 30000 });
  await expect(page.getByTestId('editor-audio-warning')).toHaveCount(0);
}
