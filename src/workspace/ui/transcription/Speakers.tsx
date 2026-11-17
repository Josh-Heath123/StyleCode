import { useRef } from 'react';
import { ALT_KEY } from '../../../app/actions';
import { Icon } from '../../../ui/Icon';
import { SHORT_LABEL_MS, type SpeakerTalk, type SpeakerWarning } from '../../model/recordings';
import type { Participant } from '../../model/types';
import { formatOffset } from '../../time';
import { formatLength } from '../RecordingsCard';
import { stopPlaying, togglePlaying, usePlaying } from './player';

const SIDE = { client: 'client', consultant: 'your side' } as const;

/** The key that pauses or resumes playing, as shown. */
export const PLAY_KEY = `${ALT_KEY}+P`;

/** "Speaker 1, Speaker 4 and Speaker 6". */
export function listOf(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "26 short labels, 2 min 28 s in all". */
export const shortSummary = (count: number, ms: number) =>
  `${count} short ${count === 1 ? 'label' : 'labels'}, ${formatLength(ms)} in all`;

/** Who a label is: a choice of the session's participants. */
function MatchSelect({
  label,
  people,
  value,
  disabled,
  onChange,
}: {
  label: string;
  people: readonly Participant[];
  value: string | null;
  disabled: boolean;
  onChange: (participantId: string | null) => void;
}) {
  return (
    <select
      className="ws-input"
      aria-label={`Who “${label}” is`}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Not matched</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({SIDE[p.side]})
        </option>
      ))}
    </select>
  );
}

/**
 * The speakers of a transcript made on this computer (decision 20, as changed
 * at the WP3 check-ins): sorted by talk time, each with its time; labels under
 * 30 seconds in one group under a summary, each with its own words so it can
 * be matched by reading. Used in the preview, before adding, and in the
 * transcript.
 */
