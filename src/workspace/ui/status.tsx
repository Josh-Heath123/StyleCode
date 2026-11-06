import { useEffect, useId, useState } from 'react';
import type { EngagementStatus } from '../model/types';
import { formatDay } from './chrome';

/** An engagement's status as text: "Active", or "Ended 30 Sept 2026". */
export function statusText(status: EngagementStatus): string {
  return status.state === 'active' ? 'Active' : `Ended ${formatDay(status.endedOn)}`;
}

/**
 * An engagement's status (MVP Q5): active, or ended on a date. Choosing
 * "Ended" fills in today, which can be changed. Each change is applied as it
 * is made; `onChange` returns why it was refused, if it was.
 */
export function StatusField({
  status,
  readOnly,
  defaultEnd,
  onChange,
}: {
  status: EngagementStatus;
  readOnly?: boolean;
  defaultEnd: string;
  onChange: (status: EngagementStatus) => string | null;
}) {
  const name = useId();
  const [date, setDate] = useState(status.state === 'ended' ? status.endedOn : defaultEnd);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status.state === 'ended') setDate(status.endedOn);
  }, [status]);

  if (readOnly) {
    return (
      <div className="ws-field">
        <span className="ws-label">Status</span>
        <p className="ws-value">{statusText(status)}</p>
      </div>
    );
  }
  const change = (next: EngagementStatus) => setError(onChange(next));
  return (
    <fieldset className="ws-field ws-fieldset">
      <legend className="ws-label">Status</legend>
      <label className="ws-choice">
        <input type="radio" name={name} checked={status.state === 'active'} onChange={() => change({ state: 'active' })} />
        Active
      </label>
      <div className="ws-choice">
        <label className="ws-choice">
          <input
            type="radio"
            name={name}
            checked={status.state === 'ended'}
            onChange={() => change({ state: 'ended', endedOn: date })}
          />
          Ended on
        </label>
        <input
          type="date"
          className="ws-input ws-date"
          aria-label="Date it ended"
          value={date}
          disabled={status.state !== 'ended'}
          onChange={(e) => {
            setDate(e.target.value);
            if (e.target.value) change({ state: 'ended', endedOn: e.target.value });
          }}
        />
      </div>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
