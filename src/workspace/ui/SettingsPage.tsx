import { useEffect, useState, type FormEvent } from 'react';
import { getSettings, saveSettings } from '../api';
import { Page, useWorkspaceInfo, WorkspaceHeader } from './chrome';

/** The consultant's name, and the data folder in use (Phase 1 brief, WP5). */
export function SettingsPage() {
  const info = useWorkspaceInfo();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);

  useEffect(() => {
    // A load that arrives after the page closed (or after React's development double run) is ignored,
    // so it can't overwrite what is being typed.
    let current = true;
    getSettings().then(
      (s) => {
        if (!current) return;
        setSaved(s.consultantName);
        setName(s.consultantName ?? '');
      },
      (e: Error) => current && setMessage({ text: e.message, tone: 'error' }),
    );
    return () => {
      current = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const s = await saveSettings({ consultantName: name.trim() || null });
      setSaved(s.consultantName);
      setName(s.consultantName ?? '');
      setMessage({ text: 'Your name is saved.', tone: 'info' });
    } catch (failure) {
      setMessage({ text: (failure as Error).message, tone: 'error' });
    }
  };

  return (
    <>
      <WorkspaceHeader />
      <Page title="Settings">
        <div className="ws-columns">
          <form className="ws-card" aria-labelledby="you-title" onSubmit={(e) => void submit(e)}>
            <h2 id="you-title">You</h2>
            <div className="ws-field">
              <label className="ws-label" htmlFor="consultant-name">
                Your name
              </label>
              <input
                id="consultant-name"
                className="ws-input"
                value={name}
                disabled={saved === undefined}
                aria-describedby="consultant-name-help"
                onChange={(e) => {
                  setName(e.target.value);
                  setMessage(null);
                }}
              />
              <p className="ws-help" id="consultant-name-help">
                Recorded with what you do for a client: who asked for consent, who added a file or a finding.
              </p>
            </div>
            <div className="ws-actions">
              <button type="submit" className="button primary" disabled={saved === undefined || name.trim() === (saved ?? '')}>
                Save
              </button>
              <span className={message?.tone === 'error' ? 'ws-error' : 'ws-muted'} role="status">
                {message?.text}
              </span>
            </div>
          </form>

          <section className="ws-card" aria-labelledby="folder-title">
            <h2 id="folder-title">Where client data is kept</h2>
            <p className="ws-path">{info.folder}</p>
            <p className="ws-help">
              One folder per client, inside <code>companies</code>. To back up, copy the whole folder. To use another folder, set{' '}
              <code>STYLECODE_WORKSPACE</code> before running <code>npm start</code>.
            </p>
            {info.mode === 'development' && (
              <p className="ws-help">This is the development folder, used by npm run dev. It never holds your real clients.</p>
            )}
            {info.cloudService && (
              <div className="ws-alert" role="note">
                <p>
                  <strong>This folder is inside {info.cloudService}.</strong> Everything in it, including clients’ meeting notes
                  and consent records, is copied to {info.cloudService}’s servers. Unless your clients agreed to that, move the
                  folder somewhere {info.cloudService} doesn’t sync and set <code>STYLECODE_WORKSPACE</code> to it. This warning
                  stays until the folder moves.
                </p>
              </div>
            )}
          </section>
        </div>
      </Page>
    </>
  );
}
