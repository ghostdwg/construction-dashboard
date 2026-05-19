/**
 * Cross-source reconciliation (Phase 5M).
 *
 * Walks MarketSignal records across all source types (P&Z, EnerGov, MNLR,
 * Press, etc.) and groups them into projects by fuzzy entity match on
 * `(owner_name, location)`. Promotes leads from PENDING → CONFIRMED when a
 * permit signal corroborates an earlier P&Z signal.
 *
 * POST /api/market-intelligence/reconcile
 *   Body: {dry_run?: boolean, since?: ISO date}
 *   Returns: {matched_clusters, leads_promoted, relationships_added}
 *
 * Strategy:
 * 1. Pull all signals with non-null owner_name in metadata
 * 2. Normalize names (strip "LLC", "Inc", whitespace, case)
 * 3. Cluster by exact normalized-name match (Tier 1 — easy wins)
 * 4. Within each cluster: if multiple sources represented, that's a
 *    cross-source-corroborated project → promote oldest signal's lead to
 *    CONFIRMED status, attach all sibling signals as MarketSignal.leadId
 *
 * Fuzzy match (Tier 2) — Levenshtein/token similarity — is future work.
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SignalMetadata = {
  owner_name?: string | null;
  contractor_name?: string | null;
  source?: string | null;
  location?: string | null;
  address?: string | null;
};

function normalizeEntity(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.’']/g, "")
    .replace(/\b(llc|inc|corp(?:oration)?|co(?:mpany)?|holdings|group|properties|realty|development|construction|industries|partners|partnership|lp|llp|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOwner(sig: { metadata: string | null }): string | null {
  if (!sig.metadata) return null;
  try {
    const m = JSON.parse(sig.metadata) as SignalMetadata;
    return m.owner_name?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") return Response.json({ error: "admin required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const dryRun = !!body.dry_run;
  const since  = body.since ? new Date(body.since) : null;

  // Pull all signals with non-null owner from metadata (last 365 days)
  const cutoff = since ?? new Date(Date.now() - 365 * 86_400_000);
  const signals = await prisma.marketSignal.findMany({
    where: { createdAt: { gte: cutoff } },
    select: {
      id: true, leadId: true, signalType: true, source: true,
      sourceUrl: true, headline: true, metadata: true, createdAt: true,
      aiRelevanceScore: true,
    },
  });

  // Group by normalized owner
  const clusters = new Map<string, typeof signals>();
  for (const s of signals) {
    const owner = extractOwner(s);
    if (!owner) continue;
    const key = normalizeEntity(owner);
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(s);
  }

  // Find multi-source clusters (cross-source corroboration)
  let leadsPromoted = 0;
  let signalsLinked = 0;
  const interesting: Array<{ entity: string; sources: string[]; signal_count: number }> = [];

  for (const [entity, group] of clusters) {
    const distinctSources = new Set(group.map((s) => s.signalType));
    if (distinctSources.size < 2) continue;   // single-source cluster, skip

    interesting.push({
      entity,
      sources: Array.from(distinctSources),
      signal_count: group.length,
    });

    if (dryRun) continue;

    // Find the oldest signal in this cluster that has a lead — that becomes
    // the canonical lead for the cluster.
    const withLead = group.filter((s) => s.leadId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (withLead.length === 0) {
      // No existing lead — create one from the highest-scored signal
      const best = group.sort((a, b) => (b.aiRelevanceScore ?? 0) - (a.aiRelevanceScore ?? 0))[0];
      const owner = extractOwner(best);
      if (!owner) continue;
      const lead = await prisma.marketLead.create({
        data: {
          title: `${owner.slice(0, 80)} — ${best.headline.slice(0, 100)}`,
          leadType: "RELATIONSHIP",
          source: "cross_source_match",
          sourceUrl: best.sourceUrl,
          aiScore: best.aiRelevanceScore ?? 60,
          confidence: "MEDIUM",
          aiInsights: JSON.stringify({
            cross_source_match: true,
            matched_entity: owner,
            matched_sources: Array.from(distinctSources),
            signal_count: group.length,
          }),
          detectedAt: group[0].createdAt,
        },
      });
      leadsPromoted += 1;
      // Link all signals in the cluster to this lead
      await prisma.marketSignal.updateMany({
        where: { id: { in: group.map((s) => s.id) } },
        data:  { leadId: lead.id },
      });
      signalsLinked += group.length;
    } else {
      // Has a lead — link any orphan signals in the cluster to it
      const canonicalLead = withLead[0].leadId!;
      const orphans = group.filter((s) => !s.leadId);
      if (orphans.length > 0) {
        await prisma.marketSignal.updateMany({
          where: { id: { in: orphans.map((s) => s.id) } },
          data:  { leadId: canonicalLead },
        });
        signalsLinked += orphans.length;
      }
      // Upgrade confidence on the lead to HIGH (cross-source corroborated)
      await prisma.marketLead.update({
        where: { id: canonicalLead },
        data:  { confidence: "HIGH" },
      });
      leadsPromoted += 1;
    }
  }

  return Response.json({
    dry_run: dryRun,
    cutoff_iso: cutoff.toISOString(),
    signals_scanned: signals.length,
    clusters_total: clusters.size,
    multi_source_clusters: interesting.length,
    leads_promoted: leadsPromoted,
    signals_linked: signalsLinked,
    sample: interesting.slice(0, 10),
  });
}
