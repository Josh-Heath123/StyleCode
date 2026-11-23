import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { listTranscriptions, openCompany, type CompanySummary } from '../api';
import { deletionReasonFor, recordingsPastTime, removeRecordings, retentionOf, type Recording } from '../model/recordings';
import type { CompanyWorkspace, DeletionReason } from '../model/types';
import { get } from '../model/util';
import { routeHref } from '../routes';
import { count } from './chrome';
import { DeleteDialog, NameField, nameFor } from './fields';
import { retentionText } from './retention';
import { now, permanentStep } from './steps';
import { stopPlaying } from './transcription/player';
import { formatLength } from '../time';
import { reopenHeld } from './useCompanySession';
import { useConsultant } from './useConsultant';

/** One recording on the start-up list. */
interface Listed {
  companyId: string;
  companyName: string;
  engagementId: string;
  sessionId: string;
  sessionTitle: string;
  recording: Recording;
  line: string;
  /** The reason a deletion records, for a recording past its time; null for one waiting for its transcript. */
  reason: DeletionReason | null;
  /** Its client opens read-only (a file with problems), so nothing of it can be deleted until the file is put right. */
  readOnly: boolean;
}

/** How many clients are read at once for the list: enough that many clients don't keep it waiting, few enough not to crowd the server. */
const READ_AT_ONCE = 6;

/**
 * Every client's recordings past their time, and those waiting for a transcript (decisions 22 and 23), in the
 * clients' order. Clients are read a few at a time: one after another, the list waited on two requests per client
 * before it showed anything.
 */
export async function listAll(companies: CompanySummary[], at = now()): Promise<{ due: Listed[]; waiting: Listed[] }> {
  const found: (Listed[][] | null)[] = new Array(companies.length).fill(null);
  let next = 0;
  const reader = async () => {
    while (next < companies.length) {
      const i = next++;
      found[i] = await listOne(companies[i], at);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, companies.length) }, reader));
  const due: Listed[] = [];
  const waiting: Listed[] = [];
  for (const lists of found) {
    if (!lists) continue;
    due.push(...lists[0]);
    waiting.push(...lists[1]);
  }
  return { due, waiting };
}

/** One client's recordings past their time and waiting, or null if it can't be read. */
async function listOne(c: CompanySummary, at: string): Promise<Listed[][] | null> {
  if (c.access === 'unreadable' || !c.name) return null;
  let ws: CompanyWorkspace;
  try {
    ws = (await openCompany(c.id)).workspace;
  } catch {
    return null;
  }
  // A transcript ready but not added keeps its recordings waiting "for adding" rather than "for a transcript".
  const jobs = await listTranscriptions(c.id).catch(() => []);
  const ready = new Set(jobs.filter((j) => j.state === 'done').flatMap((j) => j.recordingIds));
  // A damaged file may not read as the model expects: that client is left out rather than hiding everyone else's.
  const found: Listed[][] = [[], []];
  try {
    const { due: d, waiting: w } = recordingsPastTime(ws, at, ready);
    for (const entry of [...d.map((x) => ({ ...x, list: 0 })), ...w.map((x) => ({ ...x, list: 1 }))]) {
      const session = get(ws.sessions, entry.sessionId);
      const file = get(ws.files, entry.fileId) as Recording | undefined;
      if (!session || !file) continue;
      found[entry.list].push({
        companyId: c.id,
        companyName: c.name,
        engagementId: session.engagementId,
        sessionId: session.id,
        sessionTitle: session.title,
        recording: file,
        line: retentionText(retentionOf(ws, file, at, ready), session.timeZone),
        reason: 'why' in entry ? deletionReasonFor(entry.why) : null,
        readOnly: c.access === 'read-only',
      });
    }
  } catch {
    return null;
  }
  return found;
}

/**
 * Shown on the clients list each time StyleCode opens, until they're gone
 * (decision 23): every client's recordings past the time the client agreed,
 * with one action that deletes them all, and, apart, those under "deleted
 * after transcription" still waiting a day on (decision 22). StyleCode never
 * deletes a recording on its own.
 */
