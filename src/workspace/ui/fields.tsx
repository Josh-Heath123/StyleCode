import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { useDialogFocus } from '../../ui/useDialogFocus';
import type { Consultant } from './useConsultant';

/** What a commit returns: null when it was applied, or why it wasn't. */
export type CommitResult = string | null | Promise<string | null>;

/**
 * A text field that applies what was typed as one undoable step when it is
 * left or Enter is pressed (Escape puts it back). When the client is
 * read-only it is plain text, so it looks like nothing can be changed.
 */
export function TextField({
  label,
  value,
  readOnly,
  multiline,
  type = 'text',
  empty = 'Not given',
  display,
  help,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  multiline?: boolean;
  type?: 'text' | 'date' | 'datetime-local';
  /** Shown in read-only mode when there is no value. */
  empty?: string;
  /** How the value reads as plain text, when that differs from what is typed. */
  display?: string;
  /** A line under the field, read with it: what changing it does. */
  help?: string;
  onCommit: (value: string) => CommitResult;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Undo and redo change the value from outside.
  useEffect(() => setDraft(value), [value]);

  if (readOnly) {
    return (
      <div className="ws-field">
        <span className="ws-label">{label}</span>
        <p className={`ws-value${value ? '' : ' is-empty'}`}>{value ? (display ?? value) : empty}</p>
      </div>
    );
  }

  const commit = async () => {
    if (draft === value) return setError(null);
    const problem = await onCommit(draft);
    setError(problem);
  };
  const revert = () => {
    setDraft(value);
    setError(null);
  };
  const common = {
    id,
    className: 'ws-input',
    value: draft,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined,
    onBlur: () => void commit(),
  };
  return (
    <div className="ws-field">
      <label className="ws-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && revert()}
        />
      ) : (
        <input
          {...common}
          type={type}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') revert();
          }}
        />
      )}
      {help && (
        <p className="ws-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className="ws-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled input inside a dialog's form. */
export function DialogField({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="ws-field">
      <label className="ws-label" htmlFor={id}>
        {label} {optional && <span className="ws-optional">(optional)</span>}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * A dialog with a form: Tab stays inside, Escape closes it, and focus goes
 * back to what opened it. The first field gets focus once the dialog has
 * noted what that was.
 */
export function FormDialog({
  title,
  submitLabel,
  danger,
  submitDisabled,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  submitDisabled?: boolean;
  error: string | null;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  useDialogFocus(dialogRef);
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('.ws-dialog-body input, .ws-dialog-body textarea');
    (first ?? dialogRef.current?.querySelector<HTMLElement>('.ws-dialog-foot .button'))?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      // The dialog may be gone by now; setting state on it is harmless.
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialogRef}
        className="dialog glass ws-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          <span id={titleId}>{title}</span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="ws-dialog-body">
          {children}
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ws-dialog-foot">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`button ${danger ? 'danger-fill' : 'primary'}`} disabled={busy || submitDisabled}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Confirms a deletion that can't be undone (MVP Q6): names what goes, says it
 * can't be undone, and, for a client, needs its name typed first.
 */
export function DeleteDialog({
  title,
  what,
  typeToConfirm,
  onDelete,
  onClose,
}: {
  title: string;
  /** What will be deleted, and that it can't be undone. */
  what: ReactNode;
  /** The name to type before the delete button works, if any. */
  typeToConfirm?: string;
  onDelete: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title={title}
      submitLabel={title.replace(/…$/, '')}
      danger
      submitDisabled={typeToConfirm !== undefined && typed !== typeToConfirm}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        try {
          await onDelete();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="ws-delete-what">{what}</div>
      {typeToConfirm !== undefined && (
        <DialogField label={`Type ${typeToConfirm} to confirm`}>
          {(id) => (
            <input
              id={id}
              className="ws-input"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </DialogField>
      )}
    </FormDialog>
  );
}

/** Asks for the consultant's name, only while settings don't have it yet. */
export function NameField({
  consultant,
  value,
  onChange,
}: {
  consultant: Consultant;
  value: string;
  onChange: (v: string) => void;
}) {
  if (consultant.name !== null) return null;
  return (
    <DialogField label="Your name (kept in settings)">
      {(id) => <input id={id} className="ws-input" value={value} onChange={(e) => onChange(e.target.value)} />}
    </DialogField>
  );
}

/** The consultant's name: from settings, or as typed, which is then kept in settings. */
export async function nameFor(consultant: Consultant, typed: string): Promise<string | null> {
  const known = await consultant.current();
  if (known) return known;
  if (!typed.trim()) return null;
  return consultant.save(typed);
}
