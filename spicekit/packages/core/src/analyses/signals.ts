/**
 * Signal naming and indexing (SPEC §5.5 outputs). Shared by the batch
 * analyses and the live session (E4) so streamed chunks carry exactly the
 * same signal names as buffered results.
 */

import type { Workspace } from "./workspace.ts";

/** All default signals: v(node) for every node, i(element) per branch. */
export function signalNamesFor(ws: Workspace): string[] {
  const names: string[] = [];
  for (const node of ws.compiled.nodeNames) {
    names.push(`v(${node.toLowerCase()})`);
  }
  for (const owner of ws.compiled.branchOwners) {
    // Device-internal KCL nodes (BJT b'/c'/e') are solver bookkeeping,
    // not probeable currents.
    if (owner.includes("#internal")) {
      continue;
    }
    names.push(`i(${owner.toLowerCase()})`);
  }
  return names;
}

/** Probe filter: undefined = all signals. */
export function probeWanted(ws: Workspace): Set<string> | undefined {
  const probes = ws.compiled.probes;
  return probes.length > 0 ? new Set(probes.map((pr) => pr.signal.toLowerCase())) : undefined;
}

/** MNA index of a `v(node)`/`i(element)` signal name; −1 when unknown. */
export function signalIndex(name: string, ws: Workspace): number {
  if (name.startsWith("v(")) {
    return ws.nodeIndexOf(name.slice(2, -1));
  }
  if (name.startsWith("i(")) {
    const owner = name.slice(2, -1).toLowerCase();
    const branchIdx = ws.compiled.branchOwners.findIndex((o) => o.toLowerCase() === owner);
    if (branchIdx === -1) {
      return -1;
    }
    return ws.nodeCount + branchIdx;
  }
  return -1;
}
