import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { LockReviewPanel } from "../components/LockReviewPanel";
import { Button, Frame, HashRule, Pill, SectionMark } from "../components/ui";
import type {
  CampaignLockProposal,
  FrameworkRunProposal,
} from "../../../shared/types";

type ResearchMode = "fast" | "deep";

export function Home() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const campaigns = trpc.campaigns.list.useQuery();

  // ─── "Pick for me" state ──────────────────────────────────────────
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<ResearchMode>("fast");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [editedProposal, setEditedProposal] =
    useState<CampaignLockProposal | null>(null);

  const startFrameworkRun = trpc.bridge.startFrameworkRun.useMutation({
    onSuccess: (data) => {
      setCurrentRunId(data.id);
      setEditedProposal(null);
    },
  });

  const run = trpc.bridge.getFrameworkRun.useQuery(
    { id: currentRunId ?? "" },
    {
      enabled: !!currentRunId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (!s) return 3_000;
        if (s === "complete" || s === "error") return false;
        return 4_000;
      },
      refetchOnWindowFocus: false,
    }
  );

  // When a run completes, parse its proposal JSON and seed the editor.
  const runData = run.data;
  const parsedProposal: FrameworkRunProposal | null = (() => {
    if (!runData || runData.status !== "complete" || !runData.proposal) return null;
    try {
      return JSON.parse(runData.proposal) as FrameworkRunProposal;
    } catch {
      return null;
    }
  })();

  // Seed editedProposal once when the run reaches complete.
  if (parsedProposal && editedProposal === null) {
    const stripped: CampaignLockProposal = {
      project_name: parsedProposal.project_name,
      project_mission: parsedProposal.project_mission,
      locale: parsedProposal.locale,
      issue_type: parsedProposal.issue_type,
      tier_examples: parsedProposal.tier_examples,
    };
    setEditedProposal(stripped);
  }

  const createFromProposal = trpc.campaigns.createFromProposal.useMutation({
    onSuccess: (campaign) => {
      utils.campaigns.list.invalidate();
      navigate(`/campaign/${campaign.id}`);
    },
  });

  const frameworkConfigured = settings.data?.frameworkNotebookId != null;

  const handleFindForMe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) return;
    startFrameworkRun.mutate({ location: location.trim(), mode });
  };

  const handleCancelRun = () => {
    setCurrentRunId(null);
    setEditedProposal(null);
  };

  const handleAccept = () => {
    if (!editedProposal) return;
    createFromProposal.mutate({
      proposal: editedProposal,
      frameworkRunId: currentRunId ?? undefined,
    });
  };

  // ─── "Start with your own idea" state ─────────────────────────────
  const [title, setTitle] = useState("");
  const create = trpc.campaigns.create.useMutation({
    onSuccess: (c) => {
      utils.campaigns.list.invalidate();
      navigate(`/campaign/${c.id}/intake`);
    },
  });
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title: title.trim() });
  };

  return (
    <div className="max-w-4xl mx-auto px-6 pt-12 pb-20">
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionMark className="mb-5">§ 00 / Wizard home</SectionMark>
        <h1
          className="t-display mb-5"
          style={{
            fontSize: "clamp(34px, 5vw, 60px)",
            lineHeight: 1.0,
            color: "var(--ink)",
          }}
        >
          From a local idea to a{" "}
          <span style={{ color: "var(--amber)" }}>fact-checked</span>{" "}
          advocacy site.
        </h1>
        <p
          className="prose-body"
          style={{ maxWidth: "62ch", fontSize: 16, marginBottom: 0 }}
        >
          The wizard walks a local-issue prompt through framework-driven vacuum
          identification, NotebookLM deep research, and source-linked editorial
          checks &mdash; producing a single-file advocacy site with
          hash-citation hover tooltips traceable to every source.
        </p>
        <HashRule className="mt-10" />
      </section>

      {/* ── PICK FOR ME ────────────────────────────────────────────────── */}
      <Frame as="section" className="p-7 mb-7">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <SectionMark>§ 01 / Pick for me</SectionMark>
          <div className="flex-1" />
          {frameworkConfigured ? (
            <Pill tone="ok">Framework ready</Pill>
          ) : (
            <Pill tone="warn">Framework not set up</Pill>
          )}
        </div>
        <h2
          className="t-display mb-3"
          style={{
            fontSize: "clamp(22px, 2.6vw, 30px)",
            color: "var(--ink)",
          }}
        >
          Give me a location.
        </h2>
        <p
          className="prose-body mb-5"
          style={{ fontSize: 14, lineHeight: 1.6 }}
        >
          The Framework notebook translates your location into a research
          query, fresh NotebookLM research runs against the area, and the
          Vacuum Identifier proposes a Campaign grounded in actual evidence.
        </p>

        {!frameworkConfigured && (
          <div
            className="mb-5 p-3"
            style={{
              background: "oklch(0.22 0.04 75 / 0.35)",
              border: "1px solid oklch(0.45 0.10 75 / 0.5)",
              borderRadius: 2,
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          >
            Framework notebook isn&apos;t configured yet.{" "}
            <Link href="/settings" className="link-amber">
              Set it up on the Settings page
            </Link>{" "}
            before using this flow.
          </div>
        )}

        {!currentRunId && (
          <>
            <form onSubmit={handleFindForMe} className="flex gap-2 mb-4">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder='e.g. "Kingman, Arizona" · "Paradise, California" · "Tunica County, Mississippi"'
                className="field-input flex-1"
                maxLength={200}
                disabled={startFrameworkRun.isPending || !frameworkConfigured}
              />
              <Button
                type="submit"
                arrow
                disabled={
                  !location.trim() ||
                  startFrameworkRun.isPending ||
                  !frameworkConfigured
                }
              >
                {startFrameworkRun.isPending ? "Starting" : "Find vacuum"}
              </Button>
            </form>
            <div className="flex items-center gap-5 flex-wrap">
              <span
                className="t-mono"
                style={{
                  color: "var(--ink-4)",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Research mode
              </span>
              <label className="field-radio">
                <input
                  type="radio"
                  name="mode"
                  value="fast"
                  checked={mode === "fast"}
                  onChange={() => setMode("fast")}
                  disabled={startFrameworkRun.isPending}
                />
                <span>Fast (~3-5 min)</span>
              </label>
              <label className="field-radio">
                <input
                  type="radio"
                  name="mode"
                  value="deep"
                  checked={mode === "deep"}
                  onChange={() => setMode("deep")}
                  disabled={startFrameworkRun.isPending}
                />
                <span>Deep (~20-30 min, more thorough)</span>
              </label>
            </div>
            {startFrameworkRun.error && (
              <pre
                className="code-block mt-4"
                style={{ color: "var(--bad)" }}
              >
                {startFrameworkRun.error.message}
              </pre>
            )}
          </>
        )}

        {currentRunId && runData && (
          <FrameworkRunCard
            runData={runData}
            parsedProposal={parsedProposal}
            editedProposal={editedProposal}
            onEditProposal={setEditedProposal}
            onCancel={handleCancelRun}
            onAccept={handleAccept}
            isCreating={createFromProposal.isPending}
            createError={createFromProposal.error?.message}
          />
        )}
      </Frame>

      {/* ── START WITH YOUR OWN IDEA ───────────────────────────────────── */}
      <Frame as="section" className="p-7 mb-7">
        <SectionMark className="mb-3">§ 02 / Start with your own idea</SectionMark>
        <h2
          className="t-display mb-3"
          style={{
            fontSize: "clamp(22px, 2.6vw, 30px)",
            color: "var(--ink)",
          }}
        >
          Have a vacuum in mind already?
        </h2>
        <p
          className="prose-body mb-5"
          style={{ fontSize: 14, lineHeight: 1.6 }}
        >
          Give the campaign a working title. The intake guide will sharpen it
          through chat before locking in the campaign.
        </p>
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='e.g. "Protect Cedar Creek"'
            className="field-input flex-1"
            maxLength={120}
          />
          <Button
            type="submit"
            variant="ghost"
            disabled={!title.trim() || create.isPending}
          >
            {create.isPending ? "Creating" : "Open intake"}
          </Button>
        </form>
        {create.error && (
          <pre className="code-block mt-4" style={{ color: "var(--bad)" }}>
            {create.error.message}
          </pre>
        )}
      </Frame>

      {/* ── IN PROGRESS ─────────────────────────────────────────────────── */}
      <Frame as="section" className="p-7 mb-7">
        <div className="flex items-center mb-5">
          <SectionMark>§ 03 / In progress</SectionMark>
          <div className="flex-1" />
          {campaigns.data && (
            <span
              className="t-mono"
              style={{
                color: "var(--ink-4)",
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {campaigns.data.length} campaign
              {campaigns.data.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {campaigns.isLoading && (
          <p
            className="t-mono"
            style={{
              color: "var(--ink-4)",
              fontSize: 12,
              fontStyle: "italic",
            }}
          >
            Loading…
          </p>
        )}
        {campaigns.data && campaigns.data.length === 0 && (
          <p
            className="prose-body"
            style={{
              fontSize: 13,
              color: "var(--ink-4)",
              fontStyle: "italic",
            }}
          >
            No campaigns yet. Start one above.
          </p>
        )}
        {campaigns.data && campaigns.data.length > 0 && (
          <ul style={{ borderTop: "1px solid var(--rule)" }}>
            {campaigns.data.map((c) => (
              <li
                key={c.id}
                className="py-3 flex items-center gap-3"
                style={{ borderBottom: "1px solid var(--rule)" }}
              >
                <Link
                  href={`/campaign/${c.id}`}
                  className="flex-1 no-underline"
                  style={{ color: "var(--ink)" }}
                >
                  <span style={{ fontWeight: 500 }}>{c.title}</span>
                </Link>
                <Pill>{c.stage}</Pill>
                <span
                  className="t-mono"
                  style={{ color: "var(--ink-4)", fontSize: 10.5 }}
                >
                  {new Date(c.updated_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Frame>

      {/* ── SETUP CHECKLIST ─────────────────────────────────────────────── */}
      <section>
        <SectionMark className="mb-4">§ 04 / Setup checklist</SectionMark>
        <ol
          className="space-y-3"
          style={{
            color: "var(--ink-2)",
            fontSize: 14,
            lineHeight: 1.65,
            listStyle: "none",
            paddingLeft: 0,
          }}
        >
          <ChecklistItem n="01">
            Configure an LLM provider on the{" "}
            <Link href="/settings" className="link-amber">
              Settings page
            </Link>
            .
          </ChecklistItem>
          <ChecklistItem n="02">
            Authenticate to NotebookLM. The Settings page surfaces a{" "}
            <span style={{ color: "var(--ink)" }}>Re-authenticate</span>{" "}
            button when the session cookie expires.
          </ChecklistItem>
          <ChecklistItem n="03">
            Set up the Framework Notebook on the Settings page (required for
            &ldquo;Pick for me&rdquo;).
          </ChecklistItem>
        </ol>
      </section>
    </div>
  );
}

function ChecklistItem({
  n,
  children,
}: {
  n: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 items-baseline">
      <span
        className="t-mono"
        style={{
          color: "var(--amber)",
          fontSize: 11,
          letterSpacing: "0.14em",
          flex: "0 0 32px",
        }}
      >
        [{n}]
      </span>
      <span style={{ flex: 1 }}>{children}</span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FrameworkRunCard — progress + result UI for an in-flight Pick-for-me run
// ─────────────────────────────────────────────────────────────────────────

const STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: "translating", label: "Translate location" },
  { key: "researching", label: "Research the area" },
  { key: "identifying", label: "Identify vacuum" },
  { key: "complete", label: "Review proposal" },
];

interface FrameworkRunCardProps {
  runData: {
    id: string;
    status: string;
    location: string;
    mode: "deep" | "fast";
    progress: string;
    research_query?: string;
    error?: string;
  };
  parsedProposal: FrameworkRunProposal | null;
  editedProposal: CampaignLockProposal | null;
  onEditProposal: (p: CampaignLockProposal) => void;
  onCancel: () => void;
  onAccept: () => void;
  isCreating: boolean;
  createError?: string;
}

function FrameworkRunCard({
  runData,
  parsedProposal,
  editedProposal,
  onEditProposal,
  onCancel,
  onAccept,
  isCreating,
  createError,
}: FrameworkRunCardProps) {
  const isError = runData.status === "error";
  const isComplete = runData.status === "complete";
  const stageIndex = STAGE_STEPS.findIndex((s) => s.key === runData.status);

  return (
    <div
      className="mt-3 p-5"
      style={{
        background: "oklch(0.115 0.010 60 / 0.6)",
        border: "1px solid var(--rule)",
        borderRadius: 2,
      }}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className="t-mono"
          style={{
            color: "var(--ink)",
            fontSize: 12,
            letterSpacing: "0.06em",
          }}
        >
          {runData.location}
        </span>
        <Pill tone={isError ? "bad" : isComplete ? "ok" : "warn"}>
          {runData.mode}
        </Pill>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="link-amber t-mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            background: "transparent",
            border: 0,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        {STAGE_STEPS.map((step, i) => {
          const done = isComplete
            ? i <= STAGE_STEPS.length - 1
            : stageIndex >= 0 && i < stageIndex;
          const active = !isError && stageIndex === i;
          const color = done
            ? "var(--amber)"
            : active
            ? "var(--amber-deep)"
            : isError && i === stageIndex
            ? "var(--bad)"
            : "var(--rule)";
          return (
            <div
              key={step.key}
              title={step.label}
              style={{
                height: 2,
                flex: 1,
                background: color,
                opacity: active ? 0.65 : 1,
                animation: active ? "pulse-amber 1.8s ease-in-out infinite" : "none",
              }}
            />
          );
        })}
      </div>

      <p
        className="prose-body mb-3"
        style={{
          fontSize: 13.5,
          color: isError ? "var(--bad)" : "var(--ink-2)",
          whiteSpace: "pre-wrap",
        }}
      >
        {isError ? runData.error || "Failed" : runData.progress}
      </p>

      {runData.research_query && (
        <details
          className="mb-3"
          style={{ fontSize: 12, color: "var(--ink-3)" }}
        >
          <summary
            className="link-amber"
            style={{
              cursor: "pointer",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            Research query
          </summary>
          <pre className="code-block mt-2">{runData.research_query}</pre>
        </details>
      )}

      {isComplete && parsedProposal && (
        <div className="space-y-4">
          {parsedProposal.rationale && (
            <div>
              <div className="field-label">Why this vacuum</div>
              <p
                className="prose-body"
                style={{
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                }}
              >
                {parsedProposal.rationale}
              </p>
            </div>
          )}
          {parsedProposal.source_summary && (
            <div>
              <div className="field-label">Sources drawn from</div>
              <p
                className="prose-body"
                style={{
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                }}
              >
                {parsedProposal.source_summary}
              </p>
            </div>
          )}
          {editedProposal && (
            <LockReviewPanel
              proposal={editedProposal}
              onChange={onEditProposal}
              onCancel={onCancel}
              onConfirm={onAccept}
              isLocking={isCreating}
              lockError={createError}
              title="Proposed Campaign"
              subtitle="Edit anything below, then accept to create the campaign at the research stage."
              confirmLabel="Accept & start"
            />
          )}
        </div>
      )}

      {isError && (
        <Button variant="ghost" onClick={onCancel}>
          Try again
        </Button>
      )}
    </div>
  );
}
