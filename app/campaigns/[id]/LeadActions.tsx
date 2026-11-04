"use client";

import { useState, useTransition } from "react";
import { advanceLead } from "../actions";
import { STEP_LABEL } from "../format";
import s from "../campaigns.module.css";

// Renders only the legal next steps for a lead. The DB function advance_lead is
// still the authority; any refusal from it is shown inline.
export default function LeadActions({ leadId, next }: { leadId: string; next: string[] }) {
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (next.length === 0) return <span className={s.final}>done</span>;

  const go = (to: string) => {
    setError(null);
    startTransition(async () => {
      const res = await advanceLead(leadId, to, note);
      if (res.ok) {
        setNote("");
        setNoteOpen(false);
      } else setError(res.error);
    });
  };

  return (
    <span className={s.actions}>
      {next.map((to) => (
        <button key={to} type="button" className={s.btn} disabled={pending} onClick={() => go(to)}>
          [ {STEP_LABEL[to] ?? to} ]
        </button>
      ))}
      {noteOpen ? (
        <input
          className={s.note}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          aria-label="note for this step"
          maxLength={280}
          disabled={pending}
          autoFocus
        />
      ) : (
        <button type="button" className={`${s.btn} ${s.dim}`} onClick={() => setNoteOpen(true)}>
          + note
        </button>
      )}
      {pending && <span className={s.dim}>saving…</span>}
      {error && <span className={s.error}>{error}</span>}
    </span>
  );
}
