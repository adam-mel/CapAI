"use client";

interface EmptyStateProps {
  onNewProject: () => void;
}

export function EmptyState({ onNewProject }: EmptyStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      {/* gradient-orb-card: canvas-soft, rounded-xxl 24px, padding 32px, hairline border, atmospheric orbs */}
      <div className="relative w-full max-w-[640px] overflow-hidden rounded-[var(--radius-xxl)] border border-[var(--hairline)] bg-[var(--canvas-soft)] p-8 shadow-[var(--shadow-soft)]">
        {/* Atmospheric orbs — decoration only, never interactive */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full opacity-[0.34]"
          style={{
            background: "radial-gradient(circle at center, var(--gradient-mint) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-[480px] w-[480px] rounded-full opacity-[0.30]"
          style={{
            background: "radial-gradient(circle at center, var(--gradient-peach) 0%, transparent 70%)",
            filter: "blur(1px)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18]"
          style={{
            background: "radial-gradient(circle at center, var(--gradient-lavender) 0%, transparent 72%)",
            filter: "blur(20px)",
          }}
        />

        {/* Content — relative to sit above orbs */}
        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Icon — surface-card plate with hairline */}
          <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface-card)] text-[28px] leading-none text-[var(--muted)] shadow-[0_2px_16px_rgba(0,0,0,0.04)]">
            {/* eslint-disable-next-line jsx-a11y/aria-hidden */}
            <span aria-hidden>✦</span>
          </div>

          {/* Display-md: 32px 300 Waldenburg/EB Garamond editorial */}
          <h2
            className="mt-6 text-[32px] font-[300] leading-[1.13] tracking-[-0.32px] text-[var(--ink)]"
            style={{ fontFamily: "var(--font-eb), 'EB Garamond', 'Times New Roman', serif" }}
          >
            No projects yet
          </h2>

          {/* Body-md: 16px 400 Inter */}
          <p className="mt-3 max-w-[36ch] text-[16px] font-[400] leading-[1.5] tracking-[0.16px] text-[var(--body)]">
            Drop a video anywhere, or start a new project to generate captions in your browser.
          </p>

          {/* Primary pill CTA — button-primary 40px 15px 500 */}
          <button
            type="button"
            onClick={onNewProject}
            className="mt-7 inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--primary)] px-5 text-[15px] font-[500] leading-none text-[var(--on-primary)] shadow-[0_1px_2px_rgba(12,10,9,0.06)] transition hover:bg-[var(--primary-active)] hover:shadow-[0_4px_16px_rgba(12,10,9,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas-soft)] active:scale-[0.98]"
          >
            + New Project
          </button>

          {/* Supports line — caption muted #6e6862 via var(--muted) */}
          <p className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[12px] font-[600] uppercase leading-[1.4] tracking-[0.96px] text-[var(--muted)]">
            <span>MP4 · MOV · WebM · MKV · AVI</span>
            <span className="hidden h-3 w-px bg-[var(--hairline)] sm:inline-block" aria-hidden />
            <span className="hidden sm:inline">Drag &amp; drop anywhere</span>
          </p>
        </div>
      </div>

      {/* Helper tip below card — muted text #6e6862 */}
      <p className="mt-6 text-center text-[14px] font-[400] leading-[1.5] text-[var(--muted)]">
        Your projects are stored locally in this browser.
      </p>
    </div>
  );
}
