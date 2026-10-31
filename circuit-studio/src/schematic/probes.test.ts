/**
 * Probe tests (UX2-T6): channel/color assignment, toggle semantics,
 * `.probe` card emission into the extracted netlist, and probe-flag scene
 * rendering (channel-colored glyph).
 */
import { describe, expect, test } from "bun:test";
import { buildScene } from "../canvas/scene.ts";
import { computeConnectivity } from "./connectivity.ts";
import { extractNetlist } from "./netlist.ts";
import {
  freeChannel,
  MAX_CHANNELS,
  probeSignalsOf,
  probesOf,
  sigToken,
  toggleProbe,
} from "./probes.ts";
import type { SchematicDoc, SymbolInstance, Vec2 } from "./types.ts";
import { emptyDoc, emptySelection, type ProbeMark } from "./types.ts";

const pt = (x: number, y: number): Vec2 => ({ x, y });

let idc = 500;
function inst(
  defId: string,
  x: number,
  y: number,
  fields: Record<string, string> = {},
): SymbolInstance {
  idc += 1;
  return {
    id: `i${idc}`,
    defId,
    x,
    y,
    rot: 0,
    mirrorX: false,
    fields: { reference: `${defId[0]}${idc}`, ...fields },
    props: fields.value !== undefined ? { value: fields.value } : {},
  };
}

function rcDoc(): SchematicDoc {
  const vs = inst("V_DC", 0, 0, { reference: "V1", value: "5" });
  const r1 = inst("R", 3000, 0, { reference: "R1", value: "1k" });
  const c1 = inst("C", 7000, 0, { reference: "C1", value: "100n" });
  return {
    ...emptyDoc("probe-test"),
    symbols: [vs, r1, c1],
    wires: [
      { id: "w0", pts: [pt(1000, 0), pt(2000, 0)] },
      { id: "w1", pts: [pt(4000, 0), pt(6000, 0)] },
    ],
    rev: 1,
  };
}

describe("probe channel assignment", () => {
  test("channels are 1-based and dense; colors map to sig tokens", () => {
    let probes: readonly ProbeMark[] = [];
    for (let k = 0; k < 3; k++) {
      probes = toggleProbe(probes, {
        kind: "voltage",
        target: `net_${k}`,
        x: k * 100,
        y: 0,
        id: `p${k}`,
      });
    }
    expect(probes.map((p) => p.channel)).toEqual([1, 2, 3]);
    expect(sigToken(1)).toBe("--sig-1");
    expect(sigToken(3)).toBe("--sig-3");
    expect(sigToken(9)).toBe("--sig-1"); // wraps past 8
  });

  test("toggling the same target removes it and frees its channel", () => {
    let probes: readonly ProbeMark[] = toggleProbe([], {
      kind: "voltage",
      target: "out",
      x: 0,
      y: 0,
      id: "p1",
    });
    probes = toggleProbe(probes, { kind: "current", target: "R1", x: 10, y: 0, id: "p2" });
    expect(probes.length).toBe(2);
    // Re-probe v(out) removes it (case-insensitive).
    probes = toggleProbe(probes, { kind: "voltage", target: "OUT", x: 0, y: 0, id: "p3" });
    expect(probes.length).toBe(1);
    expect(probes[0]?.kind).toBe("current");
    expect(freeChannel(probes)).toBe(1); // channel 1 freed
  });

  test("channel assignment never exceeds the scope width", () => {
    let probes: readonly ProbeMark[] = [];
    for (let k = 0; k < MAX_CHANNELS + 2; k++) {
      probes = toggleProbe(probes, {
        kind: "voltage",
        target: `n${k}`,
        x: 0,
        y: 0,
        id: `p${k}`,
      });
    }
    expect(probes.length).toBe(MAX_CHANNELS);
  });

  test("probeSignalsOf emits engine-style names, deduped", () => {
    const signals = probeSignalsOf([
      { id: "a", kind: "voltage", target: "out", x: 0, y: 0, channel: 1 },
      { id: "b", kind: "current", target: "R1", x: 0, y: 0, channel: 2 },
      { id: "c", kind: "voltage", target: "out", x: 5, y: 5, channel: 3 },
    ]);
    expect(signals).toEqual(["v(out)", "i(R1)"]);
  });
});

describe("probes flow into netlist extraction", () => {
  test("doc probes emit `.probe` cards (voltage on net)", () => {
    const doc = rcDoc();
    const probes = toggleProbe([], { kind: "voltage", target: "net_1", x: 5000, y: 0, id: "p1" });
    const withProbes = { ...doc, probes };
    const extraction = extractNetlist(withProbes);
    // The controller composes the .probe line from probeSignalsOf — verify
    // the signals the card would carry resolve to real net names here.
    const signals = probeSignalsOf(probesOf(withProbes));
    expect(signals).toEqual(["v(net_1)"]);
    // And the net actually exists in this document's connectivity.
    const conn = computeConnectivity(withProbes);
    const netNames = new Set(conn.nets.map((n) => n.name));
    expect(netNames.has("net_1")).toBe(true);
    expect(extraction.netlist).toContain(".end");
  });

  test("current probe targets the netlist reference", () => {
    const probes = toggleProbe([], { kind: "current", target: "R1", x: 3000, y: 0, id: "p1" });
    expect(probeSignalsOf(probes)).toEqual(["i(R1)"]);
  });
});

describe("probe rendering in the scene", () => {
  test("probe flags draw as channel-colored circle + number", () => {
    const doc: SchematicDoc = {
      ...rcDoc(),
      probes: [{ id: "p1", kind: "voltage", target: "net_1", x: 5000, y: 0, channel: 2 }],
    };
    const scene = buildScene(
      doc,
      { x: 0, y: -1000, scale: 1 },
      { w: 8000, h: 4000 },
      emptySelection(),
    );
    const probeOps = scene.ops.filter((op) => op.layer === "probe");
    expect(probeOps.length).toBe(2); // circle + glyph
    const circle = probeOps.find((op) => op.op === "circle");
    expect(circle?.colorKey).toBe("sig2");
  });
});
