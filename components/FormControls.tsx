import React from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  helperText?: string;
  helperTone?: 'default' | 'accent';
}

interface StepperNumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

function clampValue(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  helperText,
  helperTone = 'default',
}: SelectFieldProps<T>) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow-sm shadow-slate-950/20">
      <label className="mb-2 block text-[11px] font-medium tracking-wide text-slate-400">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full appearance-none rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2.5 pr-10 text-sm font-medium text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>
      {helperText ? (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-5 ${
            helperTone === 'accent'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-slate-700 bg-slate-800/60 text-slate-400'
          }`}
        >
          {helperText}
        </div>
      ) : null}
    </div>
  );
}

export function StepperNumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 0.1,
  unit = 'm',
}: StepperNumberFieldProps) {
  const updateValue = (next: number) => {
    if (Number.isNaN(next)) return;
    onChange(clampValue(Number(next.toFixed(2)), min, max));
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow-sm shadow-slate-950/20">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-slate-400">{label}</div>
          <div className="mt-1 text-lg font-semibold leading-none text-white">
            {Number.isFinite(value) ? value.toFixed(step < 1 ? 1 : 0) : min}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{unit}</span>
      </div>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] gap-2 sm:grid-cols-[44px_minmax(72px,1fr)_44px]">
        <button
          type="button"
          onClick={() => updateValue(value - step)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-950/70 text-slate-300 transition hover:border-slate-500 hover:text-white active:scale-95"
          aria-label={`减少${label}`}
        >
          <Minus size={14} />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode="decimal"
          value={Number.isFinite(value) ? value : min}
          onChange={(e) => updateValue(parseFloat(e.target.value))}
          className="min-w-[72px] w-full rounded-lg border border-slate-600 bg-slate-950/70 px-2 py-2.5 text-center text-base font-semibold text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="button"
          onClick={() => updateValue(value + step)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-950/70 text-slate-300 transition hover:border-slate-500 hover:text-white active:scale-95"
          aria-label={`增加${label}`}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
