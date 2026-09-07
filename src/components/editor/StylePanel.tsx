"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useEditor } from "@/context/EditorContext";
import { getPresetStyle } from "@/lib/presets";
import { loadGoogleFont } from "@/lib/canvasRenderer";
import type { CaptionStyle, PresetName } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────

const FONT_FAMILIES = [
  "Inter",
  "Montserrat",
  "Impact",
  "Bebas Neue",
  "Anton",
  "Oswald",
  "Poppins",
  "Roboto",
] as const;

const PRESET_PILLS: { value: PresetName; label: string }[] = [
  { value: "Reels", label: "Reels" },
  { value: "Clean", label: "Clean" },
  { value: "Bold Drop", label: "Bold" },
  { value: "Custom", label: "Custom" },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function hexForPicker(hex: string): string {
  let h = (hex || "").trim();
  if (!h) return "#ffffff";
  if (!h.startsWith("#")) h = `#${h}`;
  if (h.length === 9) h = h.slice(0, 7); // strip AA
  if (h.length === 4) {
    // #RGB -> #RRGGBB
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(h)) return h;
  return "#ffffff";
}

function isValidHex(input: string): boolean {
  const h = input.trim();
  return /^#?[0-9A-Fa-f]{3}$/.test(h) || /^#?[0-9A-Fa-f]{6}$/.test(h) || /^#?[0-9A-Fa-f]{8}$/.test(h);
}

// ── Props ────────────────────────────────────────────────────────────────

export interface StylePanelProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  hideHeader?: boolean;
}

// ── Subcomponents ───────────────────────────────────────────────────────

function Accordion({
  title,
  icon,
  defaultOpen = true,
  disabled = false,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--hairline-soft)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-3 text-left transition hover:bg-[var(--surface-strong)]/60 focus-visible:outline-none focus-visible:bg-[var(--surface-strong)]"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)] text-[11px] leading-none text-[var(--ink)]" aria-hidden>
            {icon}
          </span>
          <span className="text-[16px] font-[500] tracking-tight text-[var(--ink)]">{title}</span>
          {disabled && (
            <span className="rounded-full bg-[var(--surface-strong)] border border-[var(--hairline-soft)] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--muted)]">STATIC</span>
          )}
        </span>
        <span
          aria-hidden
          className={`flex h-6 w-6 items-center justify-center rounded-[6px] text-[10px] text-[var(--muted)] transition-transform ${open ? "rotate-180" : "rotate-0"}`}
        >
          ▼
        </span>
      </button>
      {open && (
        <div className={`${disabled ? "pointer-events-none opacity-40" : ""} space-y-4 px-3 pb-4 pt-1`}>{children}</div>
      )}
    </div>
  );
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  const cls = "text-[11px] font-medium tracking-wide text-[var(--muted)]";
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={cls}>
        {children}
      </label>
    );
  }
  return <span className={cls}>{children}</span>;
}

