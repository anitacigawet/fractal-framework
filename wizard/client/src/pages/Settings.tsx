import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button, Frame, HashRule, Pill, SectionMark } from "../components/ui";

type ProviderId = "gemini" | "openai" | "deepseek";

type ProviderSnapshot = {
  id: ProviderId;
  displayName: string;
  model: string;
  modelFromEnv: boolean;
  hasKey: boolean;
  keyFromEnv: boolean;
};

export function Settings() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();

  const setActiveProvider = trpc.settings.setActiveProvider.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });

  if (settings.isLoading) {
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
          Loading settings…
        </p>
      </div>
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <pre className="code-block" style={{ color: "var(--bad)" }}>
          Failed to load settings.
        </pre>
      </div>
    );
  }

  const data = settings.data;

  return (
    <div className="max-w-3xl mx-auto px-6 pt-12 pb-20">
      <section className="mb-12">
        <SectionMark className="mb-5">§ 00 / Settings</SectionMark>
        <h1
          className="t-display mb-4"
          style={{
            fontSize: "clamp(30px, 4.6vw, 52px)",
            lineHeight: 1.0,
            color: "var(--ink)",
          }}
        >
          Wizard configuration.
        </h1>
        <p
          className="prose-body"
          style={{ maxWidth: "60ch", fontSize: 15, marginBottom: 0 }}
        >
          Configure the LLM provider used for the intake chat, the Framework
          Notebook used for &ldquo;Pick for me,&rdquo; and the NotebookLM
          bridge that drives research and production. Env vars override saved
          values; locked fields are noted inline.
        </p>
        <HashRule className="mt-10" />
      </section>

      <HealthCheckCard />
      <HealthCheckCard />
      <FrameworkNotebookCard
        notebookId={data.frameworkNotebookId}
        fromEnv={data.frameworkNotebookIdFromEnv}
      />
      <BridgeStatusCard />
      <StitchCard stitch={data.stitch} />

      <Frame as="section" className="p-7 mb-6">
        <SectionMark className="mb-3">§ 02 / Active provider</SectionMark>
        <h2
          className="t-display mb-2"
          style={{ fontSize: 22, color: "var(--ink)" }}
        >
          Which provider drives intake chat.
        </h2>
        <p
          className="prose-body mb-5"
          style={{ fontSize: 13.5, lineHeight: 1.6 }}
        >
          The selected provider runs the intake conversation, the
          &ldquo;Pick for me&rdquo; vacuum extractor, and the production-time
          field extraction.
        </p>
        <div className="space-y-2.5">
          {data.providers.map((p) => (
            <label key={p.id} className="field-radio">
              <input
                type="radio"
                name="activeProvider"
                checked={data.activeProvider === p.id}
                disabled={data.activeProviderFromEnv}
                onChange={() => setActiveProvider.mutate({ provider: p.id })}
              />
              <span style={{ color: "var(--ink)" }}>{p.displayName}</span>
              {data.activeProvider === p.id && (
                <span
                  className="t-mono"
                  style={{
                    color: "var(--amber)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    marginLeft: 6,
                  }}
                >
                  active
                </span>
              )}
            </label>
          ))}
        </div>
        {data.activeProviderFromEnv && (
          <p
            className="prose-body mt-4"
            style={{ fontSize: 12, color: "var(--warn)" }}
          >
            Locked by env var{" "}
            <code className="code-inline">LLM_PROVIDER</code>.
          </p>
        )}
      </Frame>

      {data.providers.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}
    </div>
  );
}

