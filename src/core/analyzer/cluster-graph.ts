/**
 * Cluster super-graph (change: add-hierarchical-map-navigation).
 *
 * Aggregates the EXISTING label-propagation communities (`communityId` /
 * `communityLabel` on every FunctionNode -- set during call-graph build) into a
 * coarse "map of regions": each community becomes one super-node, and calls that
 * cross community boundaries become weighted super-edges. This is the high-level
 * planner's view -- the lay of the land an agent reads before drilling into one
 * region. No re-clustering and no new threshold; it only recombines what the
 * graph already carries.
 */

import type { SerializedCallGraph, FunctionNode } from './call-graph.js';

export interface ClusterSuperNode {
  communityId: string;
  label: string;
  memberCount: number;
  fileCount: number;
  /** Files the community spans, most-populated first (absolute paths; caller relativizes). */
  topFiles: string[];
  /** Highest-fan-in member name -- the community's structural anchor. */
  topLandmark: string | null;
}

export interface ClusterSuperEdge {
  fromCommunity: string;
  toCommunity: string;
  /** Number of distinct cross-community call edges from -> to. */
  callCount: number;
}

export interface ClusterGraph {
  superNodes: ClusterSuperNode[];
  superEdges: ClusterSuperEdge[];
}

const TOP_FILES_PER_REGION = 3;

/**
 * Build the region-tier super-graph from a serialized call graph. Super-nodes are
 * communities; super-edges count distinct cross-community `calls` edges. External
 * and test nodes are excluded; self-edges (intra-community) are not super-edges.
 */
export function buildClusterGraph(graph: SerializedCallGraph): ClusterGraph {
  const communityOf = new Map<string, string>(); // nodeId -> communityId
  const byCommunity = new Map<string, FunctionNode[]>();
  for (const n of graph.nodes) {
    if (n.isExternal || n.isTest || !n.communityId) continue;
    communityOf.set(n.id, n.communityId);
    const arr = byCommunity.get(n.communityId);
    if (arr) arr.push(n); else byCommunity.set(n.communityId, [n]);
  }

  const superNodes: ClusterSuperNode[] = [];
  for (const [communityId, members] of byCommunity) {
    const fileCounts = new Map<string, number>();
    for (const n of members) fileCounts.set(n.filePath, (fileCounts.get(n.filePath) ?? 0) + 1);
    const topFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_FILES_PER_REGION)
      .map(([f]) => f);
    const anchor = members.reduce((best, n) => ((n.fanIn ?? 0) > (best.fanIn ?? 0) ? n : best), members[0]);
    superNodes.push({
      communityId,
      label: members[0].communityLabel ?? anchor.name,
      memberCount: members.length,
      fileCount: fileCounts.size,
      topFiles,
      topLandmark: anchor?.name ?? null,
    });
  }

  // Super-edges: count distinct cross-community call edges per (from, to).
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind && e.kind !== 'calls') continue;
    const from = communityOf.get(e.callerId);
    const to = communityOf.get(e.calleeId);
    if (!from || !to || from === to) continue; // skip external endpoints and intra-community
    const dedupe = `${e.callerId} -> ${e.calleeId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = `${from} ${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const superEdges: ClusterSuperEdge[] = [...counts.entries()].map(([key, callCount]) => {
    const [fromCommunity, toCommunity] = key.split(' ');
    return { fromCommunity, toCommunity, callCount };
  });

  return { superNodes, superEdges };
}
