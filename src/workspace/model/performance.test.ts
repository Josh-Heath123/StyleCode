import { describe, expect, it } from 'vitest';
import { sampleWorkspace } from './fixtures';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';
import { parseWorkspace } from './workspace';

/**
 * Performance budgets on a large company: 60 one-hour meetings of 900
 * transcript segments each (54,000 segments, a 12.7 MB file) and 2,400
 * findings. On the user's laptop, validating takes about 60 ms and loading
 * (parse plus validate) about 190 ms (measured 2026-11-04, Node 22.15). The
 * budgets are several times that, so they only fail on a real regression,
 * such as something quadratic in the number of segments.
 */
function bigWorkspace(sessions = 60, segments = 900, findings = 40): CompanyWorkspace {
  const ws = sampleWorkspace();
  const words = 'we need the order page to work on phones and the stock count has to match the tills'.split(' ');
  for (let s = 0; s < sessions; s++) {
    const se = `se_m${s}`;
    const tr = `tr_m${s}`;
    ws.sessions[se] = { ...ws.sessions.se_1, id: se, title: `Meeting ${s}` };
    ws.participants[`pa_c${s}`] = { ...ws.participants.pa_client, id: `pa_c${s}`, sessionId: se };
    ws.consents[`cr_m${s}`] = { ...ws.consents.cr_1, id: `cr_m${s}`, sessionId: se, askedParticipantIds: [`pa_c${s}`] };
    ws.transcripts[tr] = { ...ws.transcripts.tr_1, id: tr, sessionId: se };
    for (let i = 0; i < segments; i++) {
      const text = Array.from({ length: 12 }, (_, k) => words[(i + k * 7) % words.length]).join(' ') + '.';
      const id = `sg_m${s}x${i}`;
      ws.segments[id] = {
        id,
        transcriptId: tr,
        index: i,
        speakerLabel: 'Alex Owner',
        startMs: i * 4000,
        endMs: i * 4000 + 3900,
        text,
        confidence: null,
      };
    }
    for (let f = 0; f < findings; f++) {
      const seg = ws.segments[`sg_m${s}x${f}`];
      const id = `fd_m${s}x${f}`;
      ws.findings[id] = {
        ...ws.findings.fd_peak,
        id,
        statement: `Finding ${f} of meeting ${s}.`,
        evidence: [{ kind: 'segment', segmentId: seg.id, quote: seg.text.split(' ').slice(0, 5).join(' ') }],
      };
    }
  }
  return ws;
}

const time = (f: () => void) => {
  const start = performance.now();
  f();
  return performance.now() - start;
};

describe('workspace performance budgets', () => {
  const ws = bigWorkspace();
  const text = JSON.stringify(ws);

  it('validates 54,000 segments in under a second', () => {
    let problems = -1;
    const ms = time(() => (problems = validateWorkspace(ws).length));
    expect(problems).toBe(0);
    expect(ms).toBeLessThan(1000);
  });

  it('loads a 12 MB workspace in under two seconds', () => {
    let access = '';
    const ms = time(() => {
      const parsed = parseWorkspace(JSON.parse(text));
      access = parsed.ok ? parsed.access : 'refused';
    });
    expect(access).toBe('editable');
    expect(ms).toBeLessThan(2000);
  });
});
