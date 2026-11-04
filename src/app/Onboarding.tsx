import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { STEPS, type Onboarding } from './onboarding';
import { useDialogFocus } from '../ui/useDialogFocus';

export function useOnboardingState(onboarding: Onboarding) {
  return useSyncExternalStore(onboarding.subscribe, onboarding.getState, onboarding.getState);
}

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'frame', title: 'Draw it', text: 'Frames, shapes, text and images. Each top-level frame is a page.' },
  { icon: 'grid', title: 'Tidy it', text: 'Shift+A turns a rough sketch into rows, columns and grids that adapt to phones.' },
  { icon: 'sparkle', title: 'Ask the AI', text: 'Select something and describe a change. It edits the design, never the code.' },
  { icon: 'code', title: 'Export real code', text: 'HTML and CSS, or a React app, that look exactly like the canvas.' },
];

/** The first thing a new visitor sees: what StyleCode is, and a way in. */
export function WelcomeDialog({
  onboarding,
  onOpenExample,
}: {
  onboarding: Onboarding;
  onOpenExample: () => Promise<void> | void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  return (
    <div className="dialog-backdrop welcome-backdrop">
      <div
        ref={ref}
        className="dialog glass welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onboarding.finishWelcome(true);
        }}
      >
        <div className="welcome-body">
          <svg className="welcome-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="5" y="5" width="15" height="15" rx="3" fill="none" stroke="#2F7BFF" strokeWidth="2.6" />
            <circle cx="21.5" cy="21.5" r="6" fill="#FFA05C" />
          </svg>
          <h1 id="welcome-title">Welcome to StyleCode</h1>
          <p className="welcome-lead">
            Draw an interface, turn it into a real layout and export the code. Your work stays on this computer.
          </p>
          <ul className="welcome-points">
            {POINTS.map((p) => (
              <li key={p.title}>
                <span className="welcome-icon">
                  <Icon name={p.icon} size={16} />
                </span>
                <span>
                  <strong>{p.title}</strong>
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="dialog-foot">
          <button type="button" className="button" onClick={() => onboarding.finishWelcome(true)}>
            Start with a blank canvas
          </button>
          <button
            ref={start}
            type="button"
            className="button primary"
            onClick={async () => {
              onboarding.finishWelcome(true);
              await onOpenExample();
            }}
          >
            Open the example project
          </button>
        </div>
      </div>
    </div>
  );
}

/** A short list of things to try, ticked off as you do them. */
export function Checklist({ onboarding }: { onboarding: Onboarding }) {
  const { checklistOpen, done } = useOnboardingState(onboarding);
  if (!checklistOpen) return null;
  const count = STEPS.filter((s) => done[s.id]).length;
  const next = STEPS.find((s) => !done[s.id]);
  return (
    <section className="checklist glass" aria-label="Getting started">
      <header className="checklist-head">
        <span>
          Getting started <span className="checklist-count">{`${count} of ${STEPS.length}`}</span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide getting started"
          data-tip="Hide (Help menu brings it back)"
          data-tip-side="left"
          onClick={() => onboarding.setChecklistOpen(false)}
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="checklist-bar" aria-hidden="true">
        <span style={{ width: `${(count / STEPS.length) * 100}%` }} />
      </div>
      {next ? (
        <ol className="checklist-steps">
          {STEPS.map((step) => (
            <li key={step.id} className={done[step.id] ? 'is-done' : step === next ? 'is-next' : ''}>
              <span className="checklist-check" aria-hidden="true">
                {done[step.id] && <Icon name="check" size={11} strokeWidth={2.5} />}
              </span>
              <span>
                <span className="checklist-title">
                  {step.title}
                  <span className="visually-hidden">{done[step.id] ? ' (done)' : ''}</span>
                </span>
                {step === next && <span className="checklist-hint">{step.hint}</span>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="checklist-done">
          That’s everything. Press <kbd>?</kbd> any time for the keyboard shortcuts.
        </p>
      )}
    </section>
  );
}
