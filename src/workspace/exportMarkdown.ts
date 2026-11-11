/**
 * An engagement's record as one Markdown file (MVP story 8; Phase 1 brief,
 * WP11). Pure and deterministic: the same record always gives the same
 * file, byte for byte. There is no export time in it, and everything has a
 * fixed order. Each session's times are written in the time zone it was
 * created in, with the offset (Phase 2 brief, decision 18), so they read as
 * the meeting's local time on any computer. Nothing from other engagements
 * or other companies is included.
 */
import { consentFor, consentState } from './model/consent.ts';
import { recordGroups } from './model/findings.ts';
import { GROUPS, KIND_LABEL, provenanceLabel, RELATION_LABEL, STATUS_LABEL } from './model/labels.ts';
import { evidenceSession } from './model/record.ts';
import { speakerOf } from './model/transcripts.ts';
import {
  CONSENT_STATEMENTS,
  type CompanyWorkspace,
  type ConsentAmendment,
  type ConsentRecord,
  type Evidence,
  type Finding,
  type Retention,
} from './model/types.ts';
import { get } from './model/util.ts';
import { wordingFor } from './model/wording.ts';

/**
 * Text from the record, made safe to place in Markdown: nothing in it can
 * become a heading (including one underlined with = or -), a list, a link or
 * emphasis. A value that isn't text (a damaged file, opened read-only) is
 * shown as a placeholder rather than "undefined".
 */
