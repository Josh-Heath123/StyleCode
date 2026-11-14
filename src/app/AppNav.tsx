import { Icon } from '../ui/Icon';
import { useRuns, type Run } from '../workspace/ui/extraction/runs';
import { dismissRecording, isRecordingNow, stopRecording, useRecording } from '../workspace/recording/recorder';
import { formatClock, LevelMeter, STOP_KEY } from '../workspace/ui/RecordingsCard';

/**
 * Top-level navigation between the consulting workspace and the design
 * editor (Phase 1 brief, decision 4). Where the workspace server isn't
 * running, there is no Clients link: one line says what it needs instead.
 */
export function AppNav({
  current,
  workspaceHref,
}: {
  current: 'workspace' | 'editor';
  /** Where "Clients" leads (the last workspace page), or null when the workspace isn't available. */
  workspaceHref: string | null;
}) {
  return (
    <nav className="app-nav" aria-label="StyleCode">
      {workspaceHref !== null && (
        <a className="app-nav-link" href={workspaceHref} aria-current={current === 'workspace' ? 'page' : undefined}>
          <Icon name="people" size={14} /> Clients
        </a>
      )}
      <a className="app-nav-link" href="#/editor" aria-current={current === 'editor' ? 'page' : undefined}>
        <Icon name="frame" size={14} /> Design editor
      </a>
      <RecordingNow />
      <AiRuns />
      {workspaceHref === null && (
        <span className="app-nav-note">Client work needs StyleCode running on your computer (npm start).</span>
      )}
    </nav>
  );
}

/**
 * The recording going, on every page (Phase 3 brief, decision 13): its
 * session, time and level, and Stop, one click away (or Alt+S from
 * anywhere). If it stopped by itself, why, until the consultant has seen it.
 */
function RecordingNow() {
  const recording = useRecording();
  if (!recording) return null;
  if (!isRecordingNow(recording)) {
    if (!recording.message) return null;
    return (
      <span className="app-nav-recording is-ended" role="status">
        <a className="app-nav-link" href={recording.href}>
          The recording of “{recording.sessionTitle}” stopped
        </a>
        <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissRecording}>
          <Icon name="x" size={13} />
        </button>
      </span>
    );
  }
  return (
    <span className="app-nav-recording" role="group" aria-label="Recording">
      <a className="app-nav-link" href={recording.href}>
        <span className="ws-live-dot" aria-hidden="true" /> Recording “{recording.sessionTitle}”{' '}
        <span className="app-nav-clock">{formatClock(recording.elapsedMs)}</span>
      </a>
      <LevelMeter level={recording.level} compact />
      <button
        type="button"
        className="button stop-button is-small"
        disabled={recording.state === 'stopping'}
        onClick={() => void stopRecording()}
        aria-keyshortcuts="Alt+S"
        data-tip={`Stop recording (${STOP_KEY})`}
      >
        <Icon name="stop" size={12} /> Stop
      </button>
    </span>
  );
}

/** What the AI is reading, or has finished, so the consultant can work elsewhere meanwhile (Phase 2, WP7). */
function AiRuns() {
  const runs = useRuns();
  return (
    <>
      {runs.map((run) => (
        <a key={`${run.companyId}/${run.sessionId}`} className="app-nav-link app-nav-run" href={run.href}>
          <Icon name="sparkle" size={14} /> {runText(run)}
        </a>
      ))}
    </>
  );
}

function runText(run: Run): string {
  const title = `“${run.sessionTitle}”`;
  if (run.state === 'running')
    return run.parts > 1 ? `The AI is reading ${title}: part ${run.part} of ${run.parts}` : `The AI is reading ${title}`;
  if (run.state === 'finished' && !run.error) return `The AI has finished ${title}`;
  return run.state === 'stopped' ? `The AI stopped on ${title}` : `The AI couldn’t finish ${title}`;
}
