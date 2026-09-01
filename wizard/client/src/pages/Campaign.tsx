import { Link, useParams } from "wouter";
import { useEffect } from "react";
import { trpc } from "../lib/trpc";
import { Button, Frame, HashRule, Pill, SectionMark } from "../components/ui";
import { StitchDesignPanel } from "../components/StitchDesignPanel";

export function Campaign() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const utils = trpc.useUtils();
  const campaign = trpc.campaigns.get.useQuery({ id: campaignId });
  const queryList = trpc.production.queryList.useQuery();

  const productionRun = trpc.production.latestForCampaign.useQuery(
    { campaignId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        if (!s) return false;
        if (s === "complete" || s === "error") return false;
        return 4_000;
      },
      refetchOnWindowFocus: false,
    }
  );

  const startProduction = trpc.production.start.useMutation({
    onSuccess: () => {
      utils.production.latestForCampaign.invalidate({ campaignId });
    },
  });

  // When production completes, refresh the campaign to pick up outputs + stage.
  useEffect(() => {
    if (productionRun.data?.status === "complete") {
      utils.campaigns.get.invalidate({ id: campaignId });
    }
  }, [productionRun.data?.status, utils, campaignId]);

  if (campaign.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
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
      </div>
    );
  }
  if (campaign.isError || !campaign.data) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <pre className="code-block mb-4" style={{ color: "var(--bad)" }}>
          Campaign not found.
        </pre>
        <Link href="/" className="link-amber">
          ← Back home
        </Link>
      </div>
    );
  }

  const c = campaign.data;
  const isLocked = c.stage !== "intake";
  const hasOutputs = c.outputs && Object.keys(c.outputs).length > 0;
  const run = productionRun.data;
  const runInFlight = run && run.status !== "complete" && run.status !== "error";

  return (
    <div className="max-w-3xl mx-auto px-6 pt-8 pb-20">
      <Link
        href="/"
        className="t-mono"
        style={{
          color: "var(--ink-4)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textDecoration: "none",
        }}
      >
        ← All campaigns
      </Link>

      <div className="flex items-center gap-3 mt-2 mb-2 flex-wrap">
        <h1
          className="t-display"
          style={{
            fontSize: "clamp(28px, 4vw, 44px)",
            color: "var(--ink)",
            lineHeight: 1.0,
          }}
        >
          {c.title}
        </h1>
        <Pill tone={c.stage === "complete" ? "ok" : "neutral"}>{c.stage}</Pill>
      </div>
      <HashRule className="mt-6 mb-8" />

      {!isLocked && (
        <Frame as="section" className="p-5 mb-7">
          <p
            className="prose-body"
            style={{ fontSize: 14, marginBottom: 0 }}
          >
            Campaign is still in intake.{" "}
            <Link
              href={`/campaign/${c.id}/intake`}
              className="link-amber"
              style={{ fontWeight: 500 }}
            >
              Continue the intake chat →
            </Link>{" "}
            to lock it in.
          </p>
        </Frame>
      )}

      {isLocked && (
        <Frame as="section" className="p-7 mb-7 space-y-4">
          <SectionMark>§ Locked campaign</SectionMark>
          <Field label="Project name" value={c.project_name} />
          <Field label="Mission" value={c.project_mission} />
          <Field label="Locale" value={c.locale} />
          <Field label="Issue type" value={c.issue_type} />
          {c.tier_examples && (
            <div>
              <div className="field-label">Tier examples</div>
              <div
                className="space-y-1.5"
                style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}
              >
                <div>
                  <span
                    className="t-mono"
                    style={{ color: "var(--amber)", marginRight: 8 }}
                  >
                    T1
                  </span>
                  {c.tier_examples.tier_1}
                </div>
                <div>
                  <span
                    className="t-mono"
                    style={{ color: "var(--amber)", marginRight: 8 }}
                  >
                    T2
                  </span>
                  {c.tier_examples.tier_2}
                </div>
                <div>
                  <span
                    className="t-mono"
                    style={{ color: "var(--amber)", marginRight: 8 }}
                  >
                    T3
                  </span>
                  {c.tier_examples.tier_3}
                </div>
              </div>
            </div>
          )}
          {c.notebook_id && (
            <div
              className="pt-3"
              style={{ borderTop: "1px solid var(--rule)" }}
            >
              <div className="field-label">Notebook</div>
              <code
                className="code-inline"
                style={{ wordBreak: "break-all" }}
              >
                {c.notebook_id}
              </code>
            </div>
          )}
        </Frame>
      )}

      {isLocked && (
        <Frame as="section" className="p-7 mb-7">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <SectionMark>§ Site production</SectionMark>
            <div className="flex-1" />
            {run && (
              <Pill
                tone={
                  run.status === "complete"
                    ? "ok"
                    : run.status === "error"
                    ? "bad"
                    : "warn"
                }
              >
                {run.status}
              </Pill>
            )}
          </div>

          {!c.notebook_id && (
            <p
              className="prose-body"
              style={{ fontSize: 14, color: "var(--warn)" }}
            >
              No notebook attached. Re-create the campaign via Pick-for-me on
              Home so a per-location NotebookLM notebook is linked.
            </p>
          )}

          {c.notebook_id && !run && (
            <>
              <p
                className="prose-body mb-5"
                style={{ fontSize: 14, lineHeight: 1.6 }}
              >
                Configures the Trust Server persona on the notebook, then runs{" "}
                {queryList.data?.length ?? 6} site-section queries against your
                research. Takes ~5-10 minutes. The result is a single-page
                advocacy site you can preview and download.
              </p>
              <Button
                onClick={() => startProduction.mutate({ campaignId })}
                disabled={startProduction.isPending}
                arrow
              >
                {startProduction.isPending ? "Starting" : "Start site production"}
              </Button>
              {startProduction.error && (
                <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
                  {startProduction.error.message}
                </pre>
              )}
            </>
          )}

          {run && (
            <ProductionRunCard
              run={run}
              queryList={queryList.data ?? []}
              campaignId={campaignId}
            />
          )}

          {!runInFlight && c.notebook_id && run && (
            <div
              className="mt-5 pt-5 flex items-center gap-3 flex-wrap"
              style={{ borderTop: "1px solid var(--rule)" }}
            >
              <Button
                variant="ghost"
                onClick={() => startProduction.mutate({ campaignId })}
                disabled={startProduction.isPending}
              >
                {startProduction.isPending
                  ? "Re-running"
                  : run.status === "error"
                  ? "Retry production"
                  : "Re-run production"}
              </Button>
              <span
                className="t-mono"
                style={{
                  color: "var(--ink-4)",
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {run.status === "error"
                  ? "Starts a fresh production run from the same notebook."
                  : "Generates a fresh set of sections from the same notebook."}
              </span>
              {startProduction.error && (
                <pre className="code-block mt-2" style={{ color: "var(--bad)" }}>
                  {startProduction.error.message}
                </pre>
              )}
            </div>
          )}
        </Frame>
      )}

      {hasOutputs && (
        <>
          <StitchDesignPanel
            campaignId={campaignId}
            campaignName={c.project_name ?? c.title}
          />
          <HashRule className="mb-6" />
          <PreviewSection
            campaignId={campaignId}
            campaignName={c.project_name ?? c.title}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div
        style={{
          fontSize: 14,
          color: "var(--ink)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {value ?? <span style={{ color: "var(--ink-4)" }}>(not set)</span>}
      </div>
    </div>
  );
}

interface ProductionRunCardProps {
  run: {
    id: string;
    status: string;
    progress: string;
    current_query?: string;
    outputs: Record<string, string>;
    error?: string;
  };
  queryList: Array<{ key: string; label: string }>;
  campaignId: string;
}

function ProductionRunCard({
  run,
  queryList,
  campaignId: _campaignId,
}: ProductionRunCardProps) {
  const isError = run.status === "error";
  const isComplete = run.status === "complete";
  const completedKeys = new Set(Object.keys(run.outputs));

  return (
    <div className="mt-3">
      <p
        className="prose-body mb-4"
        style={{
          fontSize: 14,
          color: isError ? "var(--bad)" : "var(--ink-2)",
          whiteSpace: "pre-wrap",
        }}
      >
        {isError ? run.error || "Failed" : run.progress}
      </p>

      {queryList.length > 0 && (
        <ul className="space-y-1.5 mb-4" style={{ listStyle: "none", padding: 0 }}>
          {queryList.map((q) => {
            const done = completedKeys.has(q.key);
            const active = run.current_query === q.key && !isComplete && !isError;
            return (
              <li
                key={q.key}
                className="flex items-center gap-3 t-mono"
                style={{ fontSize: 12.5, lineHeight: 1.4 }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    width: 16,
                    height: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: done
                      ? "var(--amber)"
                      : active
                      ? "var(--amber-glow)"
                      : "var(--ink-4)",
                  }}
                >
                  {done ? "■" : active ? "◐" : "□"}
                </span>
                <span
                  style={{
                    color: done
                      ? "var(--ink)"
                      : active
                      ? "var(--amber-glow)"
                      : "var(--ink-4)",
                    fontFamily: "Inter, sans-serif",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {q.label}
                </span>
                {active && <span className="pulse-dot" style={{ marginLeft: 4 }} />}
              </li>
            );
          })}
        </ul>
      )}

      {Object.keys(run.outputs).length > 0 && (
        <details
          className="mb-2"
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
            Raw section outputs ({Object.keys(run.outputs).length})
          </summary>
          <div className="mt-3 space-y-4">
            {queryList
              .filter((q) => run.outputs[q.key])
              .map((q) => (
                <div key={q.key}>
                  <div className="field-label">{q.label}</div>
                  <pre className="code-block">{run.outputs[q.key]}</pre>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PreviewSection({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const utils = trpc.useUtils();
  const preview = trpc.production.previewHtml.useQuery({ campaignId });
  const downloadUrl = `/api/download/${campaignId}`;

  const resolveCitations = trpc.production.resolveCitations.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id: campaignId });
      utils.production.previewHtml.invalidate({ campaignId });
    },
  });

  return (
    <Frame as="section" className="p-7 mb-6">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SectionMark>§ Default template · fallback</SectionMark>
        <Pill>always free</Pill>
        <div className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => resolveCitations.mutate({ campaignId })}
          disabled={resolveCitations.isPending}
          title="Re-run only the citation→source-URL resolution step against the existing outputs (≈30-60s)"
        >
          {resolveCitations.isPending ? "Linking" : "Re-link citations"}
        </Button>
        <a href={downloadUrl} download className="btn-ghost">
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
      </div>
      <p
        className="prose-body mb-3"
        style={{ fontSize: 13.5, lineHeight: 1.6 }}
      >
        Default site template for {campaignName} &mdash; the always-available
        baseline. Use this when Stitch is unconfigured, fails validation, or
        you prefer the wizard&apos;s canonical look. Single self-contained
        HTML; Tailwind via CDN; drop on any static host.
      </p>
      {resolveCitations.data && (
        <p
          className="t-mono mb-3"
          style={{
            fontSize: 11,
            color: "var(--ok)",
            letterSpacing: "0.06em",
          }}
        >
          Linked {resolveCitations.data.linkedCount} citation
          {resolveCitations.data.linkedCount === 1 ? "" : "s"} to source URLs.
        </p>
      )}
      {resolveCitations.error && (
        <pre className="code-block mb-3" style={{ color: "var(--bad)" }}>
          {resolveCitations.error.message}
        </pre>
      )}
      {preview.isLoading && (
        <p
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          Assembling preview…
        </p>
      )}
      {preview.error && (
        <pre className="code-block" style={{ color: "var(--bad)" }}>
          {preview.error.message}
        </pre>
      )}
      {preview.data && (
        <iframe
          srcDoc={preview.data.html}
          style={{
            width: "100%",
            minHeight: 600,
            border: "1px solid var(--rule)",
            borderRadius: 2,
            background: "var(--bg-0)",
          }}
          title="Site preview"
        />
      )}
    </Frame>
  );
}
