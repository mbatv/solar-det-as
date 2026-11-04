import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { supabase, LEAD_STATUSES, type CampaignRow, type LeadStatus } from "@/lib/supabase";
import { fmtKwp } from "./format";
import s from "./campaigns.module.css";

export const metadata: Metadata = { title: "Campaigns · Solar Radar" };

export default function CampaignsPage() {
  return (
    <main className={s.main}>
      <nav className={s.crumbs}>
        <Link href="/">[ ← home ]</Link>
        <Link href="/map">[ map ]</Link>
      </nav>
      <header>
        <h1 className={s.h1}>Campaigns</h1>
        <p className={s.dim}>Saved areas and their door-to-door pipeline.</p>
      </header>
      <Suspense fallback={<p className={s.dim}>loading campaigns…</p>}>
        <CampaignList />
      </Suspense>
    </main>
  );
}

type Row = Pick<CampaignRow, "id" | "name" | "verdict" | "radius_m" | "created_at"> & {
  leads: { status: LeadStatus; kwp: number | null }[];
};

async function CampaignList() {
  await connection();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, verdict, radius_m, created_at, leads(status, kwp)")
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  if (error) {
    return <p className={s.box}>! could not load campaigns: {error.message}</p>;
  }

  if (!data || data.length === 0) {
    return (
      <div className={s.empty}>
        <p>No campaigns yet.</p>
        <p className={s.dim}>
          Open the map, click a circle, check the verdict and save its lead list as a campaign.
        </p>
        <Link href="/map">[ open map → ]</Link>
      </div>
    );
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>name</th>
            <th>verdict</th>
            <th className={s.num}>radius</th>
            <th className={s.num}>leads</th>
            <th>pipeline</th>
            <th className={s.num}>won kWp</th>
            <th>created</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => {
            const counts = Object.fromEntries(LEAD_STATUSES.map((st) => [st, 0])) as Record<LeadStatus, number>;
            let wonKwp = 0;
            for (const l of c.leads) {
              counts[l.status] = (counts[l.status] ?? 0) + 1;
              if (l.status === "won") wonKwp += Number(l.kwp ?? 0);
            }
            return (
              <tr key={c.id}>
                <td>
                  <Link className={s.rowLink} href={`/campaigns/${c.id}`}>
                    {c.name}
                  </Link>
                </td>
                <td>{c.verdict}</td>
                <td className={s.num}>{c.radius_m ?? "—"} m</td>
                <td className={s.num}>{c.leads.length}</td>
                <td>
                  {LEAD_STATUSES.filter((st) => counts[st] > 0)
                    .map((st) => `${counts[st]} ${st.replace("_", " ")}`)
                    .join(" · ") || <span className={s.dim}>—</span>}
                </td>
                <td className={s.num}>{fmtKwp(wonKwp)}</td>
                <td className={s.dim}>{c.created_at.slice(0, 10)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
