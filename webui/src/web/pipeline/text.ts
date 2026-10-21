// Text helpers ported from the desktop app: degenerate-output guardrail
// (services/gemini_errors.py), conservative dedup before revision
// (utils/dedup_utils.py) and macro-block splitting (services/revision_service.py).

/** Same normalization as `_normalize_guardrail_text` / `_norm_for_dedup`. */
export function normalizeForCompare(text: string): string {
  return (text ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.;:!?])\s*/g, '$1');
}

const countMax = (items: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
};

/** Returns an Italian reason when the model output looks degenerate, else null. */
export function detectDegenerateOutput(text: string): string | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const paragraphs = raw
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;

  const longest = Math.max(...paragraphs.map((p) => p.length));
  if (longest > 12000) return `paragrafo troppo lungo (${longest} caratteri)`;

  const paraCandidates = paragraphs.map(normalizeForCompare).filter((p) => p.length >= 80);
  if (paraCandidates.length) {
    const counts = countMax(paraCandidates);
    const repeated = Math.max(0, ...counts.values());
    if (repeated >= 4) return `paragrafo ripetuto ${repeated} volte`;
    let dup = 0;
    for (const c of counts.values()) if (c > 1) dup += c - 1;
    if (dup >= 8 && dup / Math.max(1, paraCandidates.length) >= 0.2) return `troppi paragrafi duplicati (${dup} duplicati)`;
  }

  const sentences: string[] = [];
  for (const p of paragraphs) {
    for (const s of p.split(/(?<=[.!?])\s+|\n+/)) {
      const n = normalizeForCompare(s);
      if (n.length >= 40) sentences.push(n);
    }
  }
  if (sentences.length) {
    const repeated = Math.max(0, ...countMax(sentences).values());
    if (repeated >= 8) return `frase ripetuta ${repeated} volte`;
  }

  if (raw.length > 120000 && paragraphs.length <= 5) return `output eccessivo e poco segmentato (${raw.length} caratteri)`;
  return null;
}

/**
 * difflib.SequenceMatcher(None, a, b).ratio() with Python's default autojunk
 * heuristic (b longer than 200 chars: characters seen more than 1% + 1 times are junk).
 */
export function sequenceRatio(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (!la && !lb) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < lb; j++) {
    const ch = b[j];
    let arr = b2j.get(ch);
    if (!arr) b2j.set(ch, (arr = []));
    arr.push(j);
  }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [ch, idxs] of [...b2j]) if (idxs.length > ntest) b2j.delete(ch);
  }

  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    // difflib then extends the match over equal neighbours (popular characters
    // are not "junk" when isjunk is None, so any equal character extends it).
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };

  let matches = 0;
  const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / (la + lb);
}

/** Port of local_macro_cleanup: drops only certain duplicates. Returns [text, removedExact, removedAdjacent]. */
export function localMacroCleanup(md: string): [string, number, number] {
  const src = (md ?? '').trim();
  if (!src) return ['', 0, 0];
  const paras = src
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return [src, 0, 0];
  const kept: string[] = [];
  const seen = new Set<string>();
  let removedExact = 0;
  let removedAdj = 0;
  let prevNorm = '';
  for (const p of paras) {
    const minLen = /^\s*#{1,6}\s+/.test(p) ? 20 : 60;
    const norm = normalizeForCompare(p);
    if (norm.length >= minLen && seen.has(norm)) {
      removedExact++;
      continue;
    }
    if (prevNorm && norm.length >= 100 && prevNorm.length >= 100 && sequenceRatio(prevNorm, norm) >= 0.995) {
      removedAdj++;
      continue;
    }
    kept.push(p);
    if (norm.length >= minLen) seen.add(norm);
    prevNorm = norm;
  }
  return [kept.join('\n\n').trim(), removedExact, removedAdj];
}

/** Port of build_macro_blocks. */
export function buildMacroBlocks(text: string, limit: number): string[] {
  const blocks: string[] = [];
  let parts: string[] = [];
  let len = 0;
  const headingRe = /^\s*#{1,3}\s+\S/;
  for (const paragraph of text.split('\n\n')) {
    const seg = paragraph + '\n\n';
    const isHeading = headingRe.test(paragraph);
    const pastSoft = len > limit * 0.7;
    const hasContent = len > 500;
    if (len + paragraph.length > limit && parts.length) {
      blocks.push(parts.join(''));
      parts = [seg];
      len = seg.length;
    } else if (isHeading && pastSoft && hasContent && parts.length) {
      blocks.push(parts.join(''));
      parts = [seg];
      len = seg.length;
    } else {
      parts.push(seg);
      len += seg.length;
    }
  }
  if (parts.length) {
    const joined = parts.join('');
    if (joined.trim()) blocks.push(joined);
  }
  return blocks;
}

/** Port of config_service.safe_output_basename. */
export function safeOutputBasename(name: string): string {
  let s = (name ?? '').trim() || 'Sbobina';
  s = s.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? s.slice(0, 140) : s;
}
