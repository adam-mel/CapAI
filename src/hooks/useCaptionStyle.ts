"use client";

import { useCallback, useMemo } from "react";
import { useEditor } from "@/context/EditorContext";
import type { CaptionStyle, PresetName } from "@/lib/types";
import { getPresetStyle } from "@/lib/presets";
import { loadGoogleFont } from "@/lib/canvasRenderer";

/**
 * CapAI — useCaptionStyle hook
 * Thin wrapper over EditorContext for style mutations.
 * - updateStyle merges patch and flips preset to Custom (per spec: manual tweak → Custom)
 * - applyPreset loads full preset via getPresetStyle
 * - All mutations push to undo history before applying so style changes are undoable
 * - Handles Google Fonts on-demand injection
 */

export const FONT_FAMILIES = [
  "Inter",
  "Montserrat",
  "Impact",
  "Bebas Neue",
  "Anton",
  "Oswald",
  "Poppins",
  "Roboto",
] as const;

export type FontFamilyOption = (typeof FONT_FAMILIES)[number];

export interface UseCaptionStyleReturn {
  captionStyle: CaptionStyle;
  mode: "dynamic" | "static";
  updateStyle: (patch: Partial<CaptionStyle>) => void;
  setPreset: (preset: PresetName) => void;
  applyPreset: (preset: PresetName) => void;
}

export function useCaptionStyle(): UseCaptionStyleReturn {
  const { captionStyle, setCaptionStyle, settings } = useEditor();

  const updateStyle = useCallback(
    (patch: Partial<CaptionStyle>) => {
      // No-op if empty patch
      if (!patch || Object.keys(patch).length === 0) return;
      setCaptionStyle((prev) => {
        const next: CaptionStyle = {
          ...prev,
          ...patch,
          preset: "Custom",
        } as CaptionStyle;
        // Preserve Custom preset label even if patch includes preset — if it's a manual tweak we force Custom
        // Unless patch explicitly sets preset via applyPreset path (handled separately)
        // So if patch contains preset we still force Custom unless it's via applyPreset
        if ("preset" in patch && patch.preset !== undefined && patch.preset !== prev.preset) {
          // manual patch includes preset — respect it only if it's Custom? Actually manual tweak always Custom
          next.preset = "Custom";
        }
        return next;
      });
      if (patch.fontFamily) {
        loadGoogleFont(patch.fontFamily);
      }
    },
    [setCaptionStyle]
  );

  const applyPreset = useCallback(
    (preset: PresetName) => {
      const next = getPresetStyle(preset);
      loadGoogleFont(next.fontFamily);
      setCaptionStyle(next);
    },
    [setCaptionStyle]
  );

  // Alias for spec wording
  const setPreset = applyPreset;

  return useMemo(
    () => ({
      captionStyle,
      mode: settings.mode,
      updateStyle,
      setPreset,
      applyPreset,
    }),
    [captionStyle, settings.mode, updateStyle, setPreset, applyPreset]
  );
}

export default useCaptionStyle;