export function SpeakerList({
  talk,
  wordsOf,
  people,
  matchOf,
  onMatch,
  onPlay,
  readOnly,
  shortId,
}: {
  talk: readonly SpeakerTalk[];
  /** What a label said, in order. */
  wordsOf: (label: string) => string;
  people: readonly Participant[];
  matchOf: (label: string) => string | null;
  onMatch: (label: string, participantId: string | null) => void;
  /** Plays a label's longest part, while the recordings are there. */
  onPlay: ((talk: SpeakerTalk) => void) | null;
  readOnly: boolean;
  /** The short labels' group, for the warning to open. */
  shortId: string;
}) {
  const main = talk.filter((t) => t.ms >= SHORT_LABEL_MS);
  const short = talk.filter((t) => t.ms < SHORT_LABEL_MS);
  const play = (t: SpeakerTalk) =>
    onPlay && (
      <button
        type="button"
        className="icon-button"
        aria-label={`Play ${t.label}’s longest part`}
        data-tip="Play the longest part"
        data-tip-side="left"
        onClick={() => onPlay(t)}
      >
        <Icon name="play" size={13} />
      </button>
    );
  return (
    <div className="ws-speaker-list">
      {main.length > 0 && (
        <table className="ws-speaker-table">
          <thead>
            <tr>
              <th scope="col">Speaker</th>
              <th scope="col">Talk time</th>
              <th scope="col">Participant</th>
              {onPlay && (
                <th scope="col">
                  <span className="visually-hidden">Listen</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {main.map((t) => (
              <tr key={t.label}>
                <th scope="row">{t.label}</th>
                <td className="ws-muted">{formatLength(t.ms)}</td>
                <td>
                  <MatchSelect
                    label={t.label}
                    people={people}
                    value={matchOf(t.label)}
                    disabled={readOnly}
                    onChange={(p) => onMatch(t.label, p)}
                  />
                </td>
                {onPlay && <td>{play(t)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {short.length > 0 && (
        <details className="ws-short-labels" id={shortId}>
          <summary>
            {shortSummary(
              short.length,
              short.reduce((n, t) => n + t.ms, 0),
            )}
          </summary>
          <p className="ws-help">
            Each of these holds under 30 seconds: often a word or two, or one voice split in two. Read what each said to match it.
          </p>
          <ul>
            {short.map((t) => (
              <li key={t.label}>
                <div className="ws-short-head">
                  <span className="ws-short-label">{t.label}</span>
                  <span className="ws-muted">{formatLength(t.ms)}</span>
                  <MatchSelect
                    label={t.label}
                    people={people}
                    value={matchOf(t.label)}
                    disabled={readOnly}
                    onChange={(p) => onMatch(t.label, p)}
                  />
                  {play(t)}
                </div>
                <p className="ws-short-words">“{wordsOf(t.label)}”</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * C11 for a transcript made from recordings (decision 20): a machine's labels
 * name nobody, so it lists every label not yet matched to a client
 * participant who was asked, or to someone on the consultant's side, and
 * updates as labels are matched. Short labels are summed up, never dropped.
 */
export function RecordedSpeakerWarning({
  warning,
  shortId,
  adding,
}: {
  warning: Pick<SpeakerWarning, 'main' | 'short' | 'unnamedSpeakers'>;
  shortId: string;
  /** In the preview, before the transcript is added. */
  adding?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { main, short } = warning;
  if (!main.length && !short.labels.length && !warning.unnamedSpeakers) return null;
  const named = [...main, ...(short.labels.length ? [shortSummary(short.labels.length, short.ms)] : [])];
  const showShort = () => {
    const group = document.getElementById(shortId) as HTMLDetailsElement | null;
    if (!group) return;
    group.open = true;
    group.querySelector('summary')?.focus();
    group.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="ws-alert" role="note" aria-labelledby={`${shortId}-c11`} ref={ref}>
      <h2 id={`${shortId}-c11`}>
        {named.length ? `Not matched to anyone asked for consent: ${listOf(named)}` : 'Some speech has no speaker'}
      </h2>
      <p>
        {named.length
          ? `A transcribed speaker is only a label until you match it to a participant. ${
              adding ? 'You can match them now, or after adding.' : 'This warning updates as you match them.'
            } Before you use what an unmatched speaker said, check they agreed.`
          : ''}
        {warning.unnamedSpeakers ? ' Some speech has no speaker, so it can’t be checked.' : ''}
      </p>
      {short.labels.length > 0 && (
        <button type="button" className="button is-small" onClick={showShort}>
          Show the short labels
        </button>
      )}
    </div>
  );
}

/** What is playing, with pause (or Alt+P from anywhere) and stop. */
export function PlayerBar({ companyId, fileIds }: { companyId: string; fileIds: readonly string[] }) {
  const playing = usePlaying();
  if (!playing || playing.companyId !== companyId || !fileIds.includes(playing.fileId)) return null;
  const going = playing.state === 'playing';
  return (
    <div className="ws-player" role="group" aria-label="Playing the recording">
      <button
        type="button"
        className="button is-small"
        disabled={playing.state === 'loading' || playing.state === 'failed'}
        onClick={togglePlaying}
        aria-keyshortcuts="Alt+P"
      >
        <Icon name={going ? 'pause' : 'play'} size={12} /> {going ? 'Pause' : 'Play'} <kbd className="ws-kbd">{PLAY_KEY}</kbd>
      </button>
      <span className="ws-player-what">
        {playing.state === 'loading' ? `Loading the recording to play ${playing.what}…` : `Playing ${playing.what}`}
      </span>
      <span className="ws-player-clock" aria-label={`At ${formatOffset(playing.atMs)}`}>
        {formatOffset(playing.atMs)}
      </span>
      <button type="button" className="icon-button" aria-label="Stop playing" onClick={() => stopPlaying()}>
        <Icon name="x" size={13} />
      </button>
      {playing.message && (
        <p className="ws-error" role="alert">
          {playing.message}
        </p>
      )}
    </div>
  );
}
