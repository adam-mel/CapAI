import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ElevenLabs editorial — canvas & surfaces
        canvas: "var(--canvas)",
        "canvas-soft": "var(--canvas-soft)",
        "canvas-deep": "var(--canvas-deep)",
        "surface-card": "var(--surface-card)",
        "surface-strong": "var(--surface-strong)",
        "surface-dark": "var(--surface-dark)",
        "surface-dark-elevated": "var(--surface-dark-elevated)",

        // Ink & text
        primary: "var(--primary)",
        "primary-active": "var(--primary-active)",
        ink: "var(--ink)",
        body: "var(--body)",
        "body-strong": "var(--body-strong)",
        muted: "var(--muted)",
        "muted-soft": "var(--muted-soft)",

        // Hairlines
        hairline: "var(--hairline)",
        "hairline-soft": "var(--hairline-soft)",
        "hairline-strong": "var(--hairline-strong)",

        // On colours
        "on-primary": "var(--on-primary)",
        "on-dark": "var(--on-dark)",
        "on-dark-soft": "var(--on-dark-soft)",

        // Atmospheric gradients (decoration only)
        "gradient-mint": "var(--gradient-mint)",
        "gradient-peach": "var(--gradient-peach)",
        "gradient-lavender": "var(--gradient-lavender)",
        "gradient-sky": "var(--gradient-sky)",
        "gradient-rose": "var(--gradient-rose)",

        // Semantic
        "semantic-error": "var(--semantic-error)",
        "semantic-success": "var(--semantic-success)",

        // Legacy aliases — keep existing component classes working
        "bg-base": "var(--bg-base)",
        "bg-surface": "var(--bg-surface)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-hover": "var(--bg-hover)",
        border: "var(--border)",
        "border-subtle": "var(--border-subtle)",
        "border-strong": "var(--border-strong)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-glow": "var(--accent-glow)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        display: ['var(--font-eb)', '"EB Garamond"', '"Times New Roman"', "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        none: "var(--radius-none)",
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        xxl: "var(--radius-xxl)",
        pill: "var(--radius-pill)",
        full: "var(--radius-full)",
        // legacy
        card: "var(--radius-card)",
        input: "var(--radius-input)",
        badge: "var(--radius-badge)",
        modal: "var(--radius-modal)",
      },
      spacing: {
        xxs: "var(--spacing-xxs)",
        xs: "var(--spacing-xs)",
        sm: "var(--spacing-sm)",
        base: "var(--spacing-base)",
        md: "var(--spacing-md)",
        lg: "var(--spacing-lg)",
        xl: "var(--spacing-xl)",
        xxl: "var(--spacing-xxl)",
        section: "var(--spacing-section)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      maxWidth: {
        content: "1200px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "spin-slow": "spin-slow 1s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
