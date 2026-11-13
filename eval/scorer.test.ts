import { describe, expect, it } from 'vitest';
import { fillSegments } from './dataset.ts';
import {
  formatScore,
  inventedRate,
  precision,
  proposalProblems,
  readSettled,
  recall,
  scoreRun,
  similarity,
  unclearCsv,
} from './scorer.ts';
import type { AnswerKey, EvalTranscript, RunProposal } from './types.ts';

const transcript: EvalTranscript = {
  consultation: 'test',
  title: 'Test',
  startsAt: '2026-11-05T08:00:00.000Z',
  timeZone: 'Africa/Johannesburg',
  source: { fileName: 'test.vtt', layout: 'teams-vtt' },
  segments: [
    { id: 's1', turn: 'T1', speakerLabel: 'A', startMs: 0, endMs: 1, text: 'We miss collections because messages get buried.' },
    { id: 's2', turn: 'T2', speakerLabel: 'B', startMs: 1, endMs: 2, text: 'About a hundred and twenty a day.' },
    { id: 's3', turn: 'T2', speakerLabel: 'B', startMs: 2, endMs: 3, text: 'In December it roughly doubles.' },
    { id: 's4', turn: 'T3', speakerLabel: 'A', startMs: 3, endMs: 4, text: 'The app must work offline for hours.' },
  ],
};

const key: AnswerKey = fillSegments(
  {
    meeting: 'test',
    status: 'test',
    findings: [
      {
        id: 'K1',
        kind: 'operational-challenge',
        status: 'confirmed',
        statement: 'Collections are missed because messages get buried.',
        turns: ['T1'],
        segments: [],
      },
      {
        id: 'K2',
        kind: 'scalability',
        status: 'confirmed',
        statement: 'About 120 collections a day, doubling in December.',
        turns: ['T2'],
        segments: [],
        alsoAccept: ['performance'],
      },
      {
        id: 'K3',
        kind: 'constraint',
        status: 'confirmed',
        statement: 'The app must work offline for hours.',
        turns: ['T3'],
        segments: [],
      },
    ],
  },
  transcript,
).key;

const p = (kind: string, statement: string, evidence: [string, string][], status = 'suggested'): RunProposal => ({
  kind,
  status,
  statement,
  evidence: evidence.map(([segmentId, quote]) => ({ segmentId, quote })),
});

describe('the answer key', () => {
  it('gets its segment ids from its turns', () => {
    expect(key.findings.map((f) => f.segments)).toEqual([['s1'], ['s2', 's3'], ['s4']]);
    const bad = fillSegments({ ...key, findings: [{ ...key.findings[0], turns: ['T9'] }] }, transcript);
    expect(bad.unknownTurns).toEqual(['T9']);
  });
});

describe('checking evidence', () => {
  it('passes quotes that appear in their segment, ignoring case and spacing', () => {
    expect(proposalProblems(transcript, p('constraint', 'x', [['s4', 'must  WORK offline']]))).toEqual([]);
  });

  it('counts an unknown segment or a changed quote as invented', () => {
    expect(proposalProblems(transcript, p('constraint', 'x', [['s9', 'must work offline']]))).toEqual(['unknown-segment']);
    expect(proposalProblems(transcript, p('constraint', 'x', [['s4', 'must work online']]))).toEqual(['quote-not-in-segment']);
  });

  it('refuses no evidence, a short quote, a kind or status the AI may not use', () => {
    expect(proposalProblems(transcript, p('constraint', 'x', []))).toEqual(['no-evidence']);
    expect(proposalProblems(transcript, p('constraint', 'x', [['s4', 'offline']]))).toEqual(['quote-too-short']);
    expect(proposalProblems(transcript, p('wish', 'x', [['s4', 'must work offline']], 'confirmed'))).toEqual([
      'bad-kind',
      'bad-status',
    ]);
  });
});

