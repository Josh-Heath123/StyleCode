/**
 * Lines up the script's words with an engine's words: the fewest
 * substitutions, deletions and insertions (the word error rate's edit
 * distance), with the pairing itself, so each script word can be followed to
 * what the engine wrote for it. Hirschberg's method keeps the memory linear,
 * so an hour of meeting (about 10,000 words each side) needs no 10,000 ×
 * 10,000 table. Pure.
 */

export type Step =
  | { op: 'match'; ref: number; hyp: number }
  | { op: 'sub'; ref: number; hyp: number }
  | { op: 'del'; ref: number }
  | { op: 'ins'; hyp: number };

/** The edit costs of a against every prefix of b: the last row of the usual table. */
function lastRow(a: Int32Array, b: Int32Array): Int32Array {
  let prev = new Int32Array(b.length + 1);
  let row = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const diagonal = prev[j - 1] + (ai === b[j - 1] ? 0 : 1);
      const up = prev[j] + 1;
      const left = row[j - 1] + 1;
      row[j] = diagonal < up ? (diagonal < left ? diagonal : left) : up < left ? up : left;
    }
    [prev, row] = [row, prev];
  }
  return prev;
}

/** The full table and its path, for a small piece. */
function smallAlign(a: Int32Array, b: Int32Array, aAt: number, bAt: number, out: Step[]): void {
  const w = b.length + 1;
  const t = new Int32Array((a.length + 1) * w);
  for (let i = 0; i <= a.length; i++) t[i * w] = i;
  for (let j = 0; j <= b.length; j++) t[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      t[i * w + j] = Math.min(
        t[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        t[(i - 1) * w + j] + 1,
        t[i * w + j - 1] + 1,
      );
  const steps: Step[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && t[i * w + j] === t[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      steps.push({ op: a[i - 1] === b[j - 1] ? 'match' : 'sub', ref: aAt + i - 1, hyp: bAt + j - 1 });
      i--;
      j--;
    } else if (i > 0 && t[i * w + j] === t[(i - 1) * w + j] + 1) {
      steps.push({ op: 'del', ref: aAt + i - 1 });
      i--;
    } else {
      steps.push({ op: 'ins', hyp: bAt + j - 1 });
      j--;
    }
  }
  for (let k = steps.length - 1; k >= 0; k--) out.push(steps[k]);
}

function hirschberg(a: Int32Array, b: Int32Array, aAt: number, bAt: number, out: Step[]): void {
  if (a.length <= 2 || b.length <= 2 || a.length * b.length <= 4096) return smallAlign(a, b, aAt, bAt, out);
  const mid = a.length >> 1;
  const left = lastRow(a.subarray(0, mid), b);
  const right = lastRow(a.subarray(mid).slice().reverse(), b.slice().reverse());
  let split = 0;
  let best = Infinity;
  for (let k = 0; k <= b.length; k++) {
    const cost = left[k] + right[b.length - k];
    if (cost < best) {
      best = cost;
      split = k;
    }
  }
  hirschberg(a.subarray(0, mid), b.subarray(0, split), aAt, bAt, out);
  hirschberg(a.subarray(mid), b.subarray(split), aAt + mid, bAt + split, out);
}

/** The alignment of two word lists. */
export function alignWords(ref: readonly string[], hyp: readonly string[]): Step[] {
  const ids = new Map<string, number>();
  const id = (w: string) => ids.get(w) ?? (ids.set(w, ids.size), ids.size - 1);
  const a = Int32Array.from(ref, id);
  const b = Int32Array.from(hyp, id);
  const out: Step[] = [];
  hirschberg(a, b, 0, 0, out);
  return out;
}

/** Counts of an alignment, and the word error rate: (substitutions + deletions + insertions) / script words. */
export function errorRate(steps: readonly Step[], refWords: number) {
  const n = { match: 0, sub: 0, del: 0, ins: 0 };
  for (const s of steps) n[s.op]++;
  return { ...n, wer: refWords ? (n.sub + n.del + n.ins) / refWords : 0 };
}