function HealthCheckCard() {
  const runCheck = trpc.settings.runHealthCheck.useMutation();
  const data = runCheck.data;

  const overallPill = data
    ? data.overall === "ok"
      ? <Pill tone="ok">All clear</Pill>
      : data.overall === "warn"
      ? <Pill tone="warn">Needs attention</Pill>
      : <Pill tone="bad">Issues found</Pill>
    : null;

  return (
    <Frame as="section" className="p-7 mb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectionMark>§ 00a / System check</SectionMark>
        <div className="flex-1" />
        {overallPill}
      </div>
      <h2
        className="t-display mb-2"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        Is everything ready to run?
      </h2>
      <p
        className="prose-body mb-5"
        style={{ fontSize: 13.5, lineHeight: 1.6 }}
      >
        Probes each piece the wizard needs &mdash; the LLM provider, the
        NotebookLM bridge, the Framework Notebook, and the Stitch key &mdash;
        and reports back. Run this once before starting a real campaign so you
        catch a missing API key or expired NotebookLM cookie before you&apos;ve
        sunk thirty minutes into a run.
      </p>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <Button
          onClick={() => runCheck.mutate()}
          disabled={runCheck.isPending}
          arrow
        >
          {runCheck.isPending ? "Probing" : "Run system check"}
        </Button>
        {data?.ranAt && (
          <span
            className="t-mono"
            style={{
              color: "var(--ink-4)",
              fontSize: 10.5,
              letterSpacing: "0.06em",
            }}
          >
            last run · {new Date(data.ranAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {data && (
        <ul
          className="space-y-2"
          style={{ listStyle: "none", padding: 0 }}
        >
          {data.checks.map((c) => (
            <li
              key={c.key}
              className="flex items-start gap-3 p-3"
              style={{
                background: "oklch(0.115 0.010 60 / 0.6)",
                border: "1px solid var(--rule)",
                borderRadius: 2,
              }}
            >
              <HealthStatusGlyph status={c.status} />
              <div className="flex-1 min-w-0">
                <div
                  className="t-mono"
                  style={{
                    color: "var(--ink)",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    color:
                      c.status === "ok"
                        ? "var(--ok)"
                        : c.status === "bad"
                        ? "var(--bad)"
                        : c.status === "warn"
                        ? "var(--warn)"
                        : "var(--ink-3)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                  }}
                >
                  {c.message}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {runCheck.error && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {runCheck.error.message}
        </pre>
      )}
    </Frame>
  );
}

function HealthStatusGlyph({
  status,
}: {
  status: "ok" | "warn" | "bad" | "unconfigured";
}) {
  const color =
    status === "ok"
      ? "var(--ok)"
      : status === "bad"
      ? "var(--bad)"
      : status === "warn"
      ? "var(--warn)"
      : "var(--ink-4)";
  const glyph =
    status === "ok" ? "■" : status === "bad" ? "✕" : status === "warn" ? "▲" : "○";
  return (
    <span
      style={{
        display: "inline-flex",
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        color,
        fontSize: 14,
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      {glyph}
    </span>
  );
}

function FrameworkNotebookCard({
  notebookId,
  fromEnv,
}: {
  notebookId: string | null;
  fromEnv: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirmReset, setConfirmReset] = useState(false);

  const setup = trpc.bridge.setupFrameworkNotebook.useMutation({
    onSuccess: () => {
      utils.settings.get.invalidate();
      setConfirmReset(false);
    },
  });
  const clear = trpc.bridge.clearFrameworkNotebook.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });

  const isConfigured = !!notebookId;

  return (
    <Frame as="section" className="p-7 mb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectionMark>§ 01a / Framework Notebook</SectionMark>
        <div className="flex-1" />
        {isConfigured ? (
          <Pill tone="ok">configured</Pill>
        ) : (
          <Pill tone="warn">not set up</Pill>
        )}
      </div>
      <h2
        className="t-display mb-2"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        The methodology-aware notebook.
      </h2>
      <p className="prose-body mb-4" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        Powers the &ldquo;Pick for me&rdquo; flow. The wizard creates a
        dedicated NotebookLM notebook, uploads the three core methodology docs
        from <code className="code-inline">docs/</code> as sources, and
        installs the Framework Translator persona on it. Give it a location;
        it returns a research query the downstream pipeline runs against a
        fresh per-location notebook.
      </p>

      {isConfigured && (
        <pre className="code-block mb-4" style={{ wordBreak: "break-all" }}>
          {notebookId}
        </pre>
      )}

      {fromEnv ? (
        <p style={{ fontSize: 12, color: "var(--warn)" }}>
          Locked by env var{" "}
          <code className="code-inline">FRAMEWORK_NOTEBOOK_ID</code>.
        </p>
      ) : !isConfigured ? (
        <Button onClick={() => setup.mutate()} disabled={setup.isPending} arrow>
          {setup.isPending ? "Setting up (~30-60s)" : "Set up Framework Notebook"}
        </Button>
      ) : (
        <div className="flex gap-2">
          {!confirmReset ? (
            <Button variant="ghost" onClick={() => setConfirmReset(true)}>
              Re-create
            </Button>
          ) : (
            <>
              <Button
                onClick={() => {
                  clear.mutate();
                  setup.mutate();
                }}
                disabled={setup.isPending || clear.isPending}
              >
                {setup.isPending ? "Re-creating" : "Confirm re-create"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmReset(false)}
                disabled={setup.isPending}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      {setup.isSuccess && (
        <p
          className="t-mono mt-3"
          style={{
            fontSize: 11,
            color: "var(--ok)",
            letterSpacing: "0.06em",
          }}
        >
          Setup complete. Uploaded {setup.data.uploadedDocs.length} methodology
          docs.
        </p>
      )}
      {setup.error && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {setup.error.message}
        </pre>
      )}
    </Frame>
  );
}

function BridgeStatusCard() {
  const utils = trpc.useUtils();
  const bridgeStatus = trpc.bridge.status.useQuery(
    { force: true },
    { refetchOnWindowFocus: false, retry: false }
  );

  const [reauthStage, setReauthStage] = useState<
    "idle" | "awaiting_confirm" | "done"
  >("idle");

  const startReauth = trpc.bridge.startReauth.useMutation({
    onSuccess: (data) => {
      if (data.spawned) setReauthStage("awaiting_confirm");
    },
  });
  const confirmReauth = trpc.bridge.confirmReauth.useMutation({
    onSuccess: () => {
      setReauthStage("done");
      utils.bridge.status.invalidate();
    },
  });

  const handleReauthStart = () => {
    setReauthStage("idle");
    startReauth.reset();
    confirmReauth.reset();
    startReauth.mutate();
  };

  const handleReauthConfirm = () => {
    confirmReauth.mutate();
  };

  const handleReauthDone = () => {
    setReauthStage("idle");
    startReauth.reset();
    confirmReauth.reset();
    bridgeStatus.refetch();
  };

  const authLooksBad =
    bridgeStatus.data &&
    !bridgeStatus.data.ok &&
    /Auth:\s+(expired|missing|unknown)/i.test(bridgeStatus.data.stdout);

  let statusPill: React.ReactNode = null;
  if (bridgeStatus.data) {
    if (bridgeStatus.data.ok) {
      statusPill = <Pill tone="ok">OK</Pill>;
    } else if (bridgeStatus.data.timedOut) {
      statusPill = <Pill tone="bad">timed out</Pill>;
    } else {
      statusPill = <Pill tone="bad">exit {bridgeStatus.data.exitCode}</Pill>;
    }
  }

  return (
    <Frame as="section" className="p-7 mb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectionMark>§ 01b / NotebookLM bridge</SectionMark>
        <div className="flex-1" />
        {statusPill}
        <button
          type="button"
          onClick={() => bridgeStatus.refetch()}
          disabled={bridgeStatus.isFetching}
          className="btn-ghost"
          style={{ padding: "6px 12px", fontSize: 10 }}
        >
          {bridgeStatus.isFetching ? "Probing" : "Re-probe"}
        </button>
      </div>
      <h2
        className="t-display mb-2"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        The Python engine that drives NotebookLM.
      </h2>
      <p className="prose-body mb-4" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        Required for research, source curation, and production. Authentication
        cookies persist for weeks once set; re-authenticate below when they
        expire.
      </p>

      {bridgeStatus.isLoading && (
        <p
          className="t-mono"
          style={{
            color: "var(--ink-4)",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          Probing bridge…
        </p>
      )}

      {bridgeStatus.data && (
        <>
          <pre
            className="code-block"
            style={{ maxHeight: 192, overflowY: "auto" }}
          >
            {bridgeStatus.data.stdout ||
              bridgeStatus.data.stderr ||
              "(no output)"}
          </pre>
          <div
            className="t-mono mt-2 flex items-center gap-4 flex-wrap"
            style={{ color: "var(--ink-4)", fontSize: 10 }}
          >
            <span>{bridgeStatus.data.durationMs}ms</span>
            <span style={{ wordBreak: "break-all" }}>
              cwd: {bridgeStatus.data.bridgeDir}
            </span>
          </div>
        </>
      )}

      {bridgeStatus.error && (
        <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
          {bridgeStatus.error.message}
        </pre>
      )}

      {/* Re-authentication flow */}
      {authLooksBad && (
        <div
          className="mt-5 pt-5"
          style={{ borderTop: "1px solid var(--rule)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className="t-mono"
              style={{
                color: "var(--amber)",
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              · Re-authenticate
            </span>
          </div>

          {reauthStage === "idle" && (
            <>
              <p
                className="prose-body mb-3"
                style={{ fontSize: 13, lineHeight: 1.6 }}
              >
                Click Re-authenticate. A Chromium window will open using your
                persistent NotebookLM profile. If you&apos;re already signed
                into Google there, the NotebookLM homepage may load right away
                &mdash; otherwise sign in. Once you see the NotebookLM
                homepage, click Confirm below. After this one-time setup,
                cookies persist for weeks.
              </p>
              <Button onClick={handleReauthStart} disabled={startReauth.isPending}>
                {startReauth.isPending ? "Spawning" : "Re-authenticate"}
              </Button>
            </>
          )}

          {reauthStage === "awaiting_confirm" && (
            <>
              <div
                className="p-4 mb-3"
                style={{
                  background: "oklch(0.22 0.04 75 / 0.35)",
                  border: "1px solid oklch(0.45 0.10 75 / 0.5)",
                  borderRadius: 2,
                }}
              >
                <p
                  style={{
                    fontWeight: 500,
                    fontSize: 13,
                    marginBottom: 6,
                    color: "var(--ink)",
                  }}
                >
                  Login subprocess running.
                </p>
                <ol
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                    listStyle: "decimal inside",
                    lineHeight: 1.7,
                  }}
                >
                  <li>Chromium window should be open now (check your taskbar).</li>
                  <li>
                    Sign in to Google if needed, then{" "}
                    <strong>wait until you actually see the NotebookLM
                    homepage</strong> in that window.
                  </li>
                  <li>Only then click Confirm below.</li>
                </ol>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--ink-4)",
                    marginTop: 8,
                  }}
                >
                  Clicking too early can save incomplete cookies. Better to
                  wait a few extra seconds.
                </p>
              </div>
              <Button
                onClick={handleReauthConfirm}
                disabled={confirmReauth.isPending}
                arrow
              >
                {confirmReauth.isPending
                  ? "Waiting for subprocess"
                  : "Confirm — NotebookLM homepage is loaded"}
              </Button>
            </>
          )}

          {reauthStage === "done" && confirmReauth.data && (
            <>
              <div
                className="p-4 mb-3"
                style={{
                  background: confirmReauth.data.confirmed
                    ? "oklch(0.24 0.04 150 / 0.4)"
                    : "oklch(0.24 0.06 30 / 0.4)",
                  border: `1px solid ${
                    confirmReauth.data.confirmed
                      ? "oklch(0.45 0.06 150 / 0.5)"
                      : "oklch(0.45 0.14 30 / 0.5)"
                  }`,
                  borderRadius: 2,
                }}
              >
                <p
                  style={{
                    fontWeight: 500,
                    fontSize: 13,
                    marginBottom: 6,
                    color: confirmReauth.data.confirmed
                      ? "var(--ok)"
                      : "var(--bad)",
                  }}
                >
                  {confirmReauth.data.confirmed
                    ? "Re-authentication succeeded."
                    : `Re-authentication did not succeed (exit ${confirmReauth.data.exitCode}).`}
                </p>
                {confirmReauth.data.output && (
                  <pre
                    className="code-block"
                    style={{
                      maxHeight: 128,
                      overflowY: "auto",
                      marginTop: 8,
                    }}
                  >
                    {confirmReauth.data.output}
                  </pre>
                )}
              </div>
              <Button variant="ghost" onClick={handleReauthDone}>
                Done
              </Button>
            </>
          )}

          {startReauth.data && !startReauth.data.spawned && (
            <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
              {startReauth.data.note}
            </pre>
          )}
          {startReauth.error && (
            <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
              {startReauth.error.message}
            </pre>
          )}
        </div>
      )}
    </Frame>
  );
}

type StitchSnapshot = {
  hasKey: boolean;
  keyFromEnv: boolean;
  model: "GEMINI_3_FLASH" | "GEMINI_3_PRO";
  modelFromEnv: boolean;
  availableModels: readonly ("GEMINI_3_FLASH" | "GEMINI_3_PRO")[];
  disclaimerDismissed: boolean;
};

function StitchCard({ stitch }: { stitch: StitchSnapshot }) {
  const utils = trpc.useUtils();
  const [keyInput, setKeyInput] = useState("");
  const [validation, setValidation] =
    useState<null | { ok: boolean; msg: string }>(null);

  const setKey = trpc.settings.setStitchApiKey.useMutation({
    onSuccess: () => {
      utils.settings.get.invalidate();
      setKeyInput("");
      setValidation(null);
    },
  });
  const setModel = trpc.settings.setStitchModel.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });
  const validate = trpc.settings.validateStitch.useMutation();

  const handleValidate = async () => {
    setValidation(null);
    const result = await validate.mutateAsync();
    setValidation(
      result.ok
        ? {
            ok: true,
            msg: `Valid — Stitch returned ${result.projectCount} accessible project${
              result.projectCount === 1 ? "" : "s"
            }.`,
          }
        : { ok: false, msg: result.error }
    );
  };

  return (
    <Frame as="section" className="p-7 mb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectionMark>§ 01c / Stitch · generated sites</SectionMark>
        <div className="flex-1" />
        {stitch.hasKey ? (
          <Pill tone="ok">
            key saved{stitch.keyFromEnv ? " (env)" : ""}
          </Pill>
        ) : (
          <Pill tone="warn">not configured</Pill>
        )}
      </div>
      <h2
        className="t-display mb-2"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        Per-campaign visual design.
      </h2>
      <p
        className="prose-body mb-5"
        style={{ fontSize: 13.5, lineHeight: 1.6 }}
      >
        Google Stitch generates per-campaign visual chrome around the wizard&apos;s
        fact-checked content. Each generation pass is validated to confirm
        every citation token survives intact. When Stitch is unconfigured or a
        run fails repeatedly, the wizard falls back to the default site
        template &mdash; the download is always available.
      </p>

      <div className="space-y-4">
        <div>
          <label className="field-label">API key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={stitch.keyFromEnv}
              placeholder={
                stitch.hasKey ? "(saved — type to replace)" : "paste STITCH_API_KEY"
              }
              className="field-input mono flex-1"
            />
            <Button
              variant="ghost"
              onClick={() => setKey.mutate({ apiKey: keyInput })}
              disabled={!keyInput || stitch.keyFromEnv || setKey.isPending}
            >
              {setKey.isPending ? "Saving" : "Save"}
            </Button>
          </div>
          {stitch.keyFromEnv && (
            <p style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>
              Locked by env var <code className="code-inline">STITCH_API_KEY</code>.
            </p>
          )}
        </div>

        <div>
          <label className="field-label">Model</label>
          <div className="flex gap-4 flex-wrap">
            {stitch.availableModels.map((m) => (
              <label key={m} className="field-radio">
                <input
                  type="radio"
                  name="stitchModel"
                  checked={stitch.model === m}
                  disabled={stitch.modelFromEnv}
                  onChange={() => setModel.mutate({ model: m })}
                />
                <span style={{ color: "var(--ink)" }}>{m}</span>
                {m === "GEMINI_3_FLASH" && (
                  <span
                    className="t-mono"
                    style={{
                      color: "var(--ink-4)",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      marginLeft: 4,
                    }}
                  >
                    faster · cheaper
                  </span>
                )}
                {m === "GEMINI_3_PRO" && (
                  <span
                    className="t-mono"
                    style={{
                      color: "var(--ink-4)",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      marginLeft: 4,
                    }}
                  >
                    slower · higher fidelity
                  </span>
                )}
              </label>
            ))}
          </div>
          {stitch.modelFromEnv && (
            <p style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>
              Locked by env var <code className="code-inline">STITCH_MODEL</code>.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <Button
            variant="ghost"
            onClick={handleValidate}
            disabled={!stitch.hasKey || validate.isPending}
          >
            {validate.isPending ? "Testing" : "Test key"}
          </Button>
          {validation && (
            <span
              style={{
                fontSize: 12,
                color: validation.ok ? "var(--ok)" : "var(--bad)",
                lineHeight: 1.5,
              }}
            >
              {validation.msg}
            </span>
          )}
        </div>
      </div>
    </Frame>
  );
}

function ProviderCard({ provider }: { provider: ProviderSnapshot }) {
  const utils = trpc.useUtils();
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(provider.model);
  const [validation, setValidation] =
    useState<null | { ok: boolean; msg: string }>(null);

  const setProviderKey = trpc.settings.setProviderKey.useMutation({
    onSuccess: () => {
      utils.settings.get.invalidate();
      setKeyInput("");
    },
  });
  const setProviderModel = trpc.settings.setProviderModel.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });
  const validateProvider = trpc.settings.validateProvider.useMutation();

  const handleValidate = async () => {
    setValidation(null);
    const result = await validateProvider.mutateAsync({ provider: provider.id });
    setValidation(
      result.ok
        ? { ok: true, msg: `Valid — provider replied: "${result.sample}"` }
        : { ok: false, msg: result.error }
    );
  };

  return (
    <Frame as="section" className="p-6 mb-4">
      <div className="flex items-baseline gap-2 mb-4 flex-wrap">
        <h2
          className="t-display"
          style={{ fontSize: 18, color: "var(--ink)" }}
        >
          {provider.displayName}
        </h2>
        {provider.hasKey && (
          <Pill tone="ok">
            key saved{provider.keyFromEnv ? " (env)" : ""}
          </Pill>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="field-label">API key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={provider.keyFromEnv}
              placeholder={
                provider.hasKey ? "(saved — type to replace)" : "paste API key"
              }
              className="field-input mono flex-1"
            />
            <Button
              variant="ghost"
              onClick={() =>
                setProviderKey.mutate({ provider: provider.id, apiKey: keyInput })
              }
              disabled={
                !keyInput || provider.keyFromEnv || setProviderKey.isPending
              }
            >
              {setProviderKey.isPending ? "Saving" : "Save"}
            </Button>
          </div>
          {provider.keyFromEnv && (
            <p
              style={{
                fontSize: 11,
                color: "var(--warn)",
                marginTop: 4,
              }}
            >
              Locked by env var.
            </p>
          )}
        </div>

        <div>
          <label className="field-label">Model</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              disabled={provider.modelFromEnv}
              className="field-input mono flex-1"
            />
            <Button
              variant="ghost"
              onClick={() =>
                setProviderModel.mutate({
                  provider: provider.id,
                  model: modelInput,
                })
              }
              disabled={
                modelInput === provider.model ||
                !modelInput ||
                provider.modelFromEnv ||
                setProviderModel.isPending
              }
            >
              {setProviderModel.isPending ? "Saving" : "Save"}
            </Button>
          </div>
          {provider.modelFromEnv && (
            <p
              style={{
                fontSize: 11,
                color: "var(--warn)",
                marginTop: 4,
              }}
            >
              Locked by env var.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <Button
            variant="ghost"
            onClick={handleValidate}
            disabled={!provider.hasKey || validateProvider.isPending}
          >
            {validateProvider.isPending ? "Testing" : "Test key"}
          </Button>
          {validation && (
            <span
              style={{
                fontSize: 12,
                color: validation.ok ? "var(--ok)" : "var(--bad)",
                lineHeight: 1.5,
              }}
            >
              {validation.msg}
            </span>
          )}
        </div>
      </div>
    </Frame>
  );
}
