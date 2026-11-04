import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { supabase, type CampaignRow, type LeadStatus } from "@/lib/supabase";
import { fmtDay } from "./format";
import s from "./campaigns.module.css";

export const metadata: Metadata = { title: "Campaigns · Solar Radar" };

export default function CampaignsPage() {
  return (
    <main className={s.main}>
      <nav className={s.crumbs}>
        <Link href="/">[ ← home ]</Link>
        <Link href="/map">[ map ]</Link>
      </nav>
      <header className={s.head}>
        <h1 className={s.h1}>Campaigns</h1>
        <p className={s.dim}>Your saved areas and how far the door-to-door work has got.</p>
      </header>
      <Suspense fallback={<p className={s.dim}>loading campaigns…</p>}>
        <CampaignList />
      </Suspense>
    </main>
  );
}

type Row = Pick<CampaignRow, "id" | "name" | "verdict" | "created_at"> & {
  leads: { status: LeadStatus }[];
};

async function CampaignList() {
  await connection();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, verdict, created_at, leads(status)")
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  if (error) {
    return <p className={s.box}>! could not load campaigns: {error.message}</p>;
  }

  if (!data || data.length === 0) {
    return (
      <div className={s.empty}>
        <p>No campaigns yet — open the map, pick an area and save it.</p>
        <Link href="/map">[ open the map → ]</Link>
      </div>
    );
  }

  return (
    <ul className={s.cards}>
      {data.map((c) => {
        const total = c.leads.length;
        const visited = c.leads.filter((l) => l.status !== "to_visit").length;
        const won = c.leads.filter((l) => l.status === "won").length;
        return (
          <li key={c.id}>
            <Link className={s.card} href={`/campaigns/${c.id}`}>
              <span className={s.cardTop}>
                <span className={s.cardName}>{c.name}</span>
                <span className={s.dim}>{fmtDay(c.created_at)}</span>
              </span>
              <span className={s.verdict}>{c.verdict}</span>
              <span className={s.dim}>
                {total} roof{total === 1 ? "" : "s"} · {visited} visited · {won} won
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
