import type { Blueprint } from "@/domain"

/** What the `blueprints.graph_json` column holds: everything except the row's own columns (id, name, timestamps). */
export function graphJson(bp: Blueprint): string {
  return JSON.stringify({ nodes: bp.nodes, edges: bp.edges, viewport: bp.viewport, meta: bp.meta })
}
