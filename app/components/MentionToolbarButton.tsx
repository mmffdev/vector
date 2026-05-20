"use client";

/**
 * MentionToolbarButton — placeholder for the rich-text toolbar's
 * @-mention trigger. Vector does not yet have a rich-text editor;
 * when one lands, the editor's toolbar will mount this button and
 * pass through the editor's anchor + insertion callback.
 *
 * For now, it owns the open/close state of MentionPicker so the
 * picker can be dropped into any page that wants to test the flow.
 *
 * Usage:
 *
 *   <MentionToolbarButton
 *     context={{ kind: "defect", id: "DE-101" }}
 *     onMention={(users) => editor.insertMentionTokens(users)}
 *   />
 */

import { useState } from "react";

import { mentions, type Mentionable } from "../lib/apiSite";

import { MentionPicker } from "./MentionPicker";

interface MentionToolbarButtonProps {
  /** The artefact the mention will be recorded against. */
  context: { kind: string; id: string };
  /** Text snippet to persist with the mention (surrounding ~280 chars). */
  snippet?: string;
  /**
   * Called after the picker confirms AND the POST /mentions succeeds.
   * The editor uses this to insert visible chips into the textbox.
   */
  onMention: (users: Mentionable[]) => void;
}

export function MentionToolbarButton({
  context,
  snippet,
  onMention,
}: MentionToolbarButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm(selected: Mentionable[]) {
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      await mentions.create({
        mentioned_user_ids: selected.map((u) => u.user_id),
        context_kind: context.kind,
        context_id: context.id,
        snippet: snippet ?? "",
      });
      onMention(selected);
    } catch {
      // Non-blocking — the editor decides whether to surface the
      // failure. A future toast hook will sit here.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost mention-toolbar-button"
        onClick={() => setOpen(true)}
        disabled={submitting}
        aria-label="Mention a team member"
        title="Mention (@)"
      >
        @
      </button>
      <MentionPicker
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
}
