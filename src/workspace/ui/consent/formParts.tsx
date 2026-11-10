import { useId, type ReactNode } from 'react';
import type { ConsentFormValues, FormIssue } from '../../model/consentForm';
import type { ConsentGiven, ConsentStatement } from '../../model/types';

/** Pieces the consent form and the Amend… form share. */

export const STATEMENTS: ConsentStatement[] = [
  'recorded',
  'transcribed',
  'aiExtraction',
  'processingLocal',
  'processingExternal',
  'retention',
  'canStopOrDelete',
];

export function Issues({ issues }: { issues: FormIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="ws-issues">
      {issues.map((i, n) => (
        <li key={n}>{i.message}</li>
      ))}
    </ul>
  );
}

export function Section({ title, issues, children }: { title: string; issues: FormIssue[]; children: ReactNode }) {
  const id = useId();
  return (
    <fieldset className="ws-card ws-form-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
      <Issues issues={issues} />
    </fieldset>
  );
}

export function Choice<T extends string>({
  title,
  value,
  options,
  issues,
  onChange,
  children,
}: {
  title: string;
  value: T;
  options: [T, string][];
  issues: FormIssue[];
  onChange: (value: T) => void;
  children?: ReactNode;
}) {
  const name = useId();
  return (
    <Section title={title} issues={issues}>
      <div className="ws-choices">
        {options.map(([v, label]) => (
          <label key={v} className="ws-choice">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
      {children}
    </Section>
  );
}

/** One yes-or-no answer, with C2 shown next to it when it is "yes" and the client wasn't told. */
export function YesNo({
  label,
  answer,
  provider,
  values,
  update,
  issues,
}: {
  label: string;
  answer: Exclude<keyof ConsentGiven, 'externalProvider'>;
  provider?: string;
  values: Pick<ConsentFormValues, 'given' | 'outcome'>;
  update: (changes: Pick<ConsentFormValues, 'given'>) => void;
  issues: FormIssue[];
}) {
  const name = useId();
  const issueId = `${name}-issues`;
  const declined = values.outcome.kind === 'declined';
  const set = (yes: boolean) =>
    update({
      given: {
        ...values.given,
        [answer]: yes,
        ...(answer === 'aiExternal' && { externalProvider: yes ? (provider ?? null) : null }),
      },
    });
  return (
    <fieldset className="ws-yesno" aria-describedby={issues.length ? issueId : undefined}>
      <legend>{label}</legend>
      <label className="ws-choice">
        <input type="radio" name={name} checked={values.given[answer]} disabled={declined} onChange={() => set(true)} />
        Yes
      </label>
      <label className="ws-choice">
        <input type="radio" name={name} checked={!values.given[answer]} disabled={declined} onChange={() => set(false)} />
        No
      </label>
      {issues.length > 0 && (
        <p className="ws-c2" id={issueId}>
          {issues.map((i) => i.message).join(' ')}
        </p>
      )}
    </fieldset>
  );
}
