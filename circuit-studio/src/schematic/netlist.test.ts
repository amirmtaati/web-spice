/**
 * Connectivity + netlist extraction tests (UX1-T5/T9): KiCad junction
 * semantics, deterministic net naming, golden netlists for canonical
 * circuits, interactive element expansion.
 */
import { describe, expect, it } from "bun:test";
import { computeConnectivity } from "./connectivity.ts";
import { extractNetlist } from "./netlist.ts";
import type { SchematicDoc, SymbolInstance, Vec2 } from "./types.ts";
import { emptyDoc } from "./types.ts";

const v = (x: number, y: number): Vec2 => ({ x, y });

let idc = 100;
function inst(
  defId: string,
  x: number,
  y: number,
  fields: Record<string, string> = {},
  props: Record<string, string> = {},
): SymbolInstance {
  idc += 1;
  return {
    id: `i${idc}`,
    defId,
    x,
    y,
    rot: 0,
    mirrorX: false,
    fields: { reference: `${defId}${idc}`, ...fields },
    props,
  };
}

function docWith(
  symbols: readonly SymbolInstance[],
  wires: readonly { pts: Vec2[] }[],
): SchematicDoc {
  const base = emptyDoc("test");
  return {
    ...base,
    symbols,
    wires: wires.map((w, i) => ({ id: `w${i}`, pts: w.pts })),
    rev: 1,
  };
}

/** Canonical RC low-pass: V+ → R1 → mid → C1 → gnd, V− → gnd. */
function rcDoc(): { doc: SchematicDoc; ids: string[] } {
  const vSrc = inst("V_DC", 0, 0, { reference: "V1" }, { value: "5" });
  const r1 = inst("R", 3000, 0, { reference: "R1", value: "1k" }, { value: "1k" });
  const c1 = inst("C", 7000, 0, { reference: "C1", value: "100n" }, { value: "100n" });
  const g1 = inst("GND", -1000, 2000, { net: "GND" }, { net: "GND" });
  const g2 = inst("GND", 8000, 2000, { net: "GND" }, { net: "GND" });
  const doc = docWith(
    [vSrc, r1, c1, g1, g2],
    [
      { pts: [v(-1000, 0), v(-1000, 2000)] }, // V.p down to ground
      { pts: [v(1000, 0), v(2000, 0)] }, // V.n → R.a
      { pts: [v(4000, 0), v(6000, 0)] }, // R.b → C.a
      { pts: [v(8000, 0), v(8000, 2000)] }, // C.b down to ground
    ],
  );
  return { doc, ids: [vSrc.id, r1.id, c1.id, g1.id, g2.id] };
}

describe("computeConnectivity", () => {
  it("two pins wired together share one net", () => {
    const doc = docWith(
      [inst("R", 0, 0), inst("V_DC", 4000, 0)],
      [{ pts: [v(1000, 0), v(3000, 0)] }],
    );
    const c = computeConnectivity(doc);
    expect(c.nets.filter((n) => n.pins.length === 2).length).toBe(1);
  });

  it("unconnected pins form single-pin nets", () => {
    const doc = docWith([inst("R", 0, 0)], []);
    const c = computeConnectivity(doc);
    expect(c.pinNet.size).toBe(2);
    for (const n of c.pinNet.values()) expect(n.pins.length).toBe(1);
  });

  it("ground port names its net 0", () => {
    const { doc, ids } = rcDoc();
    const c = computeConnectivity(doc);
    const vPlus = c.pinNet.get(`${ids[0]}:p`);
    const cB = c.pinNet.get(`${ids[2]}:b`);
    expect(vPlus?.name).toBe("0");
    expect(vPlus?.isGround).toBe(true);
    expect(cB?.isGround).toBe(true);
  });

  it("a wire end landing on another wire's interior connects all three", () => {
    const doc = docWith(
      [inst("R", 0, 0), inst("C", 2000, 2000), inst("L", 0, 2000)],
      [
        { pts: [v(-1000, 0), v(3000, 0)] },
        { pts: [v(1000, 0), v(1000, 2000)] },
        { pts: [v(-1000, 2000), v(3000, 2000)] },
      ],
    );
    const c = computeConnectivity(doc);
    const rb = c.pinNet.get(`${doc.symbols[0]?.id ?? ""}:b`);
    const ca = c.pinNet.get(`${doc.symbols[1]?.id ?? ""}:a`);
    const la = c.pinNet.get(`${doc.symbols[2]?.id ?? ""}:a`);
    expect(rb?.name).toBe(ca?.name);
    expect(ca?.name).toBe(la?.name);
  });

  it("labels rename nets deterministically", () => {
    const doc = docWith([inst("R", 0, 0), inst("C", 4000, 0)], [{ pts: [v(1000, 0), v(3000, 0)] }]);
    const withLabel = {
      ...doc,
      labels: [
        { id: "lbl1", kind: "local" as const, text: "mid", at: v(2000, 0), rot: 0 as const },
      ],
    };
    const c = computeConnectivity(withLabel);
    const rb = c.pinNet.get(`${doc.symbols[0]?.id ?? ""}:b`);
    expect(rb?.name).toBe("mid");
  });
});

