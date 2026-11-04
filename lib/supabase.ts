import { createClient } from "@supabase/supabase-js";

// Single demo installer, no login: one stateless client with the publishable key.
// Reads are allowed by RLS SELECT policies; writes only via the RPCs
// create_campaign / advance_lead (see supabase/migrations/*_campaigns.sql).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.local)",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const LEAD_STATUSES = ["to_visit", "visited", "quoted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

// Mirror of the DB gate in public.advance_lead, used only to decide which buttons to render.
// The database remains the authority.
export const NEXT_STEPS: Record<LeadStatus, LeadStatus[]> = {
  to_visit: ["visited"],
  visited: ["quoted"],
  quoted: ["won", "lost"],
  won: [],
  lost: [],
};

export type CampaignRow = {
  id: string;
  name: string;
  center_lat: number | null;
  center_lon: number | null;
  radius_m: number | null;
  verdict: string;
  stats: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  flight_date: string | null;
  created_at: string;
};

export type LeadRow = {
  id: string;
  campaign_id: string;
  roof_id: number | null;
  lat: number | null;
  lon: number | null;
  area_m2: number | null;
  kwp: number | null;
  kwh_yr: number | null;
  eur_yr: number | null;
  segment: string | null;
  status: LeadStatus;
  updated_at: string;
};

export type LeadEventRow = {
  id: number;
  lead_id: string;
  from_status: LeadStatus | null;
  to_status: LeadStatus;
  note: string | null;
  created_at: string;
};
