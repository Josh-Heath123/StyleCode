import { useEffect, useRef, useState, type ReactNode } from 'react';
import { normalizeHexColor } from '../model/properties';
import { Icon, type IconName } from '../ui/Icon';

export type Phase = 'preview' | 'commit';
export const MIXED = Symbol('mixed');
export type Mixed<T> = T | typeof MIXED;

function format(value: number, precision: number): string {
  const factor = 10 ** precision;
  return String(Math.round(value * factor) / factor);
}

/** Evaluates simple arithmetic typed into a number field ("120+16", "1440/3"). */
export function evaluateNumber(input: string): number | null {
  const text = input.trim().replace(/,/g, '.');
  if (!text) return null;
  if (!/^[\d.+\-*/()\s]+$/.test(text)) return null;
  const tokens = text.match(/\d*\.?\d+|[+\-*/()]/g);
  if (!tokens) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const factor = (): number => {
    const t = next();
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') {
      const v = expr();
      if (next() !== ')') throw new Error('paren');
      return v;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error('number');
    return n;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = next() === '*' ? v * factor() : v / factor();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  };
  try {
    const v = expr();
    return i === tokens.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

interface NumberFieldProps {
  label: ReactNode;
  /** Accessible name; also the tooltip. */
  name: string;
  value: Mixed<number>;
  onChange: (value: number, phase: Phase) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  /** Shown value = stored value × scale (e.g. opacity 0–1 shown as 0–100). */
  scale?: number;
  suffix?: string;
  disabled?: boolean;
}

/**
 * A compact number input. Drag its label to scrub, use arrow keys to step
 * (Shift for ×10), or type a value or a small sum.
 */
export function NumberField({
  label,
  name,
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  precision = 2,
  scale = 1,
  suffix,
  disabled,
}: NumberFieldProps) {
  const shown = value === MIXED ? '' : format(value * scale, precision);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set when Enter or Escape has already handled the edit, so the blur that follows does nothing.
  const handled = useRef(false);

  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const emit = (displayValue: number, phase: Phase) => onChange(clamp(displayValue) / scale, phase);

  const commitText = () => {
    // Leaving a field untouched must not round the stored value or add an undo step.
    if (text === shown) return;
    const v = evaluateNumber(text);
    if (v === null) setText(shown);
    else if (value === MIXED || Math.abs(v - value * scale) > 1e-9) emit(v, 'commit');
  };

  const onLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startValue = value === MIXED ? 0 : value * scale;
    let moved = false;
    let last = startValue;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      // Alt scrubs in finer steps, Shift in coarser ones.
      const unit = ev.altKey ? step / 10 : step;
      const raw = startValue + dx * unit * (ev.shiftKey ? 10 : 1);
      last = clamp(Math.round(raw / unit) * unit);
      emit(last, 'preview');
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved) emit(last, 'commit');
      else inputRef.current?.focus();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div className="field" data-disabled={disabled || undefined}>
      <span className="field-label" onPointerDown={onLabelPointerDown} title={`${name} — drag to adjust`}>
        {label}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={name}
        value={focused ? text : shown}
        placeholder={value === MIXED ? 'Mixed' : undefined}
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true);
          setText(shown);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          if (handled.current) handled.current = false;
          else commitText();
          setFocused(false);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            handled.current = true;
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            handled.current = true;
            setText(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = evaluateNumber(text) ?? (value === MIXED ? 0 : value * scale);
            const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(format(next, precision));
            emit(next, 'commit');
          }
        }}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </div>
  );
}

interface ColorFieldProps {
  name: string;
  value: Mixed<string>;
  onChange: (value: string, phase: Phase) => void;
}

function splitColor(hex: string): { rgb: string; alpha: number } {
  const rgb = hex.slice(0, 7);
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return { rgb, alpha };
}

function joinColor(rgb: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a >= 255 ? rgb : `${rgb}${a.toString(16).padStart(2, '0')}`;
}

/** Colour swatch (opens the system picker), hex input and opacity. */
export function ColorField({ name, value, onChange }: ColorFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const alphaRef = useRef(1);
  const mixed = value === MIXED;
  const { rgb, alpha } = mixed ? { rgb: '#000000', alpha: 1 } : splitColor(value);
  const [text, setText] = useState(mixed ? '' : rgb.slice(1).toUpperCase());
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const shownHex = mixed ? '' : rgb.slice(1).toUpperCase();

  alphaRef.current = alpha;

  useEffect(() => {
    if (!focused) setText(mixed ? '' : rgb.slice(1).toUpperCase());
  }, [rgb, mixed, focused]);

  // The native "change" event fires when the system picker closes: that ends the edit.
  useEffect(() => {
    const el = pickerRef.current!;
    const onCommit = () => onChangeRef.current(joinColor(el.value, alphaRef.current), 'commit');
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, []);

  const commitHex = () => {
    if (text === shownHex) return;
    const hex = normalizeHexColor(text.startsWith('#') ? text : `#${text}`);
    if (!hex) return setText(mixed ? '' : rgb.slice(1).toUpperCase());
    const next = joinColor(hex.slice(0, 7), hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : alpha);
    if (next !== value) onChange(next, 'commit');
  };

  return (
    <div className="row">
      <div className="field color-field">
        <span className="swatch">
          <span className="swatch-color" style={{ background: mixed ? 'transparent' : value }} />
          <input
            ref={pickerRef}
            type="color"
            aria-label={`${name} picker`}
            value={rgb}
            onChange={(e) => onChange(joinColor(e.target.value, alpha), 'preview')}
          />
        </span>
        <input
          type="text"
          aria-label={`${name} hex value`}
          value={text}
          placeholder={mixed ? 'Mixed' : undefined}
          spellCheck={false}
          onFocus={(e) => {
            setFocused(true);
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => {
            if (cancelled.current) cancelled.current = false;
            else commitHex();
            setFocused(false);
          }}
          onChange={(e) => setText(e.target.value.replace(/[^0-9a-fA-F#]/g, '').slice(0, 9))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              cancelled.current = true;
              setText(shownHex);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <div className="alpha-field">
        <NumberField
          label={<Icon name="opacity" size={12} />}
          name={`${name} opacity`}
          value={mixed ? MIXED : alpha}
          scale={100}
          precision={0}
          min={0}
          max={100}
          suffix="%"
          onChange={(a, phase) => onChange(joinColor(rgb, a), phase)}
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: Mixed<T>;
  options: { value: T; icon: IconName; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="icon-button"
          aria-pressed={value === o.value}
          aria-label={o.label}
          data-tip={o.label}
          onClick={() => onChange(o.value)}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

export function SelectField<T extends string | number>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: Mixed<T>;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const current = value === MIXED ? '__mixed' : String(value);
  return (
    <select
      className="select"
      aria-label={name}
      value={current}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
    >
      {value === MIXED && <option value="__mixed">Mixed</option>}
      {value !== MIXED && !options.some((o) => o.value === value) && <option value={String(value)}>{String(value)}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
