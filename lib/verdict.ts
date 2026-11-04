// Installer verdict for a clicked area. See docs/DETECTION.md ("Verdict").
// Never recommends "install everywhere"; never guesses when the scan failed.
import { MIN_ROOFS, PEER_COUNT, type AreaStats, type Rank } from "./stats";
import { totalKwp, type Lead } from "./leads";

export const LABELS = {
  measuring: "MEASURING…",
  noVerdict: "NO VERDICT",
  tooFew: "TOO FEW ROOFS TO JUDGE",
  apartments: "LOW ADOPTION / MOSTLY APARTMENT BLOCKS",
  strong: "STRONG TARGET / LOW ADOPTION",
  likely: "LIKELY TARGET / BELOW TYPICAL",
  mature: "MATURE AREA / SELL UPGRADES",
  typical: "TYPICAL / TARGET SELECTIVELY",
} as const;

export type VerdictLabel = (typeof LABELS)[keyof typeof LABELS];

export const LOW_PCT = 33;
export const HIGH_PCT = 67;
export const APARTMENT_SHARE = 0.6;
export const TOP_LEADS = 10; // default number of largest roofs to door-knock first

export type VerdictInput = {
  state: "scanning" | "failed" | "ok";
  stats?: AreaStats; // required when state is "ok"
  peerRank?: Rank | null; // rank against the 20 most similar cells
  townRank?: Rank | null; // rank against all ranked cells (fallback)
  leads?: Lead[]; // optional: leadsFor(...).leads, largest first, for kWp in work items
};

export type Verdict = {
  label: VerdictLabel;
  basis: "peers" | "town" | null; // null when no comparison was made
  workItems: string[]; // 2–3 short installer-facing actions
  reasons: string[]; // why, with numbers
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ord = (p: number) => `${Math.round(p)}th percentile`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Peers when at least 20 peer cells were compared, else town. */
export function pickRank(peerRank?: Rank | null, townRank?: Rank | null): { rank: Rank; basis: "peers" | "town" } | null {
  if (peerRank && peerRank.n >= PEER_COUNT) return { rank: peerRank, basis: "peers" };
  if (townRank && townRank.n > 0) return { rank: townRank, basis: "town" };
  return null;
}

export function verdict(input: VerdictInput): Verdict {
  if (input.state === "scanning") {
    return { label: LABELS.measuring, basis: null, workItems: [], reasons: ["Scan in progress."] };
  }
  if (input.state === "failed" || !input.stats) {
    return {
      label: LABELS.noVerdict,
      basis: null,
      workItems: ["Retry the scan before judging this area."],
      reasons: ["The imagery scan failed, so nothing is guessed."],
    };
  }

  const s = input.stats;
  const reviewItem =
    s.review > 0 ? `Check ${plural(s.review, "roof")} flagged for review on site before quoting.` : null;

  if (s.roofs < MIN_ROOFS) {
    return {
      label: LABELS.tooFew,
      basis: null,
      workItems: [
        "Widen the circle to cover at least 15 roofs.",
        ...(s.roofs - s.withPanels - s.review > 0
          ? [`Treat the ${plural(s.roofs - s.withPanels - s.review, "roof")} without panels as individual leads.`]
          : []),
      ].slice(0, 3),
      reasons: [`Only ${plural(s.roofs, "roof")} in the area; at least ${MIN_ROOFS} are needed for a fair comparison.`],
    };
  }

  const picked = pickRank(input.peerRank, input.townRank);
  if (!picked) {
    return {
      label: LABELS.noVerdict,
      basis: null,
      workItems: ["Wait for the town scan to finish, then click again."],
      reasons: ["No ranked neighbourhoods available to compare against."],
    };
  }
  const { rank, basis } = picked;
  const vs = basis === "peers" ? `the ${rank.n} neighbourhoods with similar housing` : `${rank.n} neighbourhoods town-wide`;

  const reasons = [
    `${s.withPanels} of ${s.roofs} roofs have panels (${pct(s.share)}, 95% range ${pct(s.lo)}–${pct(s.hi)}).`,
    `That is the ${ord(rank.percentile)} among ${vs} (median ${pct(rank.median)}, top quarter starts at ${pct(rank.q75)}).`,
  ];
  if (s.review > 0) reasons.push(`${plural(s.review, "roof")} flagged for review ${s.review === 1 ? "is" : "are"} counted in neither group.`);

  const leads = input.leads ?? [];
  const without = s.roofs - s.withPanels - s.review;
  const topN = Math.min(leads.length, Math.max(TOP_LEADS, Math.min(rank.headroom, 25)));
  const top = leads.slice(0, topN);
  const kwpNote = top.length ? ` (≈ ${Math.round(totalKwp(top))} kWp)` : "";
  const topCount = top.length || Math.min(without, TOP_LEADS);
  const headroomItem =
    rank.headroom > 0
      ? `${plural(rank.headroom, "more roof")} with panels would lift this area to the top quarter (${pct(rank.q75)}).`
      : null;

  const finish = (label: VerdictLabel, items: (string | null)[]): Verdict => {
    const workItems = items.filter((x): x is string => !!x);
    if (reviewItem && workItems.length < 3) workItems.push(reviewItem);
    return { label, basis, workItems: workItems.slice(0, 3), reasons };
  };

  if (rank.percentile <= LOW_PCT) {
    if (s.largeRoofShare >= APARTMENT_SHARE) {
      reasons.push(`${pct(s.largeRoofShare)} of the roof area is large roofs (≥ 400 m²): mostly apartment blocks.`);
      const blocks = top.filter((l) => l.segment === "collective/business");
      const blockKwp = blocks.length ? ` (≈ ${Math.round(totalKwp(blocks))} kWp)` : "";
      return finish(LABELS.apartments, [
        `Pitch shared self-consumption (autoconsumo colectivo) to the owners' associations of the ${
          blocks.length ? plural(blocks.length, "largest block") : "largest blocks"
        } without panels${blockKwp}.`,
        "Bring a per-household saving estimate to the next owners' meeting.",
      ]);
    }
    if (s.hi < rank.median) {
      reasons.push(`Even the top of the 95% range (${pct(s.hi)}) is below the median (${pct(rank.median)}).`);
      return finish(LABELS.strong, [
        `Door-knock the ${plural(topCount, "largest roof")} without panels first${kwpNote}.`,
        headroomItem,
      ]);
    }
    reasons.push(`The 95% range (${pct(s.lo)}–${pct(s.hi)}) still reaches the median (${pct(rank.median)}), so the gap may be noise.`);
    return finish(LABELS.likely, [
      `Start with the ${plural(topCount, "largest roof")} without panels${kwpNote}.`,
      s.withPanels > 0 ? `Use the ${plural(s.withPanels, "neighbour")} already with panels as local proof.` : headroomItem,
    ]);
  }

  if (rank.percentile >= HIGH_PCT) {
    return finish(LABELS.mature, [
      `Offer batteries and expansions to the ${plural(s.withPanels, "roof")} that already have panels.`,
      `Ask those owners for referrals to the ${plural(without, "roof")} still without panels.`,
    ]);
  }

  return finish(LABELS.typical, [
    `Quote only the ${plural(topCount, "largest roof")} without panels${kwpNote}; skip small roofs.`,
    headroomItem,
  ]);
}
