import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  supabase,
  LEAD_STATUSES,
  NEXT_STEPS,
  type CampaignRow,
  type LeadEventRow,
  type LeadRow,
  type LeadStatus,
} from "@/lib/supabase";
import { assumptionText, flatEntries, fmtDate, fmtDay, fmtKwp, fmtValue, STATUS_LABEL } from "../format";
import WorkList, { type WorkLead } from "./WorkList";
import s from "../campaigns.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  return (
    <main className={s.main}>
      <nav className={s.crumbs}>
        <Link href="/campaigns">[ ← campaigns ]</Link>
        <Link href="/map">[ map ]</Link>
      </nav>
      <Suspense fallback={<p className={s.dim}>loading campaign…</p>}>
        <Campaign params={params} />
      </Suspense>
    </main>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isTextList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

/** One plain-language sentence about the area, from the stats saved with the campaign. */
function summary(stats: Record<string, unknown>, leadCount: number): string {
  const roofs = num(stats?.roofs);
  const withPanels = num(stats?.withPanels);
  const list = `${leadCount} roof${leadCount === 1 ? "" : "s"} without panels on your list`;
  if (roofs != null && withPanels != null && roofs > 0) {
    return `${withPanels} of ${roofs} roofs here already have solar panels (${Math.round(
      (withPanels / roofs) * 100,
    )}%) — ${list}, largest first.`;
  }
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}, largest first.`;
}

async function Campaign({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [{ data: campaign, error }, { data: leads, error: leadsError }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle<CampaignRow>(),
    supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", id)
      .order("area_m2", { ascending: false })
      .order("roof_id", { ascending: true })
      .returns<LeadRow[]>(),
  ]);
  if (error) return <p className={s.box}>! could not load campaign: {error.message}</p>;
  if (!campaign) notFound();
  if (leadsError) return <p className={s.box}>! could not load leads: {leadsError.message}</p>;

  const leadIds = (leads ?? []).map((l) => l.id);
  const { data: events } = leadIds.length
    ? await supabase
        .from("lead_events")
        .select("*")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .returns<LeadEventRow[]>()
    : { data: [] as LeadEventRow[] };

  const eventsByLead = new Map<string, LeadEventRow[]>();
  for (const e of events ?? []) {
    const list = eventsByLead.get(e.lead_id) ?? [];
    list.push(e);
    eventsByLead.set(e.lead_id, list);
  }
  const rankOf = new Map((leads ?? []).map((l, i) => [l.id, i + 1]));

  const counts = Object.fromEntries(LEAD_STATUSES.map((st) => [st, 0])) as Record<LeadStatus, number>;
  let totalKwp = 0;
  let wonKwp = 0;
  for (const l of leads ?? []) {
    counts[l.status]++;
    totalKwp += Number(l.kwp ?? 0);
    if (l.status === "won") wonKwp += Number(l.kwp ?? 0);
  }
  const total = leads?.length ?? 0;

  const work: WorkLead[] = (leads ?? []).map((l, i) => ({
    id: l.id,
    rank: i + 1,
    roofId: l.roof_id,
    lat: l.lat,
    lon: l.lon,
    area: l.area_m2,
    kwp: l.kwp,
    kwhYr: l.kwh_yr,
    eurYr: l.eur_yr,
    segment: l.segment,
    status: l.status,
    updatedAt: l.updated_at,
    next: NEXT_STEPS[l.status] ?? [],
    events: (eventsByLead.get(l.id) ?? []).map((e) => ({
      id: e.id,
      from: e.from_status,
      to: e.to_status,
      note: e.note,
      at: e.created_at,
    })),
  }));

  const stats = campaign.stats ?? {};
  const reasons = isTextList(stats.reasons) ? stats.reasons : [];
  const workItems = isTextList(stats.workItems) ? stats.workItems : [];
  const rawStats = flatEntries(stats).filter(([, v]) => !isTextList(v));
  const assumptions = Object.entries(campaign.assumptions ?? {});
  const moves = (events ?? []).filter((e) => e.from_status != null);

  return (
    <>
      <header className={s.head}>
        <h1 className={s.h1}>{campaign.name}</h1>
        <p className={s.verdict}>{campaign.verdict}</p>
        <p>{summary(stats, total)}</p>
        <p className={s.dim}>aerial photo taken {fmtDay(campaign.flight_date)}</p>
      </header>

      {total > 0 && (
        <section aria-label="progress" className={s.progress}>
          <div className={s.bar} role="img" aria-label={`${total - counts.to_visit} of ${total} roofs worked`}>
            {LEAD_STATUSES.map((st) =>
              counts[st] > 0 ? (
                <span key={st} data-status={st} style={{ flexGrow: counts[st] }} title={`${counts[st]} ${STATUS_LABEL[st]}`} />
              ) : null,
            )}
          </div>
          <ul className={s.legend}>
            {LEAD_STATUSES.map((st) => (
              <li key={st}>
                <span className={s.swatch} data-status={st} aria-hidden />
                <strong>{counts[st]}</strong> <span className={s.dim}>{STATUS_LABEL[st]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <WorkList
        leads={work}
        csv={{
          id: campaign.id,
          name: campaign.name,
          verdict: campaign.verdict,
          centerLat: campaign.center_lat,
          centerLon: campaign.center_lon,
          radiusM: campaign.radius_m,
          flightDate: campaign.flight_date,
          assumptions: campaign.assumptions ?? {},
        }}
      />

      <details className={s.details}>
        <summary>details</summary>
        <div className={s.detailBody}>
          {reasons.length > 0 && (
            <section>
              <h2 className={s.sectionTitle}>Why this verdict</h2>
              <ul className={s.log}>
                {reasons.map((x) => (
                  <li key={x}>· {x}</li>
                ))}
              </ul>
            </section>
          )}

          {workItems.length > 0 && (
            <section>
              <h2 className={s.sectionTitle}>Suggested plan</h2>
              <ul className={s.log}>
                {workItems.map((x) => (
                  <li key={x}>→ {x}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className={s.sectionTitle}>Area</h2>
            <ul className={s.log}>
              <li>
                centre{" "}
                {campaign.center_lat != null && campaign.center_lon != null
                  ? `${campaign.center_lat.toFixed(5)}, ${campaign.center_lon.toFixed(5)}`
                  : "—"}{" "}
                · radius {campaign.radius_m ?? "—"} m
              </li>
              <li>
                {fmtKwp(totalKwp)} kWp possible on the list · {fmtKwp(wonKwp)} kWp won
              </li>
              <li>saved {fmtDate(campaign.created_at)}</li>
            </ul>
          </section>

          {assumptions.length > 0 && (
            <section>
              <h2 className={s.sectionTitle}>Assumptions</h2>
              <ul className={s.log}>
                {assumptions.map(([k, v]) => (
                  <li key={k}>· {assumptionText(k, v)}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className={s.sectionTitle}>Activity · newest first</h2>
            <ul className={s.log}>
              {moves.slice(0, 200).map((e) => (
                <li key={e.id}>
                  <span className={s.dim}>{fmtDate(e.created_at)}</span> roof #{rankOf.get(e.lead_id)}:{" "}
                  {STATUS_LABEL[e.from_status ?? ""] ?? e.from_status} → {STATUS_LABEL[e.to_status] ?? e.to_status}
                  {e.note ? <span className={s.dim}> · {e.note}</span> : null}
                </li>
              ))}
              {moves.length === 0 && <li className={s.dim}>No moves yet. Every roof starts at “to visit”.</li>}
            </ul>
          </section>

          {rawStats.length > 0 && (
            <section>
              <h2 className={s.sectionTitle}>All numbers at save time</h2>
              <dl className={s.kv}>
                {rawStats.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{fmtValue(k, v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </details>
    </>
  );
}