describe('scoring a run', () => {
  it('matches on a shared segment and an accepted kind, and reports precision and recall per kind', () => {
    const score = scoreRun(transcript, key, [
      p('operational-challenge', 'Messages get buried, so collections are missed.', [['s1', 'messages get buried']]),
      p('performance', 'Volume doubles in December.', [['s3', 'it roughly doubles']]),
      p('risk', 'Invented', [['s4', 'the app will crash']]),
    ]);
    expect(score.proposals.map((r) => r.matched)).toEqual(['K1', 'K2', null]);
    expect(score.missed).toEqual(['K3']);
    expect(score.total).toMatchObject({ proposed: 3, correct: 2, invented: 1, expected: 3, found: 2 });
    expect(precision(score.total)).toBeCloseTo(2 / 3);
    expect(recall(score.total)).toBeCloseTo(2 / 3);
    expect(inventedRate(score.total)).toBeCloseTo(1 / 3);
    const scalability = score.byKind.find((k) => k.kind === 'scalability')!;
    expect(scalability).toMatchObject({ proposed: 0, expected: 1, found: 1 });
    expect(score.byKind.find((k) => k.kind === 'performance')).toMatchObject({ proposed: 1, correct: 1, expected: 0 });
    expect(score.dropped).toBe(1);
    expect(score.statusAgrees).toBe(2);
  });

  it('lists another kind on a shared segment as unclear, and counts it only once settled yes', () => {
    const run = [p('risk', 'Collections get missed in the WhatsApp group.', [['s1', 'we miss collections']])];
    const open = scoreRun(transcript, key, run);
    expect(open.unclear).toEqual([{ proposal: 1, key: 'K1', reason: 'other-kind' }]);
    expect(open.unsettled).toBe(1);
    expect(open.total.correct).toBe(0);

    const csv = unclearCsv(open, key, run);
    expect(csv).not.toContain('\r'); // LF, as git stores it, so scoring again never rewrites a file
    expect(csv.split('\n')[0]).toBe('proposal,key,reason,proposed kind,proposed statement,key kind,key statement,match');
    const answered = csv.replace(/,\n$/, ',yes\n');
    const settled = readSettled(answered);
    const closed = scoreRun(transcript, key, run, settled);
    expect(closed.unsettled).toBe(0);
    expect(closed.proposals[0]).toMatchObject({ matched: 'K1', how: 'settled' });
    expect(unclearCsv(closed, key, run, settled)).toBe(answered);
    expect(scoreRun(transcript, key, run, readSettled(csv.replace(/,\n$/, ',no\n'))).total.correct).toBe(0);
  });

  it('lists the same kind with similar words but no shared segment as unclear', () => {
    const score = scoreRun(transcript, key, [
      p('constraint', 'The app must work offline for hours.', [['s2', 'a hundred and twenty']]),
    ]);
    expect(score.unclear).toContainEqual({ proposal: 1, key: 'K3', reason: 'no-shared-segment' });
  });

  it('counts a second proposal for the same finding as a duplicate, and prefers a finding not yet matched', () => {
    const score = scoreRun(transcript, key, [
      p('constraint', 'Offline for hours.', [['s4', 'work offline for hours']]),
      p('constraint', 'Must work offline.', [['s4', 'must work offline']]),
    ]);
    expect(score.proposals.map((r) => [r.matched, r.duplicate])).toEqual([
      ['K3', false],
      ['K3', true],
    ]);
    expect(score.duplicates).toBe(1);
    expect(score.total).toMatchObject({ correct: 2, found: 1 });
  });

  it('reads quoted CSV fields with commas, quotes and line breaks', () => {
    const settled = readSettled('﻿proposal,key,match\r\n1,K1,"yes"\r\n2,K2,\r\n3,"K3",No\r\n');
    expect([...settled]).toEqual([
      ['1:K1', true],
      ['3:K3', false],
    ]);
    const run = [p('risk', 'Says "buried", then, a comma\nand a line', [['s1', 'we miss collections']])];
    const csv = unclearCsv(scoreRun(transcript, key, run), key, run);
    expect(readSettled(csv.replace(/,\n$/, ',yes\n')).get('1:K1')).toBe(true);
  });

  it('formats a table', () => {
    const table = formatScore(scoreRun(transcript, key, []));
    expect(table).toContain('| **All** | 0 | 0 | – | 3 | 0 | 0% | – |');
    expect(table).toContain('Missed: K1, K2, K3.');
  });

  it('measures how alike two statements are', () => {
    expect(similarity('The app must work offline', 'the APP must work offline')).toBe(1);
    expect(similarity('alpha beta', 'gamma delta')).toBe(0);
  });
});
