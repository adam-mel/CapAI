"use client";
import { useEffect } from "react";
import { isRtlLanguage } from "@/lib/types";

/**
 * UI-15/16: sync <html lang> and dir based on current project/settings language
 * Listens to capai:language-changed events and checks localStorage/project settings
 */
export default function LangDirSync() {
  useEffect(() => {
    const sync = (lang?: string) => {
      try {
        let l = lang;
        if (!l) {
          try {
            const raw = localStorage.getItem("capai_last_project_id");
            // fallback to stored language hint
            const hint = localStorage.getItem("capai_last_language");
            if (hint) l = hint;
          } catch {}
        }
        if (!l) return;
        const rtl = isRtlLanguage(l);
        document.documentElement.lang = l;
        document.documentElement.dir = rtl ? "rtl" : "ltr";
      } catch {}
    };
    // initial from navigator
    try {
      const navLang = navigator.language?.slice(0, 2);
      if (navLang && ["ar", "he"].includes(navLang)) sync(navLang);
    } catch {}
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ language?: string }>;
      if (ce.detail?.language) sync(ce.detail.language);
    };
    window.addEventListener("capai:language-changed", handler as EventListener);
    return () => window.removeEventListener("capai:language-changed", handler as EventListener);
  }, []);
  return null;
}
