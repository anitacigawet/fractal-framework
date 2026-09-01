// StitchDesignPanel — the Phase B Stitch-generated visual design surface
// inside the Campaign page. Handles all five run states (A: not started,
// B: generating/refining, B': awaiting, C: complete, D: error).
//
// Polls trpc.stitch.latestForCampaign while a run is in flight; presents a
// multi-pane layout (status bar, step progress, screen thumbnail, edit
// history, Designer textbox, footer actions). The Designer textbox shows a
// one-time disclaimer reminding the user that this pipeline preserves
// content integrity — design requests, not content rewrites.
//
// Falls back gracefully when Stitch is unconfigured. The default-template
// panel underneath remains the always-available escape hatch.

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../lib/trpc";
import { Button, Frame, Pill, SectionMark } from "./ui";
import type { StitchEdit, StitchRun } from "../../../shared/types";

interface StitchDesignPanelProps {
  campaignId: string;
  campaignName: string;
}

export function StitchDesignPanel({
  campaignId,
  campaignName,
}: StitchDesignPanelProps) {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const stepList = trpc.stitch.stepList.useQuery();

  const run = trpc.stitch.latestForCampaign.useQuery(
    { campaignId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        if (!s) return false;
        if (s === "complete" || s === "error" || s === "awaiting") return false;
        return 3_500;
      },
      refetchOnWindowFocus: false,
    }
  );

  const start = trpc.stitch.start.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });
  const cancel = trpc.stitch.cancel.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });

  const stitchSettings = settings.data?.stitch;
  const hasKey = !!stitchSettings?.hasKey;

  const r = run.data;
  const state = pickState(r);

  return (
    <Frame as="section" className="p-7 mb-7">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SectionMark>§ Site design · generative (Stitch)</SectionMark>
        <div className="flex-1" />
        {r && <Pill tone={pillTone(r.status)}>{r.status}</Pill>}
        {!hasKey && <Pill tone="warn">key not set</Pill>}
      </div>

      {state === "A" && (
        <StateAStart
          hasKey={hasKey}
          isStarting={start.isPending}
          startError={start.error?.message}
          onStart={() => start.mutate({ campaignId })}
        />
      )}

      {state === "B" && r && (
        <StateBRunning
          run={r}
          stepList={stepList.data ?? []}
          isCancelling={cancel.isPending}
          onCancel={() => cancel.mutate({ runId: r.id })}
          campaignId={campaignId}
          stitchSettings={stitchSettings}
        />
      )}

      {state === "awaiting" && r && (
        <StateAwaitingOrUserEditing
          run={r}
          stepList={stepList.data ?? []}
          campaignId={campaignId}
          stitchSettings={stitchSettings}
        />
      )}

      {state === "C" && r && (
        <StateCComplete
          run={r}
          campaignId={campaignId}
          campaignName={campaignName}
        />
      )}

      {state === "D" && r && (
        <StateDError
          run={r}
          isRestarting={start.isPending}
          startError={start.error?.message}
          onRestart={() => start.mutate({ campaignId })}
        />
      )}
    </Frame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State pick — flatten run.status into the 5 UI states
// ─────────────────────────────────────────────────────────────────────────

type UiState = "A" | "B" | "awaiting" | "C" | "D";

function pickState(r: StitchRun | null | undefined): UiState {
  if (!r) return "A";
  if (r.status === "complete") return "C";
  if (r.status === "error") return "D";
  if (r.status === "awaiting") return "awaiting";
  return "B";
}

function pillTone(
  s: string
): "ok" | "warn" | "bad" | "neutral" {
  if (s === "complete") return "ok";
  if (s === "error") return "bad";
  if (s === "awaiting") return "ok";
  return "warn";
}

// ─────────────────────────────────────────────────────────────────────────
// State A — Not started
// ─────────────────────────────────────────────────────────────────────────

function StateAStart({
  hasKey,
  isStarting,
  startError,
  onStart,
}: {
  hasKey: boolean;
  isStarting: boolean;
  startError?: string;
  onStart: () => void;
}) {
  return (
    <>
      <h2 className="t-display mb-3" style={{ fontSize: 22, color: "var(--ink)" }}>
        Generate per-campaign visual design.
      </h2>
      <p className="prose-body mb-5" style={{ fontSize: 14, lineHeight: 1.65 }}>
        Google Stitch designs the visual chrome around this campaign&apos;s
        fact-checked content. The wizard runs an iterative sequence
        (structural scaffold + one refinement pass per major section) with a
        validation gate between each pass &mdash; if any citation token gets
        dropped, that pass retries up to 2&times; before surfacing an error.
        Free.
      </p>

      {!hasKey && (
        <div
          className="mb-5 p-3"
          style={{
            background: "oklch(0.22 0.04 75 / 0.35)",
            border: "1px solid oklch(0.45 0.10 75 / 0.5)",
            borderRadius: 2,
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          Stitch is not configured.{" "}
          <Link href="/settings" className="link-amber">
            Set the STITCH_API_KEY on the Settings page
          </Link>{" "}
          before starting a run.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={onStart}
          disabled={!hasKey || isStarting}
          arrow
        >
          {isStarting ? "Starting" : "Generate with Stitch"}
        </Button>
        <span
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          ~7 passes · several minutes
        </span>
      </div>

      {startError && (
        <pre className="code-block mt-4" style={{ color: "var(--bad)" }}>
          {startError}
        </pre>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State B — Generating / Refining (auto-sequence in flight)
// ─────────────────────────────────────────────────────────────────────────

function StateBRunning({
  run,
  stepList,
  isCancelling,
  onCancel,
  campaignId,
  stitchSettings,
}: {
  run: StitchRun;
  stepList: Array<{ key: string; label: string }>;
  isCancelling: boolean;
  onCancel: () => void;
  campaignId: string;
  stitchSettings:
    | { hasKey: boolean; disclaimerDismissed: boolean }
    | undefined;
}) {
  const utils = trpc.useUtils();
  const queueUserPrompt = trpc.stitch.queueUserPrompt.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });

  return (
    <>
      <ProgressLine run={run} stepList={stepList} />
      <p
        className="prose-body mb-4"
        style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
      >
        {run.progress}
      </p>
      <EditHistory edits={run.edits} />

      {/* Designer textbox during auto-sequence — queues for after the
          sequence rather than firing immediately. Avoids the "I typed
          something and the wizard surprise-applied it" failure mode. */}
      <DesignerInput
        disclaimerDismissed={!!stitchSettings?.disclaimerDismissed}
        isPending={queueUserPrompt.isPending}
        onSubmit={(prompt) =>
          queueUserPrompt.mutate({ runId: run.id, prompt })
        }
        lastError={queueUserPrompt.error?.message}
        initialValue={run.queued_user_prompt}
        submitLabel="Save for after auto-sequence"
        pendingLabel="Saving"
        helperText={
          run.queued_user_prompt
            ? "Saved. The textbox will pre-fill with this when the auto-sequence finishes — review and send, or edit first."
            : "The auto-sequence is running. Type a prompt now and it'll be ready to send the moment the sequence completes."
        }
        clearOnSubmit={false}
      />

      <div
        className="mt-4 pt-4 flex items-center gap-3 flex-wrap"
        style={{ borderTop: "1px solid var(--rule)" }}
      >
        <Button variant="ghost" onClick={onCancel} disabled={isCancelling}>
          {isCancelling ? "Cancelling" : "Cancel sequence"}
        </Button>
        <span
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 11,
            letterSpacing: "0.06em",
          }}
        >
          Stops at the next step boundary.
        </span>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Awaiting state — auto-sequence finished, user can refine or finalize
// ─────────────────────────────────────────────────────────────────────────

function StateAwaitingOrUserEditing({
  run,
  stepList,
  campaignId,
  stitchSettings,
}: {
  run: StitchRun;
  stepList: Array<{ key: string; label: string }>;
  campaignId: string;
  stitchSettings:
    | { hasKey: boolean; disclaimerDismissed: boolean }
    | undefined;
}) {
  const utils = trpc.useUtils();
  const userEdit = trpc.stitch.applyUserEdit.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });
  const inject = trpc.stitch.inject.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });

  return (
    <>
      <ProgressLine run={run} stepList={stepList} />
      <p
        className="prose-body mb-4"
        style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
      >
        {run.progress}
      </p>
      <EditHistory edits={run.edits} />

      <DesignerInput
        disclaimerDismissed={!!stitchSettings?.disclaimerDismissed}
        isPending={userEdit.isPending}
        onSubmit={(prompt) =>
          userEdit.mutate({ runId: run.id, prompt })
        }
        lastError={userEdit.error?.message}
        initialValue={run.queued_user_prompt}
        helperText={
          run.queued_user_prompt
            ? "This was queued during the auto-sequence — review and send, or edit first."
            : undefined
        }
      />

      <div
        className="mt-4 pt-4 flex items-center gap-3 flex-wrap"
        style={{ borderTop: "1px solid var(--rule)" }}
      >
        <Button
          onClick={() => inject.mutate({ runId: run.id })}
          disabled={inject.isPending}
          arrow
        >
          {inject.isPending ? "Finalizing" : "Finalize & inject content"}
        </Button>
        <span
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 11,
            letterSpacing: "0.06em",
            maxWidth: "44ch",
            lineHeight: 1.5,
          }}
        >
          Validates all citation tokens, replaces them with real content, then
          publishes the preview.
        </span>
      </div>
      {inject.error && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {inject.error.message}
        </pre>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State C — Complete
// ─────────────────────────────────────────────────────────────────────────

function StateCComplete({
  run,
  campaignId,
  campaignName,
}: {
  run: StitchRun;
  campaignId: string;
  campaignName: string;
}) {
  const downloadUrl = `/api/download/${campaignId}?source=stitch`;
  const utils = trpc.useUtils();
  const start = trpc.stitch.start.useMutation({
    onSuccess: () => utils.stitch.latestForCampaign.invalidate({ campaignId }),
  });
  return (
    <>
      <p
        className="prose-body mb-3"
        style={{ fontSize: 13.5, lineHeight: 1.6 }}
      >
        Stitch generation complete for {campaignName}. {run.edits.length} pass
        {run.edits.length === 1 ? "" : "es"} ·{" "}
        {run.edits.filter((e) => e.validation_ok).length} validated.
      </p>
      {run.audit_result && (
        <p
          className="t-mono mb-4"
          style={{
            fontSize: 11,
            color: "var(--ok)",
            letterSpacing: "0.06em",
            lineHeight: 1.6,
          }}
        >
          {run.audit_result}
        </p>
      )}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <a href={downloadUrl} download className="btn-amber">
          Download HTML
        </a>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          Open in new tab
        </a>
        <Button
          variant="ghost"
          onClick={() => start.mutate({ campaignId })}
          disabled={start.isPending}
        >
          {start.isPending ? "Restarting" : "Re-generate from scratch"}
        </Button>
        {run.session_url && (
          <a
            href={run.session_url}
            target="_blank"
            rel="noopener noreferrer"
            className="link-amber t-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Continue in Stitch ↗
          </a>
        )}
      </div>

      <StitchPreviewIframe runId={run.id} />

      <EditHistory edits={run.edits} compact />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State D — Error
// ─────────────────────────────────────────────────────────────────────────

function StateDError({
  run,
  isRestarting,
  startError,
  onRestart,
}: {
  run: StitchRun;
  isRestarting: boolean;
  startError?: string;
  onRestart: () => void;
}) {
  return (
    <>
      <p
        className="prose-body mb-3"
        style={{ fontSize: 14, color: "var(--bad)" }}
      >
        Stitch run failed.
      </p>
      <pre className="code-block mb-4" style={{ color: "var(--bad)" }}>
        {run.error || "(no error message captured)"}
      </pre>
      {run.edits.length > 0 && <EditHistory edits={run.edits} compact />}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        <Button onClick={onRestart} disabled={isRestarting} arrow>
          {isRestarting ? "Restarting" : "Try again"}
        </Button>
        <span
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 11,
            letterSpacing: "0.06em",
            maxWidth: "40ch",
            lineHeight: 1.5,
          }}
        >
          The default template below is always available as a fallback.
        </span>
      </div>
      {startError && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {startError}
        </pre>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step progress line — segmented bar like the framework run progress
// ─────────────────────────────────────────────────────────────────────────

function ProgressLine({
  run,
  stepList,
}: {
  run: StitchRun;
  stepList: Array<{ key: string; label: string }>;
}) {
  if (stepList.length === 0) return null;
  const completedSteps = new Set(run.edits.map((e) => e.step));
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5">
        {stepList.map((s) => {
          const done = completedSteps.has(s.key);
          const active = run.current_step === s.key;
          const color = done
            ? "var(--amber)"
            : active
            ? "var(--amber-deep)"
            : "var(--rule)";
          return (
            <div
              key={s.key}
              title={s.label}
              style={{
                height: 3,
                flex: 1,
                background: color,
                animation: active
                  ? "pulse-amber 1.8s ease-in-out infinite"
                  : "none",
              }}
            />
          );
        })}
      </div>
      <div
        className="flex items-center justify-between mt-2 t-mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span>
          {run.current_step
            ? stepList.find((s) => s.key === run.current_step)?.label ??
              run.current_step
            : "—"}
        </span>
        <span>
          {completedSteps.size} / {stepList.length}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Edit history — scrollable list of step cards
// ─────────────────────────────────────────────────────────────────────────

function EditHistory({
  edits,
  compact = false,
}: {
  edits: StitchEdit[];
  compact?: boolean;
}) {
  if (edits.length === 0) {
    return (
      <p
        className="t-mono"
        style={{
          fontSize: 12,
          color: "var(--ink-4)",
          fontStyle: "italic",
        }}
      >
        No passes yet.
      </p>
    );
  }
  return (
    <details {...(compact ? {} : { open: true })}>
      <summary
        className="t-mono"
        style={{
          color: "var(--ink-3)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          cursor: "pointer",
          marginBottom: 8,
        }}
      >
        Edit history · {edits.length} pass{edits.length === 1 ? "" : "es"}
      </summary>
      <ul
        className="space-y-2"
        style={{
          listStyle: "none",
          padding: 0,
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {edits.map((e) => (
          <li
            key={e.index}
            className="p-3"
            style={{
              background: "oklch(0.115 0.010 60 / 0.6)",
              border: "1px solid var(--rule)",
              borderRadius: 2,
            }}
          >
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="t-mono"
                style={{
                  color: "var(--amber)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                }}
              >
                [{String(e.index).padStart(2, "0")}]
              </span>
              <span
                className="t-mono"
                style={{
                  color: "var(--ink-2)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                }}
              >
                {e.step}
              </span>
              <Pill tone={e.source === "user" ? "warn" : "neutral"}>
                {e.source}
              </Pill>
              <Pill tone={e.validation_ok ? "ok" : "bad"}>
                {e.validation_ok
                  ? "validated"
                  : `${e.validation_missing.length} missing`}
              </Pill>
              <div className="flex-1" />
              {e.duration_ms !== undefined && (
                <span
                  className="t-mono"
                  style={{
                    color: "var(--ink-4)",
                    fontSize: 10,
                    letterSpacing: "0.06em",
                  }}
                >
                  {Math.round(e.duration_ms / 100) / 10}s
                </span>
              )}
            </div>
            {!e.validation_ok && e.validation_missing.length > 0 && (
              <div
                className="t-mono"
                style={{
                  color: "var(--bad)",
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  marginTop: 4,
                }}
              >
                missing: {e.validation_missing.slice(0, 6).join(", ")}
                {e.validation_missing.length > 6 ? "…" : ""}
              </div>
            )}
            {e.image_url && (
              <a
                href={e.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="t-mono link-amber"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  marginTop: 4,
                  display: "inline-block",
                }}
              >
                screenshot ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Designer input — Designer-labelled textbox + one-time disclaimer
// ─────────────────────────────────────────────────────────────────────────

function DesignerInput({
  disclaimerDismissed,
  isPending,
  onSubmit,
  lastError,
  initialValue,
  submitLabel = "Send to Stitch",
  pendingLabel = "Sending",
  helperText,
  clearOnSubmit = true,
}: {
  disclaimerDismissed: boolean;
  isPending: boolean;
  onSubmit: (prompt: string) => void;
  lastError?: string;
  initialValue?: string;
  submitLabel?: string;
  pendingLabel?: string;
  helperText?: string;
  clearOnSubmit?: boolean;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(initialValue ?? "");
  const [showDisclaimer, setShowDisclaimer] = useState(!disclaimerDismissed);

  // If a new initialValue arrives (e.g. the run transitions awaiting and
  // queued_user_prompt becomes visible), pre-fill the textbox once.
  // Only sync when the textbox is empty so we don't clobber user typing.
  const lastInitialRef = useRef<string | undefined>(initialValue);
  useEffect(() => {
    if (initialValue && initialValue !== lastInitialRef.current && !text) {
      setText(initialValue);
      lastInitialRef.current = initialValue;
    }
  }, [initialValue, text]);

  const dismiss = trpc.settings.setStitchDisclaimerDismissed.useMutation({
    onSuccess: () => {
      utils.settings.get.invalidate();
      setShowDisclaimer(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isPending) return;
    onSubmit(text.trim());
    if (clearOnSubmit) setText("");
  };

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <PaintbrushIcon />
        <span
          className="t-mono"
          style={{
            color: "var(--amber)",
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Designer · aesthetic requests
        </span>
      </div>

      {showDisclaimer && (
        <div
          className="mb-3 p-4 relative"
          style={{
            background: "oklch(0.18 0.04 55 / 0.5)",
            border: "1px solid oklch(0.45 0.10 55 / 0.5)",
            borderRadius: 2,
          }}
        >
          <button
            type="button"
            onClick={() => dismiss.mutate({ dismissed: true })}
            disabled={dismiss.isPending}
            aria-label="Dismiss"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "transparent",
              border: 0,
              color: "var(--ink-3)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
          <div
            className="t-mono mb-2"
            style={{
              color: "var(--amber)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            · Heads up — keep it visual
          </div>
          <p
            className="prose-body"
            style={{
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "var(--ink-2)",
              marginBottom: 0,
            }}
          >
            The whole point of this pipeline is a clean, cited, surgically-
            inserted information flow &mdash; every claim on the generated
            site traces to a real source. The wizard validates that Stitch
            preserves every citation token verbatim across each pass.
            <br />
            <br />
            But the wizard can&apos;t stop you from asking Stitch to{" "}
            <em>rewrite</em> the content via this textbox. Doing that
            violates the project&apos;s principles. Keep your requests to
            aesthetics (palette, spacing, motifs, animation, layout) and let
            the fact-checked content stand as written.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
          placeholder="e.g. 'more atmospheric hero', 'tighten the facts grid', 'palette more cyan', 'add a wireframe glyph to each action card'"
          rows={2}
          className="field-textarea flex-1"
          disabled={isPending}
        />
        <Button type="submit" disabled={!text.trim() || isPending}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </form>

      {helperText && (
        <p
          className="t-mono mt-2"
          style={{
            color: "var(--ink-4)",
            fontSize: 10.5,
            letterSpacing: "0.06em",
            lineHeight: 1.5,
          }}
        >
          {helperText}
        </p>
      )}

      {lastError && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {lastError}
        </pre>
      )}
    </div>
  );
}

function PaintbrushIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 17 Q 6 14 9 11 L 14 6 L 16 8 L 11 13 Q 8 16 5 18 Z"
        stroke="var(--amber)"
        strokeWidth="1.25"
        fill="none"
      />
      <path
        d="M14 6 L 17 3 L 19 5 L 16 8"
        stroke="var(--amber)"
        strokeWidth="1.25"
        fill="none"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Preview iframe — loaded from injected_html via the trpc previewHtml query
// ─────────────────────────────────────────────────────────────────────────

function StitchPreviewIframe({ runId }: { runId: string }) {
  const preview = trpc.stitch.previewHtml.useQuery({ runId });
  if (preview.isLoading) {
    return (
      <p
        className="t-mono mb-4"
        style={{
          color: "var(--ink-4)",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        Loading preview…
      </p>
    );
  }
  if (preview.error) {
    return (
      <pre className="code-block mb-4" style={{ color: "var(--bad)" }}>
        {preview.error.message}
      </pre>
    );
  }
  if (!preview.data?.html) {
    return (
      <p
        className="t-mono mb-4"
        style={{
          color: "var(--ink-4)",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        No injected HTML yet.
      </p>
    );
  }
  return (
    <iframe
      srcDoc={preview.data.html}
      style={{
        width: "100%",
        minHeight: 600,
        border: "1px solid var(--rule)",
        borderRadius: 2,
        background: "var(--bg-0)",
        marginBottom: 16,
      }}
      title="Stitch-generated site preview"
    />
  );
}
