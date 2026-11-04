"use client";

import { useState, useTransition } from "react";
import { advanceLead } from "../actions";
import s from "../campaigns.module.css";

// Renders only the legal next steps for a lead. The DB function advance_lead is
// still the authority; any refusal from it is shown inline.
export default function LeadActions({ leadId, next }: { leadId: string; next: string[] }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (next.length === 0) return <span className={s.final}>final</span>;

  const go = (to: string) => {
    setError(null);
    startTransition(async () => {
      const res = await advanceLead(leadId, to, note);
      if (res.ok) setNote("");
      else setError(res.error);
    });
  };

  return (
    <span className={s.actions}>
      {next.map((to) => (
        <button key={to} type="button" className={s.btn} disabled={pending} onClick={() => go(to)}>
          [ {to} ]
        </button>
      ))}
      <input
        className={s.note}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="note"
        maxLength={280}
        disabled={pending}
      />
      {error && <span className={s.error}>{error}</span>}
    </span>
  );
}
