"use client";

import { useState } from "react";
import Link from "next/link";
import { csvField } from "@/lib/leads";
import {
  FILTERS,
  assumptionText,
  STATUS_LABEL,
  fmtDate,
  fmtInt,
  fmtKwp,
  mapsHref,
  matchesFilter,
  radarHref,
  type StatusFilter,
} from "../format";
import LeadActions from "./LeadActions";
import s from "../campaigns.module.css";

export type WorkLead = {
  id: string;
  rank: number;
  roofId: number | null;
  lat: number | null;
  lon: number | null;
  area: number | null;
  kwp: number | null;
  kwhYr: number | null;
  eurYr: number | null;
  segment: string | null;
  status: string;
  updatedAt: string;
  next: string[];
  events: { id: number; from: string | null; to: string; note: string | null; at: string }[];
};

export type CsvInfo = {
  id: string;
  name: string;
  verdict: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  flightDate: string | null;
  assumptions: Record<string, unknown>;
};

const comment = (line: string) => "# " + line.replace(/[\r\n]+/g, " ");

function buildCsv(info: CsvInfo, leads: WorkLead[]): string {
  const lines = [
    comment(`Solar Radar campaign: ${info.name}`),
    comment(`verdict: ${info.verdict}`),
    ...(info.centerLat != null && info.centerLon != null
      ? [
          comment(
            `area centre: lat ${info.centerLat.toFixed(6)}, lon ${info.centerLon.toFixed(6)}; radius ${info.radiusM ?? "?"} m`,
          ),
        ]
      : []),
    comment(`aerial photo flight date: ${info.flightDate ?? "unknown"}`),
    comment("every row: no panels seen on that photo"),
    ...Object.entries(info.assumptions ?? {}).map(([k, v]) => comment(`assumption: ${assumptionText(k, v)}`)),
    comment(`exported: ${new Date().toISOString()}`),
    [
      "rank",
      "roof_id",
      "status",
      "lat",
      "lon",
      "footprint_m2",
      "segment",
      "kwp",
      "kwh_yr",
      "eur_yr",
      "status_updated",
    ].join(","),
    ...leads.map((l) =>
      [
        l.rank,
        l.roofId,
        STATUS_LABEL[l.status] ?? l.status,
        l.lat?.toFixed(6),
        l.lon?.toFixed(6),
        l.area == null ? null : Math.round(l.area),
        l.segment,
        l.kwp == null ? null : l.kwp.toFixed(1),
        l.kwhYr == null ? null : Math.round(l.kwhYr),
        l.eurYr == null ? null : Math.round(l.eurYr),
        l.updatedAt,
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}

export default function WorkList({ leads, csv }: { leads: WorkLead[]; csv: CsvInfo }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const download = () => {
    const blob = new Blob([buildCsv(csv, leads)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${csv.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });

  const shown = leads.filter((l) => matchesFilter(l.status, filter));

  return (
    <section className={s.work}>
      <div className={s.toolbar}>
        <div className={s.filters} role="group" aria-label="filter leads">
          {FILTERS.map((f) => {
            const n = leads.filter((l) => matchesFilter(l.status, f.key)).length;
            return (
              <button
                key={f.key}
                type="button"
                className={`${s.btn} ${filter === f.key ? s.on : ""}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className={s.count}>{n}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className={s.btn} onClick={download} disabled={leads.length === 0}>
          [ download CSV ]
        </button>
      </div>

      {leads.length === 0 ? (
        <p className={s.dim}>This campaign has no roofs.</p>
      ) : shown.length === 0 ? (
        <p className={s.dim}>Nothing here yet.</p>
      ) : (
        <ol className={s.leads}>
          {shown.map((l) => {
            const isOpen = open.has(l.id);
            return (
              <li key={l.id} className={s.lead}>
                <span className={s.rank}>#{l.rank}</span>
                <span className={s.size}>
                  {fmtInt(l.area)} m² <span className={s.dim}>·</span> {fmtKwp(l.kwp)} kWp
                </span>
                <span className={s.status} data-status={l.status} data-testid="lead-status">
                  {STATUS_LABEL[l.status] ?? l.status}
                </span>
                <span className={s.step}>
                  <LeadActions leadId={l.id} next={l.next} />
                </span>
                <span className={s.links}>
                  {l.lat != null && l.lon != null && <Link href={radarHref(l.lat, l.lon)}>map ↗</Link>}
                  <button
                    type="button"
                    className={`${s.btn} ${s.dim}`}
                    aria-expanded={isOpen}
                    onClick={() => toggle(l.id)}
                  >
                    {isOpen ? "− more" : "+ more"}
                  </button>
                </span>
                {isOpen && (
                  <div className={s.more}>
                    <p className={s.dim}>
                      roof {l.roofId ?? "—"} · {l.segment ?? "—"} · ≈ {fmtInt(l.kwhYr)} kWh/yr · ≈ €
                      {fmtInt(l.eurYr)}/yr
                      {l.lat != null && l.lon != null && (
                        <>
                          {" · "}
                          <a href={mapsHref(l.lat, l.lon)} target="_blank" rel="noreferrer">
                            google maps ↗
                          </a>
                        </>
                      )}
                    </p>
                    <ul className={s.log}>
                      {l.events.map((e) => (
                        <li key={e.id}>
                          <span className={s.dim}>{fmtDate(e.at)}</span>{" "}
                          {e.from ? `${STATUS_LABEL[e.from] ?? e.from} → ` : "added as "}
                          {STATUS_LABEL[e.to] ?? e.to}
                          {e.note ? <span className={s.dim}> · {e.note}</span> : null}
                        </li>
                      ))}
                      {l.events.length === 0 && <li className={s.dim}>no history</li>}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