function Slider({
  id,
  name,
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  onCommit,
}: {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-[var(--ink)]">
          {label}
        </label>
        <span className="rounded-[6px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">{display ?? `${value}`}</span>
      </div>
      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={onCommit}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-strong)] accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
      />
      <div className="flex justify-between font-mono text-[10px] text-[var(--muted)]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  pickerId,
  hexId,
  pickerName,
  hexName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  pickerId: string;
  hexId: string;
  pickerName: string;
  hexName: string;
}) {
  const pickerVal = hexForPicker(value);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    // Sync draft when external value changes (e.g., preset load)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync of controlled draft with prop
    setDraft(value);
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={pickerId} className="w-[68px] shrink-0 text-xs text-[var(--ink)]">
        {label}
      </label>
      <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-[var(--hairline-strong)] shadow-sm">
        <div className="pointer-events-none absolute inset-0 rounded-full" style={{ background: value || "#ffffff" }} aria-hidden />
        <input
          id={pickerId}
          name={pickerName}
          type="color"
          value={pickerVal}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setDraft(next);
            onChange(next);
          }}
          aria-label={`${label} color picker`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <label htmlFor={hexId} className="sr-only">
        {label} hex
      </label>
      <input
        id={hexId}
        name={hexName}
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          // live update only if valid hex
          if (isValidHex(v)) {
            const normalized = v.startsWith("#") ? v.toUpperCase() : `#${v.toUpperCase()}`;
            // allow 3,6,8 length; just propagate
            if (normalized.length === 4 || normalized.length === 7 || normalized.length === 9) {
              onChange(normalized);
            }
          }
        }}
        onBlur={() => {
          // normalize on blur
          if (isValidHex(draft)) {
            const h = draft.startsWith("#") ? draft : `#${draft}`;
            const upper = h.toUpperCase();
            setDraft(upper);
            onChange(upper);
          } else {
            setDraft(value);
          }
        }}
        spellCheck={false}
        placeholder="#FFFFFF"
        aria-label={`${label} hex color`}
        className="h-7 min-w-0 flex-1 rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-2.5 font-mono text-xs uppercase tracking-wide text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30"
      />
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  equalWidth = true,
  name,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  equalWidth?: boolean;
  name?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-strong)] p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        const derivedName = name ?? (ariaLabel ? ariaLabel.toLowerCase().replace(/\s+/g, "-") : undefined);
        return (
          <button
            key={opt.value}
            type="button"
            name={derivedName}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            aria-label={opt.label}
            className={`${equalWidth ? "flex-1" : ""} rounded-[var(--radius-pill)] px-2 py-1.5 text-xs font-medium leading-none transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${active ? "bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-soft)]" : "text-[var(--ink)] hover:text-[var(--ink)] hover:bg-[var(--surface-card)]"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────

export default function StylePanel({ collapsed, onCollapsedChange, className, hideHeader = false }: StylePanelProps) {
  const { captionStyle, setCaptionStyle, settings, pushHistory } = useEditor();
  const mode = settings.mode;

  // Internal collapse fallback if not controlled
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = collapsed !== undefined && onCollapsedChange !== undefined;
  const isCollapsed = isControlled ? (collapsed as boolean) : internalCollapsed;
  const toggleCollapsed = useCallback(() => {
    if (isControlled) {
      onCollapsedChange?.(!collapsed);
    } else {
      setInternalCollapsed((v) => !v);
    }
  }, [isControlled, collapsed, onCollapsedChange]);

  // Load font on mount / change
  useEffect(() => {
    if (captionStyle.fontFamily) loadGoogleFont(captionStyle.fontFamily);
  }, [captionStyle.fontFamily]);

  // Helper — pushes history for discrete changes (UI-10 fix: sliders use no-history live update)
  const updateStyle = useCallback(
    (patch: Partial<CaptionStyle>) => {
      if (!patch || Object.keys(patch).length === 0) return;
      pushHistory();
      setCaptionStyle((prev) => ({
        ...prev,
        ...patch,
        preset: "Custom",
      }));
      if (patch.fontFamily) loadGoogleFont(patch.fontFamily);
    },
    [setCaptionStyle, pushHistory]
  );

  // Live slider update — no history per pixel, single push on commit
  const updateStyleLive = useCallback(
    (patch: Partial<CaptionStyle>) => {
      if (!patch || Object.keys(patch).length === 0) return;
      setCaptionStyle((prev) => ({
        ...prev,
        ...patch,
        preset: "Custom",
      }));
      if (patch.fontFamily) loadGoogleFont(patch.fontFamily);
    },
    [setCaptionStyle]
  );

  const applyPreset = useCallback(
    (preset: PresetName) => {
      const next = getPresetStyle(preset);
      loadGoogleFont(next.fontFamily);
      pushHistory();
      setCaptionStyle(next);
    },
    [setCaptionStyle, pushHistory]
  );

  // UI-10: push history once onPointerDown so undo is one entry per drag, not per pixel (~15/s)
  const handleSliderCommit = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  // Collapsed rail — light editorial — custom visible tooltips + native title fallback
  if (isCollapsed) {
    return (
      <div className={`flex h-full w-[56px] shrink-0 flex-col items-center overflow-visible bg-[var(--surface-card)] ${className ?? ""}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Expand style panel"
          title="Expand style panel"
          className="group relative mt-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[12px] text-[var(--ink)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
        >
          <span aria-hidden>›</span>
          <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Expand style panel
          </span>
        </button>
        <div className="mt-4 flex flex-1 flex-col items-center gap-3 overflow-visible py-2 text-[var(--muted)]">
          <button
            type="button"
            title="Font"
            aria-label="Font"
            className="group relative flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] text-[11px] font-bold text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>A</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Font
            </span>
          </button>
          <button
            type="button"
            title="Colors"
            aria-label="Colors"
            className="group relative flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] text-[10px] text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>◉</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Colors
            </span>
          </button>
          <button
            type="button"
            title="Background Pill"
            aria-label="Background Pill"
            className="group relative flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] text-[10px] text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>▭</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Background Pill
            </span>
          </button>
          <button
            type="button"
            title="Highlight"
            aria-label="Highlight"
            className={`group relative flex h-7 w-7 items-center justify-center rounded-[6px] text-[10px] border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${mode === "static" ? "opacity-30 border-transparent" : "bg-[var(--surface-strong)] border-[var(--hairline-soft)] text-[var(--ink)]"}`}
          >
            <span aria-hidden>✦</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Highlight
            </span>
          </button>
          <button
            type="button"
            title="Position"
            aria-label="Position"
            className="group relative flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] text-[10px] text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>⊕</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Position
            </span>
          </button>
          <button
            type="button"
            title="Alignment"
            aria-label="Alignment"
            className="group relative flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--surface-strong)] border border-[var(--hairline-soft)] text-[10px] text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            <span aria-hidden>≡</span>
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[var(--surface-dark)] px-2.5 py-1 text-[12px] font-[500] text-[var(--on-dark)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Alignment
            </span>
          </button>
        </div>
        <div className="mb-3 h-px w-6 bg-[var(--hairline-soft)]" aria-hidden />
        <span className="mb-3 rotate-180 text-[9px] font-medium tracking-[0.18em] text-[var(--muted)]" style={{ writingMode: "vertical-rl" }}>
          STYLE
        </span>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col bg-[var(--surface-card)] ${className ?? ""}`}>
      {/* Panel header — hidden when hideHeader (e.g., inside mobile sheet that already has a header) */}
      {!hideHeader ? (
        <div className="shrink-0 border-b border-[var(--hairline)] bg-[var(--surface-card)]">
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="text-[16px] font-[500] tracking-tight text-[var(--ink)]">Style</h2>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse style panel"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent text-[14px] leading-none text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              title="Collapse"
            >
              <span aria-hidden>‹</span>
            </button>
          </div>

          {/* Preset pills — hairline-strong */}
          <div className="px-3 pb-3">
            <div className="grid grid-cols-4 gap-1.5">
              {PRESET_PILLS.map((p) => {
                const active = captionStyle.preset === p.value;
                // Check if pill active styles need special for "Bold Drop" vs "Bold" label
                const presetVal = p.value as PresetName;
                return (
                  <button
                    key={p.value}
                    type="button"
                    name="preset"
                    onClick={() => applyPreset(presetVal)}
                    aria-pressed={active}
                    aria-label={p.label}
                    className={`rounded-[8px] border px-1 py-2 text-xs font-medium leading-none transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${active ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-soft)]" : "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"}`}
                    title={`Apply ${p.value} preset`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              Click loads all values; manual tweak → <span className="font-[500] text-[var(--ink)]">Custom</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-b border-[var(--hairline)] bg-[var(--surface-card)] px-3 py-3">
          <div className="grid grid-cols-4 gap-1.5">
            {PRESET_PILLS.map((p) => {
              const active = captionStyle.preset === p.value;
              const presetVal = p.value as PresetName;
              return (
                <button
                  key={p.value}
                  type="button"
                  name="preset"
                  onClick={() => applyPreset(presetVal)}
                  aria-pressed={active}
                  aria-label={p.label}
                  className={`rounded-[8px] border px-1 py-2 text-xs font-medium leading-none transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${active ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-soft)]" : "border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"}`}
                  title={`Apply ${p.value} preset`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            Click loads all values; manual tweak → <span className="font-[500] text-[var(--ink)]">Custom</span>
          </p>
        </div>
      )}

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* FONT */}
        <Accordion title="FONT" icon="A" defaultOpen={true}>
          <div className="space-y-4">
            {/* Family */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="capai-font-family">Family</FieldLabel>
              <div className="relative">
                <select
                  id="capai-font-family"
                  name="fontFamily"
                  value={captionStyle.fontFamily}
                  onChange={(e) => updateStyle({ fontFamily: e.target.value })}
                  aria-label="Family"
                  className="h-8 w-full appearance-none rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-card)] px-3 pr-7 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: `"${f}", Inter, sans-serif` }}>
                      {f}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]">▾</span>
              </div>
              <div
                className="rounded-[6px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)] px-2 py-1.5 text-center text-sm leading-none text-[var(--ink)]"
                style={{ fontFamily: `"${captionStyle.fontFamily}", Inter, sans-serif`, fontWeight: captionStyle.fontWeight as number, fontStyle: captionStyle.fontStyle }}
              >
                Aa Preview
              </div>
            </div>

            {/* Size */}
            <Slider
              id="capai-font-size"
              name="fontSize"
              label="Size"
              value={captionStyle.fontSize}
              min={16}
              max={80}
              display={`${captionStyle.fontSize}px`}
              onChange={(v) => updateStyleLive({ fontSize: v })}
              onCommit={handleSliderCommit}
            />

            {/* Weight */}
            <div className="space-y-1.5">
              <FieldLabel>Weight</FieldLabel>
              <Segmented
                ariaLabel="Font weight"
                name="fontWeight"
                value={String(captionStyle.fontWeight) as "400" | "700" | "900"}
                onChange={(v) => updateStyle({ fontWeight: Number(v) as CaptionStyle["fontWeight"] })}
                options={[
                  { value: "400", label: "Normal" },
                  { value: "700", label: "Bold" },
                  { value: "900", label: "Black" },
                ]}
              />
            </div>

            {/* Style Italic */}
            <div className="space-y-1.5">
              <FieldLabel>Style</FieldLabel>
              <Segmented
                ariaLabel="Font style"
                name="fontStyle"
                value={captionStyle.fontStyle}
                onChange={(v) => updateStyle({ fontStyle: v as CaptionStyle["fontStyle"] })}
                options={[
                  { value: "normal", label: "Regular" },
                  { value: "italic", label: "Italic" },
                ]}
              />
            </div>

            {/* Case */}
            <div className="space-y-1.5">
              <FieldLabel>Case</FieldLabel>
              <Segmented
                ariaLabel="Text transform"
                name="textTransform"
                value={captionStyle.textTransform}
                onChange={(v) => updateStyle({ textTransform: v as CaptionStyle["textTransform"] })}
                options={[
                  { value: "none", label: "None" },
                  { value: "uppercase", label: "UPPER" },
                  { value: "lowercase", label: "lower" },
                  { value: "capitalize", label: "Title" },
                ]}
              />
            </div>

            {/* Align (duplicate but per PRD show again) */}
            <div className="space-y-1.5">
              <FieldLabel>Align</FieldLabel>
              <Segmented
                ariaLabel="Text align"
                name="textAlign"
                value={captionStyle.textAlign}
                onChange={(v) => updateStyle({ textAlign: v as CaptionStyle["textAlign"] })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
          </div>
        </Accordion>

        {/* COLORS */}
        <Accordion title="COLORS" icon="◉" defaultOpen={true}>
          <div className="space-y-4">
            <ColorField
              label="Text"
              value={captionStyle.color}
              onChange={(v) => updateStyle({ color: v })}
              pickerId="capai-text-color-picker"
              hexId="capai-text-color-hex"
              pickerName="textColor"
              hexName="textColorHex"
            />

            <div className="space-y-3 rounded-[8px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)]/60 p-2.5">
              <ColorField
                label="Stroke"
                value={captionStyle.strokeColor}
                onChange={(v) => updateStyle({ strokeColor: v })}
                pickerId="capai-stroke-color-picker"
                hexId="capai-stroke-color-hex"
                pickerName="strokeColor"
                hexName="strokeColorHex"
              />
              <Slider
                id="capai-stroke-width"
                name="strokeWidth"
                label="Width"
                value={captionStyle.strokeWidth}
                min={0}
                max={8}
                display={`${captionStyle.strokeWidth}px`}
                onChange={(v) => updateStyleLive({ strokeWidth: v })}
                onCommit={handleSliderCommit}
              />
            </div>

            <div className="space-y-3 rounded-[8px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)]/60 p-2.5">
              <ColorField
                label="Shadow"
                value={captionStyle.shadowColor}
                onChange={(v) => updateStyle({ shadowColor: v })}
                pickerId="capai-shadow-color-picker"
                hexId="capai-shadow-color-hex"
                pickerName="shadowColor"
                hexName="shadowColorHex"
              />
              <Slider
                id="capai-shadow-blur"
                name="shadowBlur"
                label="Blur"
                value={captionStyle.shadowBlur}
                min={0}
                max={20}
                display={`${captionStyle.shadowBlur}px`}
                onChange={(v) => updateStyleLive({ shadowBlur: v })}
                onCommit={handleSliderCommit}
              />
              <div className="grid grid-cols-2 gap-3">
                <Slider
                  id="capai-shadow-offset-x"
                  name="shadowOffsetX"
                  label="Offset X"
                  value={captionStyle.shadowOffsetX}
                  min={-10}
                  max={10}
                  display={`${captionStyle.shadowOffsetX > 0 ? "+" : ""}${captionStyle.shadowOffsetX}`}
                  onChange={(v) => updateStyleLive({ shadowOffsetX: v })}
                  onCommit={handleSliderCommit}
                />
                <Slider
                  id="capai-shadow-offset-y"
                  name="shadowOffsetY"
                  label="Offset Y"
                  value={captionStyle.shadowOffsetY}
                  min={-10}
                  max={10}
                  display={`${captionStyle.shadowOffsetY > 0 ? "+" : ""}${captionStyle.shadowOffsetY}`}
                  onChange={(v) => updateStyleLive({ shadowOffsetY: v })}
                  onCommit={handleSliderCommit}
                />
              </div>
            </div>
          </div>
        </Accordion>

        {/* BACKGROUND PILL */}
        <Accordion title="BACKGROUND PILL" icon="▭" defaultOpen={true}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[var(--radius-pill)] border border-[var(--hairline-strong)] bg-[var(--surface-strong)] px-3 py-2">
              <label htmlFor="capai-pill-enabled" className="text-xs font-[500] text-[var(--ink)] cursor-pointer">
                Enabled
              </label>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${captionStyle.pillEnabled ? "text-[var(--semantic-success)]" : "text-[var(--muted)]"}`}>
                  {captionStyle.pillEnabled ? "ON" : "OFF"}
                </span>
                <button
                  id="capai-pill-enabled"
                  name="pillEnabled"
                  type="button"
                  role="switch"
                  aria-checked={captionStyle.pillEnabled}
                  aria-label="Enabled"
                  onClick={() => updateStyle({ pillEnabled: !captionStyle.pillEnabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${captionStyle.pillEnabled ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--hairline-strong)] bg-[var(--surface-card)]"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition ${captionStyle.pillEnabled ? "translate-x-4" : "translate-x-1"}`}
                  />
                </button>
              </div>
            </div>

            <div className={`${!captionStyle.pillEnabled ? "pointer-events-none opacity-40" : ""} space-y-4`}>
              <ColorField
                label="Color"
                value={captionStyle.pillColor}
                onChange={(v) => updateStyle({ pillColor: v })}
                pickerId="capai-pill-color-picker"
                hexId="capai-pill-color-hex"
                pickerName="pillColor"
                hexName="pillColorHex"
              />
              <Slider
                id="capai-pill-opacity"
                name="pillOpacity"
                label="Opacity"
                value={Math.round(captionStyle.pillOpacity * 100)}
                min={0}
                max={100}
                display={`${Math.round(captionStyle.pillOpacity * 100)}%`}
                onChange={(v) => updateStyleLive({ pillOpacity: v / 100 })}
                onCommit={handleSliderCommit}
              />
              <div className="grid grid-cols-2 gap-3">
                <Slider
                  id="capai-pill-padding-x"
                  name="pillPaddingX"
                  label="Padding X"
                  value={captionStyle.pillPaddingX}
                  min={0}
                  max={24}
                  display={`${captionStyle.pillPaddingX}px`}
                  onChange={(v) => updateStyleLive({ pillPaddingX: v })}
                  onCommit={handleSliderCommit}
                />
                <Slider
                  id="capai-pill-padding-y"
                  name="pillPaddingY"
                  label="Padding Y"
                  value={captionStyle.pillPaddingY}
                  min={0}
                  max={24}
                  display={`${captionStyle.pillPaddingY}px`}
                  onChange={(v) => updateStyleLive({ pillPaddingY: v })}
                  onCommit={handleSliderCommit}
                />
              </div>
              <Slider
                id="capai-pill-radius"
                name="pillRadius"
                label="Radius"
                value={captionStyle.pillRadius}
                min={0}
                max={20}
                display={`${captionStyle.pillRadius}px`}
                onChange={(v) => updateStyleLive({ pillRadius: v })}
                onCommit={handleSliderCommit}
              />
              {/* Unified Padding control that sets both X & Y together for spec single Padding */}
              <div className="rounded-[6px] bg-[var(--surface-strong)]/60 border border-[var(--hairline-soft)] px-2 py-1.5">
                <Slider
                  id="capai-pill-padding-both"
                  name="pillPaddingBoth"
                  label="Padding (both)"
                  value={Math.round((captionStyle.pillPaddingX + captionStyle.pillPaddingY) / 2)}
                  min={0}
                  max={24}
                  display={`${Math.round((captionStyle.pillPaddingX + captionStyle.pillPaddingY) / 2)}px`}
                  onChange={(v) => updateStyleLive({ pillPaddingX: v, pillPaddingY: v })}
                  onCommit={handleSliderCommit}
                />
                <p className="mt-1 text-center text-[10px] text-[var(--muted)]">Sets X & Y together</p>
              </div>
            </div>
          </div>
        </Accordion>

        {/* HIGHLIGHT — Dynamic only */}
        <Accordion title="HIGHLIGHT" icon="✦" defaultOpen={true} disabled={mode === "static"}>
          <div className="space-y-4">
            {mode === "static" && (
              <p className="rounded-[6px] border border-[var(--hairline-soft)] bg-[var(--surface-strong)] px-2 py-1.5 text-center text-[11px] text-[var(--muted)]">
                Dynamic mode only — grayed out in Static
              </p>
            )}
            <div className="space-y-1.5">
              <FieldLabel>Style</FieldLabel>
              <Segmented
                ariaLabel="Highlight style"
                name="highlightStyle"
                value={captionStyle.highlightStyle}
                onChange={(v) => updateStyle({ highlightStyle: v as CaptionStyle["highlightStyle"] })}
                options={[
                  { value: "karaoke", label: "Karaoke" },
                  { value: "pill", label: "Pill" },
                  { value: "pop", label: "Pop & Scale" },
                ]}
              />
            </div>
            <ColorField
              label="Active word"
              value={captionStyle.activeWordColor}
              onChange={(v) => updateStyle({ activeWordColor: v })}
              pickerId="capai-active-word-color-picker"
              hexId="capai-active-word-color-hex"
              pickerName="activeWordColor"
              hexName="activeWordColorHex"
            />
            <ColorField
              label="Inactive word"
              value={captionStyle.inactiveWordColor}
              onChange={(v) => updateStyle({ inactiveWordColor: v })}
              pickerId="capai-inactive-word-color-picker"
              hexId="capai-inactive-word-color-hex"
              pickerName="inactiveWordColor"
              hexName="inactiveWordColorHex"
            />
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              <span className="font-[500] text-[var(--ink)]">Karaoke</span> colors per word · <span className="font-[500] text-[var(--ink)]">Pill</span> draws background behind active · <span className="font-[500] text-[var(--ink)]">Pop</span> scales active 1.15×
            </p>
          </div>
        </Accordion>

        {/* POSITION */}
        <Accordion title="POSITION" icon="⊕" defaultOpen={true}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel>Preset</FieldLabel>
              <Segmented
                ariaLabel="Position preset"
                name="positionPreset"
                value={captionStyle.positionPreset}
                onChange={(v) => updateStyle({ positionPreset: v as CaptionStyle["positionPreset"] })}
                options={[
                  { value: "top", label: "Top" },
                  { value: "center", label: "Center" },
                  { value: "bottom", label: "Bottom" },
                ]}
              />
            </div>
            <Slider
              id="capai-position-offset-y"
              name="positionOffsetY"
              label="V-Offset"
              value={captionStyle.positionOffsetY}
              min={-50}
              max={50}
              display={`${captionStyle.positionOffsetY > 0 ? "+" : ""}${captionStyle.positionOffsetY}px`}
              onChange={(v) => updateStyleLive({ positionOffsetY: v })}
              onCommit={handleSliderCommit}
            />
            <div className="space-y-1.5">
              <FieldLabel>H-Align</FieldLabel>
              <Segmented
                ariaLabel="Horizontal align"
                name="hAlign"
                value={captionStyle.hAlign}
                onChange={(v) => updateStyle({ hAlign: v as CaptionStyle["hAlign"] })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
          </div>
        </Accordion>

        {/* ALIGNMENT — duplicate textAlign */}
        <Accordion title="ALIGNMENT" icon="≡" defaultOpen={false}>
          <div className="space-y-3">
            <p className="text-[11px] text-[var(--muted)]">Text alignment (mirrors FONT → Align). Shown again per PRD §4.5.3.</p>
            <Segmented
              ariaLabel="Text align duplicate"
              name="textAlign"
              value={captionStyle.textAlign}
              onChange={(v) => updateStyle({ textAlign: v as CaptionStyle["textAlign"] })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
            />
            <div className="rounded-[8px] border border-dashed border-[var(--hairline-strong)] bg-[var(--surface-strong)]/60 p-2.5 text-center">
              <p className="text-xs text-[var(--ink)]" style={{ textAlign: captionStyle.textAlign as React.CSSProperties["textAlign"] }}>
                Preview: The quick brown fox aligns {captionStyle.textAlign}
              </p>
              <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">hAlign: {captionStyle.hAlign} · textAlign: {captionStyle.textAlign}</p>
            </div>
          </div>
        </Accordion>

        {/* Footer live preview note */}
        <div className="border-t border-[var(--hairline-soft)] bg-[var(--canvas-soft)] px-3 py-3">
          <p className="text-center text-[11px] leading-relaxed text-[var(--muted)]">
            Every change redraws the canvas overlay instantly. No Apply button.
            <br />
            <span className="font-mono text-[10px]">{captionStyle.preset}</span> · <span className="font-mono text-[10px]">{mode}</span> · {captionStyle.fontFamily} {captionStyle.fontSize}px
          </p>
          <div className="mt-2 flex items-center justify-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--semantic-success)]" aria-hidden />
            <span className="text-[10px] font-medium tracking-wide text-[var(--muted)]">LIVE PREVIEW</span>
          </div>
        </div>
      </div>
    </div>
  );
}