export function PastTimeCard({ companies }: { companies: CompanySummary[] }) {
  const [listed, setListed] = useState<{ due: Listed[]; waiting: Listed[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const consultant = useConsultant();
  const [name, setName] = useState('');

  const load = useCallback(() => {
    let current = true;
    void listAll(companies).then((l) => current && setListed(l));
    return () => {
      current = false;
    };
  }, [companies]);
  useEffect(load, [load]);

  if (!listed || (!listed.due.length && !listed.waiting.length && !done)) return null;
  const { due, waiting } = listed;
  // A read-only client's recordings are listed, but its file has to be put right before anything of it is deleted.
  const deletable = due.filter((d) => !d.readOnly);
  const href = (l: Listed) =>
    routeHref({ page: 'session', companyId: l.companyId, engagementId: l.engagementId, sessionId: l.sessionId });

  const row = (l: Listed) => (
    <li key={l.recording.id} className="ws-row is-static">
      <span className="ws-row-main">
        <span className="ws-row-title">
          {l.companyName} · {l.sessionTitle} · {l.recording.name}
        </span>
        <span className="ws-row-sub">
          {formatLength(l.recording.audio.durationMs)} · <span className="ws-caution">{l.line}.</span>
          {l.readOnly && ' This client opens read-only: put its file right before deleting.'}
        </span>
      </span>
      <a className="button" href={href(l)} aria-label={`Open the session ${l.sessionTitle} (${l.companyName})`}>
        Open the session
      </a>
    </li>
  );

  return (
    <section className="ws-card ws-past-time" aria-labelledby="past-time-title">
      <div className="ws-card-head">
        <h2 id="past-time-title">
          <Icon name="warning" size={14} /> Recordings to deal with
        </h2>
      </div>
      {done && <p role="status">{done}</p>}
      {due.length > 0 && (
        <>
          <h3 id="past-time-due">{count(due.length, 'recording')} past the time the client agreed</h3>
          <p className="ws-help">
            StyleCode never deletes a recording on its own. Deleting keeps a line in each session saying when it was recorded, how
            long it was, and when, by whom and why it was deleted.
          </p>
          <ul className="ws-list is-compact" aria-labelledby="past-time-due">
            {due.map(row)}
          </ul>
          {deletable.length > 0 && (
            <div className="ws-actions">
              <button type="button" className="button danger" onClick={() => setDeleting(true)}>
                Delete {deletable.length === 1 ? 'this recording' : `these ${deletable.length} recordings`}…
              </button>
            </div>
          )}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <h3 id="past-time-waiting">{count(waiting.length, 'recording')} waiting for a transcript</h3>
          <p className="ws-help">
            The client was told these are deleted once transcribed, and each was made a day or more ago. Transcribe each one, or
            add its transcript, on the session’s page, or delete it there.
          </p>
          <ul className="ws-list is-compact" aria-labelledby="past-time-waiting">
            {waiting.map(row)}
          </ul>
        </>
      )}
      {deleting && (
        <DeleteDialog
          title={deletable.length === 1 ? 'Delete the recording past its time…' : 'Delete the recordings past their time…'}
          onClose={() => setDeleting(false)}
          what={
            <>
              <p>
                This deletes {deletable.length === 1 ? 'the recording' : `the ${deletable.length} recordings`} listed as past the
                time the client agreed, from {count(new Set(deletable.map((d) => d.companyId)).size, 'client')}. Each session
                keeps a line for each, but no sound.
              </p>
              <p>
                <strong>This can’t be undone,</strong> and each client’s undo history is cleared.
              </p>
              <NameField consultant={consultant} value={name} onChange={setName} />
            </>
          }
          onDelete={async () => {
            const by = await nameFor(consultant, name);
            if (!by) throw new Error('Give your name: deleting a recording records who did it.');
            stopPlaying(deletable.map((d) => d.recording.id));
            let deleted = 0;
            const failed: string[] = [];
            // Client by client: one that can't be changed doesn't stop the others.
            for (const companyId of new Set(deletable.map((d) => d.companyId))) {
              const listedHere = deletable.filter((d) => d.companyId === companyId);
              const held = await reopenHeld(companyId);
              if (!held) continue;
              try {
                const at = now();
                // Only what is still there and still past its time, as the client stands now.
                const stillDue = (ws: CompanyWorkspace, id: string) => {
                  const file = get(ws.files, id) as Recording | undefined;
                  return file?.audio ? retentionOf(ws, file, at).due : null;
                };
                const mine = listedHere.filter((d) => stillDue(held.session.getState().workspace, d.recording.id) !== null);
                if (!mine.length) continue;
                await permanentStep(held.session, `Delete ${count(mine.length, 'recording')} past their time`, (ws) => {
                  let next = ws;
                  for (const d of mine) {
                    const why = stillDue(next, d.recording.id);
                    const removed = removeRecordings(next, [d.recording.id], why ? deletionReasonFor(why) : 'retention', by, at);
                    if (!removed.ok) return removed;
                    next = removed.value;
                  }
                  return { ok: true, value: next };
                });
                deleted += mine.length;
              } catch {
                failed.push(listedHere[0].companyName);
              } finally {
                held.letGo();
              }
            }
            setDeleting(false);
            setDone(
              `${count(deleted, 'recording')} deleted. Each session keeps its line.${
                failed.length ? ` Nothing could be deleted for ${failed.join(', ')}: open the client to see why.` : ''
              }`,
            );
            load();
          }}
        />
      )}
    </section>
  );
}
