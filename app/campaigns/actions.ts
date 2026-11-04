"use server";

import { refresh, revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export type SaveCampaignInput = {
  name: string;
  centerLat: number;
  centerLon: number;
  radiusM: 100 | 200 | 350;
  verdict: string;
  stats: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  flightDate: string | null;
  leads: {
    roofId: number;
    lat: number;
    lon: number;
    area: number;
    kwp: number;
    kwhYr: number;
    eurYr: number;
    segment: string;
  }[];
};

const RADII = new Set([100, 200, 350]);

export async function saveCampaign(input: SaveCampaignInput): Promise<{ id: string }> {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new Error("Campaign name is required");
  if (!RADII.has(Number(input.radiusM))) throw new Error("radiusM must be 100, 200 or 350");
  if (!Number.isFinite(input.centerLat) || !Number.isFinite(input.centerLon)) {
    throw new Error("centerLat / centerLon must be numbers");
  }
  if (!Array.isArray(input.leads)) throw new Error("leads must be an array");

  const payload = {
    name,
    center_lat: input.centerLat,
    center_lon: input.centerLon,
    radius_m: input.radiusM,
    verdict: String(input.verdict ?? ""),
    stats: input.stats ?? {},
    assumptions: input.assumptions ?? {},
    flight_date: input.flightDate ?? null,
    leads: input.leads.map((l) => ({
      roof_id: l.roofId,
      lat: l.lat,
      lon: l.lon,
      area_m2: l.area,
      kwp: l.kwp,
      kwh_yr: l.kwhYr,
      eur_yr: l.eurYr,
      segment: l.segment,
    })),
  };

  const { data, error } = await supabase.rpc("create_campaign", { p: payload });
  if (error) throw new Error(error.message);

  revalidatePath("/campaigns");
  return { id: data as string };
}

export async function advanceLead(
  leadId: string,
  to: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("advance_lead", {
    p_lead: leadId,
    p_to: to,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) {
    // The UI may be stale (e.g. another tab moved this lead): re-render the
    // current page so the row shows the real status and its legal next steps.
    refresh();
    return { ok: false, error: error.message };
  }

  const campaignId = (data as { campaign_id?: string } | null)?.campaign_id;
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  return { ok: true };
}
