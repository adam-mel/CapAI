/**
 * CapAI — Style Presets
 * PRD §10 — Reference table for built-in presets
 */

import type { CaptionStyle, PresetName } from "./types";

export const STYLE_PRESETS: Record<Exclude<PresetName, "Custom">, Omit<CaptionStyle, "preset">> = {
  Reels: {
    fontFamily: "Montserrat",
    fontSize: 52,
    fontWeight: 900,
    fontStyle: "normal",
    textTransform: "none",
    textAlign: "center",
    color: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 2,
    shadowColor: "#000000",
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    pillEnabled: false,
    pillColor: "#000000",
    pillOpacity: 0.75,
    pillPaddingX: 8,
    pillPaddingY: 4,
    pillRadius: 8,
    highlightStyle: "karaoke",
    activeWordColor: "#FFD700",
    inactiveWordColor: "#FFFFFFAA",
    positionPreset: "bottom",
    positionOffsetY: 12,
    hAlign: "center",
  },
  Clean: {
    fontFamily: "Inter",
    fontSize: 40,
    fontWeight: 700,
    fontStyle: "normal",
    textTransform: "none",
    textAlign: "center",
    color: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    pillEnabled: true,
    pillColor: "#000000",
    pillOpacity: 0.7,
    pillPaddingX: 12,
    pillPaddingY: 6,
    pillRadius: 8,
    highlightStyle: "pill",
    activeWordColor: "#FFFFFF",
    inactiveWordColor: "#FFFFFFAA",
    positionPreset: "bottom",
    positionOffsetY: 12,
    hAlign: "center",
  },
  "Bold Drop": {
    fontFamily: "Impact",
    fontSize: 60,
    fontWeight: 900,
    fontStyle: "normal",
    textTransform: "uppercase",
    textAlign: "center",
    color: "#FFD700",
    strokeColor: "#000000",
    strokeWidth: 4,
    shadowColor: "#000000",
    shadowBlur: 6,
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    pillEnabled: false,
    pillColor: "#000000",
    pillOpacity: 0.75,
    pillPaddingX: 8,
    pillPaddingY: 4,
    pillRadius: 8,
    highlightStyle: "pop",
    activeWordColor: "#FFD700",
    inactiveWordColor: "#FFFFFF",
    positionPreset: "bottom",
    positionOffsetY: 12,
    hAlign: "center",
  },
};

export const CUSTOM_DEFAULT: Omit<CaptionStyle, "preset"> = {
  fontFamily: "Inter",
  fontSize: 48,
  fontWeight: 700,
  fontStyle: "normal",
  textTransform: "none",
  textAlign: "center",
  color: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 2,
  shadowColor: "#000000",
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  pillEnabled: false,
  pillColor: "#000000",
  pillOpacity: 0.75,
  pillPaddingX: 8,
  pillPaddingY: 4,
  pillRadius: 8,
  highlightStyle: "karaoke",
  activeWordColor: "#FFD700",
  inactiveWordColor: "#FFFFFFAA",
  positionPreset: "bottom",
  positionOffsetY: 12,
  hAlign: "center",
};

export function getPresetStyle(preset: PresetName): CaptionStyle {
  if (preset === "Custom") {
    return { preset: "Custom", ...CUSTOM_DEFAULT };
  }
  return { preset, ...STYLE_PRESETS[preset] };
}

export const PRESET_OPTIONS: { value: PresetName; label: string }[] = [
  { value: "Reels", label: "Reels" },
  { value: "Clean", label: "Clean" },
  { value: "Bold Drop", label: "Bold Drop" },
  { value: "Custom", label: "Custom" },
];

// ── Style Panel helpers ───────────────────────────────────────────────

export const FONT_FAMILIES_PRESETS = [
  "Inter",
  "Montserrat",
  "Impact",
  "Bebas Neue",
  "Anton",
  "Oswald",
  "Poppins",
  "Roboto",
] as const;

export type FontFamilyPreset = (typeof FONT_FAMILIES_PRESETS)[number];

// Convenience: labels for UI pills — "Bold Drop" displays as "Bold"
export const PRESET_PILL_LABELS: Record<PresetName, string> = {
  Reels: "Reels",
  Clean: "Clean",
  "Bold Drop": "Bold",
  Custom: "Custom",
};