export function md(value: unknown): string {
  if (typeof value !== 'string') return '(unreadable)';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([#>+=-]|\d+[.)])/gm, (_m, space: string, mark: string) => `${space}\\${mark}`)
    .replace(/\n/g, '  \n');
}

/** Text for a heading, which has to stay on one line. */
function heading(value: unknown): string {
  return md(typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ') : value);
}

/** Compares by character codes, not the computer's language settings, so every computer sorts alike. */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A timestamp as a fixed, readable UTC time: "2026-11-04 09:00 UTC", for times that belong to no session. */
function utc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/**
 * A timestamp in a session's time zone, with the offset: "2026-11-05 10:00
 * (GMT+2)" (decision 18). The parts are put together here, not by the
 * computer's language settings, so every computer writes the same. Without a
 * zone it can read, it is written in UTC.
 */
export function localTime(iso: string, timeZone: unknown): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || typeof timeZone !== 'string') return utc(iso);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    }).formatToParts(t);
  } catch {
    return utc(iso);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} (${part('timeZoneName')})`;
}

/** A time in a session's zone, or in UTC if the session is gone. */
function sessionTime(ws: CompanyWorkspace, sessionId: string | null | undefined, iso: string): string {
  const session = sessionId ? get(ws.sessions, sessionId) : undefined;
  return session ? localTime(iso, session.timeZone) : utc(iso);
}

const byTime =
  <T extends { id: string }>(time: (x: T) => string) =>
  (a: T, b: T) =>
    byCode(time(a), time(b)) || byCode(a.id, b.id);

function retentionText(r: Retention): string {
  return r.kind === 'days'
    ? `audio kept for ${r.days} ${r.days === 1 ? 'day' : 'days'}`
    : r.kind === 'until-engagement-ends'
      ? 'audio kept until the engagement ends'
      : 'audio deleted after transcription';
}

const yesNo = (v: boolean) => (v ? 'yes' : 'no');

/** The engagement's record as Markdown. */
export function exportEngagementMarkdown(ws: CompanyWorkspace, engagementId: string): string {
  const engagement = get(ws.engagements, engagementId);
  if (!engagement) throw new Error('The engagement does not exist.');
  const { company } = ws;
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(`# ${heading(engagement.name)}`, '', `Record of the engagement with ${md(company.name)}, exported from StyleCode.`, '');

  // Company and engagement.
  push('## Company', '');
  push(`- **Name:** ${md(company.name)}`);
  if (company.industry) push(`- **Industry:** ${md(company.industry)}`);
  if (company.description) push(`- **What they do:** ${md(company.description)}`);
  if (company.existingSystems) push(`- **Existing systems:** ${md(company.existingSystems)}`);
  push('', '## Engagement', '');
  if (engagement.goal) push(`- **Goal:** ${md(engagement.goal)}`);
  push(`- **Status:** ${engagement.status.state === 'active' ? 'active' : `ended on ${md(engagement.status.endedOn)}`}`, '');

  // Sessions, with their participants.
  const sessions = Object.values(ws.sessions)
    .filter((s) => s.engagementId === engagementId)
    .sort(byTime((s) => s.startsAt));
  push('## Sessions', '');
  if (!sessions.length) push('No sessions.', '');
  for (const s of sessions) {
    push(`### ${heading(s.title)}`, '', localTime(s.startsAt, s.timeZone), '');
    const people = Object.values(ws.participants)
      .filter((p) => p.sessionId === s.id)
      .sort(
        (a, b) =>
          Number(a.side === 'consultant') - Number(b.side === 'consultant') || byCode(a.name, b.name) || byCode(a.id, b.id),
      );
    if (!people.length) push('No participants recorded.', '');
    else {
      for (const p of people) {
        const about = [p.role, p.organisation].filter(Boolean).map(md).join(', ');
        push(`- ${md(p.name)}${about ? `, ${about}` : ''} (${p.side === 'client' ? 'client' : 'consultant’s side'})`);
      }
      push('');
    }
  }

  // Findings, grouped as in the record, numbered so links can refer to them.
  const groups = recordGroups(ws, engagementId);
  const numbered = new Map<string, number>();
  for (const g of GROUPS) for (const f of groups[g.key]) numbered.set(f.id, numbered.size + 1);
  push('## Findings', '');
  if (!numbered.size) push('No findings.', '');
  for (const g of GROUPS) {
    if (!groups[g.key].length) continue;
    push(`### ${g.title}`, '');
    for (const f of groups[g.key]) push(...findingLines(ws, f, numbered.get(f.id)!), '');
  }

  // Links between findings in the record.
  const relations = Object.values(ws.relations)
    .filter((r) => numbered.has(r.fromId) && numbered.has(r.toId))
    .sort(
      (a, b) =>
        numbered.get(a.fromId)! - numbered.get(b.fromId)! ||
        numbered.get(a.toId)! - numbered.get(b.toId)! ||
        byCode(a.type, b.type) ||
        byCode(a.id, b.id),
    );
  push('## Links', '');
  if (!relations.length) push('No links.', '');
  else {
    for (const r of relations) {
      const from = get(ws.findings, r.fromId)!;
      const to = get(ws.findings, r.toId)!;
      push(
        `- F${numbered.get(r.fromId)} (${md(from.statement)}) **${RELATION_LABEL[r.type].from.toLowerCase()}** F${numbered.get(r.toId)} (${md(to.statement)})`,
      );
    }
    push('');
  }

  // Every session's consent record, with its amendments and the wording shown (C9).
  push('## Consent', '');
  if (!sessions.length) push('No sessions.', '');
  for (const s of sessions) {
    push(`### ${heading(s.title)}`, '');
    const record = consentFor(ws, s.id);
    if (!record) push('No consent record.', '');
    else push(...consentLines(ws, record), '');
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function findingLines(ws: CompanyWorkspace, f: Finding, n: number): string[] {
  const out = [
    `#### F${n}. ${heading(f.statement)}`,
    '',
    `- **Kind:** ${KIND_LABEL[f.kind]}`,
    `- **Status:** ${STATUS_LABEL[f.status]}`,
    `- **Provenance:** ${md(provenanceLabel(f.provenance))}`,
  ];
  if (f.origin.kind === 'ai')
    out.push(`- **Proposed by:** AI (${md(f.origin.provider)}, ${md(f.origin.model)}), accepted by the consultant`);
  for (const e of f.evidence) out.push(`- **Evidence:** ${evidenceText(ws, e)}`);
  return out;
}

function evidenceText(ws: CompanyWorkspace, e: Evidence): string {
  const sessionId = evidenceSession(ws, e);
  const session = sessionId ? get(ws.sessions, sessionId) : undefined;
  const where = session ? md(session.title) : 'a deleted session';
  if (e.kind === 'deleted') return `a quote from ${where}, since deleted (${sessionTime(ws, sessionId, e.deletedAt)})`;
  if (e.kind === 'note') {
    const note = get(ws.notes, e.noteId);
    return `“${md(e.quote)}”, a note in ${where}${note ? ` at ${sessionTime(ws, sessionId, note.writtenAt)}` : ''}`;
  }
  // The speaker: the participant matched to the transcript's label, or the label as the transcript gives it.
  const segment = get(ws.segments, e.segmentId);
  const label = segment?.speakerLabel;
  const speaker = label ? (sessionId && speakerOf(ws, sessionId, label)?.name) || label : null;
  return `“${md(e.quote)}”, said${speaker ? ` by ${md(speaker)}` : ''} in ${where}`;
}

const METHOD = { 'verbal-at-start': 'verbally at the start of the meeting', 'written-before': 'in writing beforehand' } as const;

function consentLines(ws: CompanyWorkspace, r: ConsentRecord): string[] {
  const at = (iso: string) => sessionTime(ws, r.sessionId, iso);
  const asked = r.askedParticipantIds.map((id) => md(get(ws.participants, id)?.name ?? id)).join(', ');
  const provider = r.given.externalProvider ?? r.told.externalProvider;
  const out = [
    `- **Who was asked:** ${asked || 'no one'}`,
    `- **Asked by:** ${md(r.askedBy) || 'not given'}`,
    `- **How:** ${r.method.kind === 'other' ? md(r.method.description) : METHOD[r.method.kind]}`,
    `- **Agreed to:** audio recording ${yesNo(r.given.audioRecording)}; transcription ${yesNo(r.given.transcription)}; AI on this computer ${yesNo(r.given.aiLocal)}; AI by an external provider ${r.given.aiExternal ? `yes (${md(r.given.externalProvider ?? '')})` : 'no'}`,
    `- **Outcome:** ${r.outcome.kind === 'given' ? 'given' : r.outcome.kind === 'declined' ? 'declined' : `given with limits: ${md(r.outcome.limits)}`}`,
    `- **Confirmed:** ${r.confirmed ? `by ${md(r.confirmed.by)}, ${at(r.confirmed.at)}` : 'no (a draft, which allows nothing)'}`,
  ];
  // How long audio is kept means something only once audio recording was agreed, as on the form.
  if (r.given.audioRecording || r.amendments.some((a) => a.kind === 'change' && a.given?.audioRecording))
    out.splice(4, 0, `- **Retention:** ${retentionText(r.retention)}`);
  if (r.lockedAt) out.push(`- **Locked:** ${at(r.lockedAt)}`);
  // What the record allows now, after its amendments (consentState): the answer a reader is looking for.
  const state = consentState(r);
  const allowed = [
    state.given.audioRecording && 'audio recording',
    state.given.transcription && 'transcription',
    state.given.aiLocal && 'AI on this computer',
    state.given.aiExternal && `AI by ${md(state.given.externalProvider ?? '')}`,
  ].filter(Boolean);
  out.push(
    `- **Allows now:** ${state.withdrawn ? 'nothing: consent was withdrawn, and nothing more is captured or processed' : allowed.length ? allowed.join(', ') : 'nothing'}`,
  );
  out.push('', `What the client was told (wording ${md(r.wordingVersion)}; [x] = told):`, '');
  out.push(...wordingLines(r.wordingVersion, (s) => r.told[s] === true, provider, r.retention));
  for (const a of [...r.amendments].sort(byTime((x) => x.at))) out.push('', ...amendmentLines(a, at, provider, r.retention));
  return out;
}

function wordingLines(
  version: string,
  told: (s: (typeof CONSENT_STATEMENTS)[number]) => boolean,
  provider: string | null,
  retention: Retention,
): string[] {
  const wording = wordingFor(version);
  if (!wording) return [`- This StyleCode doesn't have the text of wording ${md(version)}.`];
  return CONSENT_STATEMENTS.filter((s) => s !== 'processingExternal' || provider || told(s)).map(
    (s) => `- [${told(s) ? 'x' : ' '}] “${md(wording.statement(s, { provider, retention }))}”`,
  );
}

function amendmentLines(
  a: ConsentAmendment,
  at: (iso: string) => string,
  provider: string | null,
  retention: Retention,
): string[] {
  const head = `**${a.kind === 'withdrawal' ? 'Withdrawal' : 'Amendment'}**, ${at(a.at)}, by ${md(a.by)}. Reason: ${md(a.reason)}`;
  if (a.kind === 'withdrawal') return [head];
  const out = [head];
  const changes: string[] = [];
  if (a.given) {
    const names: Record<string, string> = {
      audioRecording: 'audio recording',
      transcription: 'transcription',
      aiLocal: 'AI on this computer',
      aiExternal: 'AI by an external provider',
    };
    for (const [k, v] of Object.entries(a.given))
      if (k in names && typeof v === 'boolean') changes.push(`${names[k]} ${yesNo(v)}`);
    if (a.given.externalProvider) changes.push(`external provider ${md(a.given.externalProvider)}`);
  }
  if (a.retention) changes.push(retentionText(a.retention));
  if (a.outcome) changes.push(`outcome ${a.outcome.kind}${a.outcome.kind === 'limited' ? `: ${md(a.outcome.limits)}` : ''}`);
  if (changes.length) out.push('', `Changes: ${changes.join('; ')}.`);
  if (a.told && a.wordingVersion) {
    const told = a.told;
    out.push('', `Newly told (wording ${md(a.wordingVersion)}):`, '');
    out.push(
      ...wordingLines(
        a.wordingVersion,
        (s) => told[s] === true,
        told.externalProvider ?? provider,
        a.retention ?? retention,
      ).filter((l) => l.startsWith('- [x]')),
    );
  }
  return out;
}

/** A file name for the export: "harbour-bakery-online-ordering.md". */
export function exportFileName(companyName: string, engagementName: string): string {
  const slug = `${companyName} ${engagementName}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'record'}.md`;
}
