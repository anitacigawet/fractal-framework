// The Campaign-fields review panel — used by Intake (after the user clicks
// "Lock Campaign") and by Home (after the "Pick for me" flow returns a
// suggestion). Same shape both ways: a populated CampaignLockProposal that
// the user can edit before confirming.

import type { CampaignLockProposal } from "../../../shared/types";
import { ISSUE_TYPES } from "../../../shared/types";
import { Button, Frame, SectionMark } from "./ui";

export interface LockReviewPanelProps {
  proposal: CampaignLockProposal;
  onChange: (p: CampaignLockProposal) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isLocking: boolean;
  lockError?: string;
  confirmLabel?: string;
  title?: string;
  subtitle?: string;
}

export function LockReviewPanel({
  proposal,
  onChange,
  onCancel,
  onConfirm,
  isLocking,
  lockError,
  confirmLabel = "Confirm & Lock",
  title = "Review Campaign",
  subtitle = "The guide extracted this from your conversation. Edit anything below, then confirm to lock the campaign. Locking advances the stage to research.",
}: LockReviewPanelProps) {
  const issueTypeKnown = ISSUE_TYPES.includes(proposal.issue_type as never);

  return (
    <Frame as="section" className="mt-5 p-6 space-y-4">
      <header>
        <SectionMark className="mb-2">Campaign · Review</SectionMark>
        <h2
          className="t-display"
          style={{ fontSize: 22, color: "var(--ink)" }}
        >
          {title}
        </h2>
        <p
          className="prose-body mt-1"
          style={{ fontSize: 13.5, lineHeight: 1.6 }}
        >
          {subtitle}
        </p>
      </header>

      <ReviewField
        label="Project name"
        value={proposal.project_name}
        onChange={(v) => onChange({ ...proposal, project_name: v })}
      />
      <ReviewField
        label="Mission"
        value={proposal.project_mission}
        onChange={(v) => onChange({ ...proposal, project_mission: v })}
        multiline
      />
      <ReviewField
        label="Locale"
        value={proposal.locale}
        onChange={(v) => onChange({ ...proposal, locale: v })}
      />
      <div>
        <label className="field-label">Issue type</label>
        <select
          value={proposal.issue_type}
          onChange={(e) =>
            onChange({ ...proposal, issue_type: e.target.value })
          }
          className="field-select"
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {!issueTypeKnown && (
            <option value={proposal.issue_type}>{proposal.issue_type}</option>
          )}
        </select>
      </div>
      <ReviewField
        label="Tier 1 examples"
        value={proposal.tier_examples.tier_1}
        onChange={(v) =>
          onChange({
            ...proposal,
            tier_examples: { ...proposal.tier_examples, tier_1: v },
          })
        }
      />
      <ReviewField
        label="Tier 2 examples"
        value={proposal.tier_examples.tier_2}
        onChange={(v) =>
          onChange({
            ...proposal,
            tier_examples: { ...proposal.tier_examples, tier_2: v },
          })
        }
      />
      <ReviewField
        label="Tier 3 examples"
        value={proposal.tier_examples.tier_3}
        onChange={(v) =>
          onChange({
            ...proposal,
            tier_examples: { ...proposal.tier_examples, tier_3: v },
          })
        }
      />

      {lockError && (
        <pre className="code-block" style={{ color: "var(--bad)" }}>
          {lockError}
        </pre>
      )}

      <div className="flex gap-3 pt-2 items-center">
        <Button variant="ghost" onClick={onCancel} disabled={isLocking}>
          Cancel
        </Button>
        <div className="flex-1" />
        <Button onClick={onConfirm} disabled={isLocking} arrow>
          {isLocking ? "Locking" : confirmLabel}
        </Button>
      </div>
    </Frame>
  );
}

interface ReviewFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}

function ReviewField({
  label,
  value,
  onChange,
  multiline = false,
}: ReviewFieldProps) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="field-textarea"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field-input"
        />
      )}
    </div>
  );
}
