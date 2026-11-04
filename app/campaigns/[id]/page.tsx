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
import { flatEntries, fmtDate, fmtInt, fmtKwp, fmtValue, mapsHref } from "../format";
import LeadActions from "./LeadActions";
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

  const center =
    campaign.center_lat != null && campaign.center_lon != null
      ? `${campaign.center_lat.toFixed(5)}, ${campaign.center_lon.toFixed(5)}`
      : "—";
  const isTextList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
  const textLists = Object.entries(campaign.stats ?? {}).filter((e): e is [string, string[]] => isTextList(e[1]));
  const stats = flatEntries(campaign.stats).filter(([, v]) => !isTextList(v));
  const assumptions = flatEntries(campaign.assumptions);

  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className={s.h1}>{campaign.name}</h1>
        <p>
          verdict: <strong>{campaign.verdict}</strong>
        </p>
        <p className={s.dim}>
          center {center} · radius {campaign.radius_m ?? "—"} m · flight {campaign.flight_date ?? "—"} ·
          saved {fmtDate(campaign.created_at)}
        </p>
      </header>

      <section className={s.box}>
        <h2 className={s.sectionTitle}>Pipeline</h2>
        <dl className={s.kv}>
          <div>
            <dt>leads</dt>
            <dd>{leads?.length ?? 0}</dd>
          </div>
          {LEAD_STATUSES.map((st) => (
            <div key={st}>
              <dt>{st.replace("_", " ")}</dt>
              <dd>{counts[st]}</dd>
            </div>
          ))}
          <div>
            <dt>total kWp</dt>
            <dd>{fmtKwp(totalKwp)}</dd>
          </div>
          <div>
            <dt>won kWp</dt>
            <dd>{fmtKwp(wonKwp)}</dd>
          </div>
        </dl>
      </section>

      {textLists.map(([k, items]) => (
        <section key={k} className={s.box}>
          <h2 className={s.sectionTitle}>{k === "workItems" ? "Work items" : k}</h2>
          <ul className={s.log}>
            {items.map((x) => (
              <li key={x}>→ {x}</li>
            ))}
          </ul>
        </section>
      ))}

      {stats.length > 0 && (
        <section className={s.box}>
          <h2 className={s.sectionTitle}>Area stats at save time</h2>
          <dl className={s.kv}>
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{fmtValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {assumptions.length > 0 && (
        <section className={s.box}>
          <h2 className={s.sectionTitle}>Assumptions</h2>
          <dl className={s.kv}>
            {assumptions.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{fmtValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <h2 className={s.sectionTitle}>Leads · largest roof first</h2>
        {!leads || leads.length === 0 ? (
          <p className={s.dim}>This campaign has no leads.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.num}>#</th>
                  <th className={s.num}>roof</th>
                  <th>segment</th>
                  <th className={s.num}>area m²</th>
                  <th className={s.num}>kWp</th>
                  <th className={s.num}>kWh/yr</th>
                  <th className={s.num}>€/yr</th>
                  <th>where</th>
                  <th>status</th>
                  <th>next step</th>
                  <th>log</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => {
                  const log = eventsByLead.get(l.id) ?? [];
                  return (
                    <tr key={l.id}>
                      <td className={`${s.num} ${s.dim}`}>{i + 1}</td>
                      <td className={s.num}>{l.roof_id ?? "—"}</td>
                      <td>{l.segment ?? "—"}</td>
                      <td className={s.num}>{fmtInt(l.area_m2)}</td>
                      <td className={s.num}>{fmtKwp(l.kwp)}</td>
                      <td className={s.num}>{fmtInt(l.kwh_yr)}</td>
                      <td className={s.num}>{fmtInt(l.eur_yr)}</td>
                      <td>
                        {l.lat != null && l.lon != null ? (
                          <span className={s.actions}>
                            <a href={mapsHref(l.lat, l.lon)} target="_blank" rel="noreferrer">
                              gmaps↗
                            </a>
                            <Link href={`/map?lat=${l.lat}&lon=${l.lon}`}>map</Link>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span data-testid="lead-status">{l.status.replace("_", " ")}</span>
                      </td>
                      <td>
                        <LeadActions leadId={l.id} next={NEXT_STEPS[l.status]} />
                      </td>
                      <td>
                        <details className={s.details}>
                          <summary>{log.length} event{log.length === 1 ? "" : "s"}</summary>
                          <ul className={s.log}>
                            {log.map((e) => (
                              <li key={e.id}>
                                <span className={s.dim}>{fmtDate(e.created_at)}</span>{" "}
                                {e.from_status ?? "∅"} → {e.to_status}
                                {e.note ? <span className={s.dim}> · {e.note}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {events && events.length > 0 && (
        <section className={s.box}>
          <h2 className={s.sectionTitle}>Activity · newest first</h2>
          <ul className={s.log}>
            {events
              .filter((e) => e.from_status != null)
              .slice(0, 50)
              .map((e) => (
                <li key={e.id}>
                  <span className={s.dim}>{fmtDate(e.created_at)}</span> lead #{rankOf.get(e.lead_id)}:{" "}
                  {e.from_status} → {e.to_status}
                  {e.note ? <span className={s.dim}> · {e.note}</span> : null}
                </li>
              ))}
            {events.every((e) => e.from_status == null) && (
              <li className={s.dim}>No moves yet. Every lead starts at “to visit”.</li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}
