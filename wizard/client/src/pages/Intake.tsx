import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { trpc } from "../lib/trpc";
import type { Message, CampaignLockProposal } from "../../../shared/types";
import { LockReviewPanel } from "../components/LockReviewPanel";
import { Button, Pill, SectionMark } from "../components/ui";

export function Intake() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const [, navigate] = useLocation();

  const utils = trpc.useUtils();
  const campaign = trpc.campaigns.get.useQuery({ id: campaignId });
  const greet = trpc.intake.greet.useMutation({
    onSuccess: () => utils.campaigns.get.invalidate({ id: campaignId }),
  });
  const sendMessage = trpc.intake.sendMessage.useMutation({
    onSuccess: () => utils.campaigns.get.invalidate({ id: campaignId }),
  });
  const proposeLock = trpc.intake.proposeLock.useMutation();
  const lock = trpc.intake.lock.useMutation({
    onSuccess: () => navigate(`/campaign/${campaignId}`),
  });

  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<CampaignLockProposal | null>(null);
  const greetedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // First-load greeting kicked off once when the campaign loads with empty
  // history. greetedRef guards against StrictMode double-fire in dev.
  useEffect(() => {
    if (!campaign.data) return;
    if ((campaign.data.messages?.length ?? 0) > 0) return;
    if (greetedRef.current) return;
    if (greet.isPending) return;
    greetedRef.current = true;
    greet.mutate({ campaignId });
  }, [campaign.data, campaignId, greet]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [campaign.data?.messages?.length, sendMessage.isPending, greet.isPending]);

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
          Loading campaign…
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

  const messages: Message[] = campaign.data.messages ?? [];
  const llmBusy = sendMessage.isPending || greet.isPending;
  const canLock = messages.length >= 2 && !llmBusy && !proposeLock.isPending;
  const alreadyLocked = campaign.data.stage !== "intake";

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || llmBusy) return;
    sendMessage.mutate({ campaignId, text });
    setDraft("");
  };

  const handleProposeLock = () => {
    proposeLock.mutate(
      { campaignId },
      {
        onSuccess: (data) => setProposal(data),
      }
    );
  };

  const handleConfirmLock = () => {
    if (!proposal) return;
    lock.mutate({ campaignId, proposal });
  };

  return (
    <div
      className="max-w-3xl mx-auto px-6 pt-8 pb-8 flex flex-col"
      style={{ minHeight: "calc(100vh - 56px)" }}
    >
      <header className="mb-6">
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
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <h1
            className="t-display"
            style={{
              fontSize: "clamp(26px, 3.6vw, 38px)",
              color: "var(--ink)",
              lineHeight: 1.0,
            }}
          >
            {campaign.data.title}
          </h1>
          <Pill tone={alreadyLocked ? "ok" : "warn"}>
            {alreadyLocked ? campaign.data.stage : "intake"}
          </Pill>
        </div>
        <p className="prose-body mt-3" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {alreadyLocked ? (
            <>
              This campaign is locked.{" "}
              <Link href={`/campaign/${campaignId}`} className="link-amber">
                View campaign overview
              </Link>
              .
            </>
          ) : (
            "Chat with the framework guide until the campaign is sharp enough to lock in."
          )}
        </p>
      </header>

      <div className="mb-3">
        <SectionMark>§ Intake · Conversation</SectionMark>
      </div>

      <div
        ref={scrollRef}
        className="frame flex-1 p-5 overflow-y-auto space-y-4"
        style={{ minHeight: 360 }}
      >
        <span className="br" />
        {messages.length === 0 && !llmBusy && (
          <p
            className="t-mono"
            style={{
              color: "var(--ink-4)",
              fontSize: 12,
              fontStyle: "italic",
            }}
          >
            Loading the guide…
          </p>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {llmBusy && (
          <div
            className="t-mono flex items-center gap-2"
            style={{ color: "var(--ink-4)", fontSize: 12, fontStyle: "italic" }}
          >
            <span className="pulse-dot" />
            {messages.length === 0 ? "Greeting…" : "Thinking…"}
          </div>
        )}
      </div>

      {proposal ? (
        <LockReviewPanel
          proposal={proposal}
          onChange={setProposal}
          onCancel={() => setProposal(null)}
          onConfirm={handleConfirmLock}
          isLocking={lock.isPending}
          lockError={lock.error?.message}
        />
      ) : (
        <>
          <form onSubmit={handleSend} className="mt-4 flex gap-2 items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSend(e);
                }
              }}
              placeholder="Type your reply. Cmd/Ctrl+Enter to send."
              rows={3}
              className="field-textarea flex-1"
              disabled={llmBusy || alreadyLocked}
            />
            <Button
              type="submit"
              disabled={!draft.trim() || llmBusy || alreadyLocked}
              className="self-stretch"
            >
              Send
            </Button>
          </form>

          {!alreadyLocked && (
            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <p
                className="prose-body"
                style={{
                  fontSize: 12,
                  color: "var(--ink-4)",
                  margin: 0,
                  maxWidth: "44ch",
                }}
              >
                When the guide proposes a campaign you&apos;re happy with,
                click Lock to extract + review.
              </p>
              <Button
                onClick={handleProposeLock}
                disabled={!canLock}
                arrow
              >
                {proposeLock.isPending ? "Extracting" : "Lock Campaign"}
              </Button>
            </div>
          )}

          {sendMessage.error && (
            <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
              Error: {sendMessage.error.message}
            </pre>
          )}
          {greet.error && (
            <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
              Greeting error: {greet.error.message}
            </pre>
          )}
          {proposeLock.error && (
            <pre className="code-block mt-3" style={{ color: "var(--bad)" }}>
              Lock error: {proposeLock.error.message}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        style={{
          maxWidth: "82%",
          padding: "10px 14px",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          borderRadius: 2,
          background: isUser
            ? "oklch(0.20 0.012 60 / 0.85)"
            : "oklch(0.115 0.010 60 / 0.85)",
          border: isUser
            ? "1px solid var(--rule)"
            : "1px solid oklch(0.45 0.10 55 / 0.3)",
          color: isUser ? "var(--ink)" : "var(--ink-2)",
        }}
      >
        {!isUser && (
          <div
            className="t-mono"
            style={{
              color: "var(--amber)",
              fontSize: 9.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            · Framework Guide
          </div>
        )}
        {message.content}
      </div>
    </div>
  );
}
