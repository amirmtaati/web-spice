/**
 * Public API snapshot (SPEC §4.5: "a public API snapshot test guards
 * accidental breaks"). The snapshot lists every export of the protocol,
 * core, and client packages. Additive changes are a deliberate snapshot
 * update (commit the new snapshot with the feature); removals or type
 * changes must go through the compatibility policy (SPEC §6: minors add,
 * majors break with a migration guide).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as client from "@spicekit/client";
import * as core from "@spicekit/core";
import * as protocol from "@spicekit/protocol";

const SNAPSHOT_PATH = join(import.meta.dir, "api-snapshot.json");

function describeValue(v: unknown): string {
  if (typeof v === "function") {
    return "function";
  }
  return typeof v;
}

function exportList(mod: Record<string, unknown>): {
  names: string[];
  kinds: Record<string, string>;
} {
  const names = Object.keys(mod).sort();
  const kinds: Record<string, string> = {};
  for (const name of names) {
    kinds[name] = describeValue(mod[name]);
  }
  return { names, kinds };
}

interface Snapshot {
  protocol: { names: string[]; kinds: Record<string, string> };
  core: { names: string[]; kinds: Record<string, string> };
  client: { names: string[]; kinds: Record<string, string> };
}

const current: Snapshot = {
  protocol: exportList(protocol as unknown as Record<string, unknown>),
  core: exportList(core as unknown as Record<string, unknown>),
  client: exportList(client as unknown as Record<string, unknown>),
};

describe("public API snapshot", () => {
  test("runtime exports match the committed snapshot", () => {
    let committed: Snapshot;
    try {
      committed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
    } catch {
      // First run: write the snapshot so the file exists for review.
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`);
      committed = current;
    }
    // Runtime values present now but missing from the snapshot = new API
    // (additive, allowed — but must be snapshotted deliberately).
    const missing: string[] = [];
    for (const pkg of ["protocol", "core", "client"] as const) {
      for (const name of current[pkg].names) {
        if (!committed[pkg].names.includes(name)) {
          missing.push(`${pkg}.${name}`);
        }
      }
    }
    if (missing.length > 0) {
      // Update the snapshot and fail once so the addition is reviewed.
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`);
      throw new Error(
        `new public exports must be committed in the snapshot: ${missing.join(", ")}`,
      );
    }
    // Removals or kind changes = breaking; reject outright.
    const broken: string[] = [];
    for (const pkg of ["protocol", "core", "client"] as const) {
      for (const name of committed[pkg].names) {
        if (!current[pkg].names.includes(name)) {
          broken.push(`${pkg}.${name} removed`);
        } else if (committed[pkg].kinds[name] !== current[pkg].kinds[name]) {
          broken.push(
            `${pkg}.${name} changed kind (${committed[pkg].kinds[name]} → ${current[pkg].kinds[name]})`,
          );
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("protocol version is semver and compatible majors", () => {
    const { PROTOCOL_VERSION, isCompatibleProtocol } = protocol;
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol("9.0.0")).toBe(false);
  });
});