describe("extractNetlist", () => {
  it("RC low-pass golden netlist", () => {
    const { doc, ids } = rcDoc();
    const ex = extractNetlist(doc);
    expect(ex.netlist).toBe(
      ["* test", "C1 net_1 0 100n", "R1 net_0 net_1 1k", "V1 0 net_0 DC 5", ".end"].join("\n"),
    );
    const v1Card = ex.netlist.split("\n").findIndex((l) => l.startsWith("V1 "));
    expect(ex.sourceMap.get(v1Card)?.instanceId).toBe(ids[0]);
    expect(ex.warnings).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const { doc } = rcDoc();
    expect(extractNetlist(doc).netlist).toBe(extractNetlist(doc).netlist);
  });

  it("expands a potentiometer into two resistors split by travel", () => {
    const pot = inst("R_POT", 0, 0, { reference: "RV1", value: "10k" }, { travel: "0.25" });
    const ex = extractNetlist(docWith([pot], []));
    const lines = ex.netlist.split("\n");
    // Unconnected pins still get deterministic net names.
    expect(lines).toContain("RV1a net_0 net_1 2500");
    expect(lines).toContain("RV1b net_1 net_2 7500");
  });

  it("expands a switch into an S-card with a synthesized control source", () => {
    const sw = inst("SW_SPST", 0, 0, { reference: "SW1" }, { state: "1" });
    const ex = extractNetlist(docWith([sw], []));
    const lines = ex.netlist.split("\n");
    expect(lines.some((l) => /^SW1 net_\S+ net_\S+ net__ctl_SW1 0 sw_fast$/.test(l))).toBe(true);
    expect(lines).toContain("V__ctl_SW1 net__ctl_SW1 0 DC 1");
  });

  it("SPDT switch drives the two throws complementarily", () => {
    const sw = inst("SW_SPDT", 0, 0, { reference: "SW1" }, { state: "1" });
    const ex = extractNetlist(docWith([sw], []));
    const lines = ex.netlist.split("\n");
    expect(lines).toContain("V__ctl_SW1a net__ctl_SW1a 0 DC 1");
    expect(lines).toContain("V__ctl_SW1b net__ctl_SW1b 0 DC 0");
  });

  it("ties MOSFET bulk to source when the bulk pin is unconnected", () => {
    const m = inst("M_NMOS", 0, 0, { reference: "M1" }, { model: "nmos_5v" });
    const ex = extractNetlist(docWith([m], []));
    const line = ex.netlist.split("\n").find((l) => l.startsWith("M1 ")) ?? "";
    const nodes = line.split(/\s+/).slice(1, 5);
    expect(nodes[2]).toBe(nodes[3]);
  });

  it("emits gates as B-cards with level props", () => {
    const g = inst("G_AND", 0, 0, { reference: "U1" }, { voh: "5", vol: "0", vh: "2.5" });
    const ex = extractNetlist(docWith([g], []));
    const line = ex.netlist.split("\n").find((l) => l.startsWith("BU1 ")) ?? "";
    expect(line).toContain("if(min(V(");
    expect(line).toContain("> 2.5, 5, 0)");
  });

  it("emits a transformer as two inductors plus a K-card", () => {
    const t = inst("XFMR", 0, 0, { reference: "T1" }, { l1: "1m", l2: "2m", k: "0.99" });
    const ex = extractNetlist(docWith([t], []));
    const lines = ex.netlist.split("\n");
    expect(lines.some((l) => /^LT1p net_\S+ net_\S+ 1m$/.test(l))).toBe(true);
    expect(lines.some((l) => /^LT1s net_\S+ net_\S+ 2m$/.test(l))).toBe(true);
    expect(lines.some((l) => /^KT1 LT1p LT1s 0\.99$/.test(l))).toBe(true);
  });

  it("warns on duplicate references", () => {
    const a = inst("R", 0, 0, { reference: "R1" });
    const b = inst("R", 5000, 0, { reference: "R1" });
    const ex = extractNetlist(docWith([a, b], []));
    expect(ex.warnings.some((w) => w.includes("duplicate reference"))).toBe(true);
  });
});
