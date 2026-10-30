/**
 * Engine facade + CLI tests (SPEC §7.2, E1: `run` and `check`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCircuit, simulateCircuit, simulateNetlist } from "@spicekit/core";
import { type Circuit, DEFAULT_SIM_OPTIONS } from "@spicekit/protocol";

const CLI = join(import.meta.dir, "..", "src", "index.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

function circuit(elements: Circuit["elements"], analyses: Circuit["analyses"] = []): Circuit {
  return {
    title: "Engine",
    elements,
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses,
    probes: [],
  };
}

describe("engine facade", () => {
  test("loadCircuit returns tables and warnings", () => {
    const outcome = loadCircuit(
      circuit([
        { type: "V", name: "V1", n: ["a", "0"] }, // no DC → warning
        { type: "R", name: "R1", n: ["a", "0"], value: 1000 },
      ]),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.nodeNames).toEqual(["a"]);
    expect(outcome.branchNames).toEqual(["V1"]);
    expect(outcome.warnings).toHaveLength(1);
  });

  test("loadCircuit reports typed errors without throwing", () => {
    const outcome = loadCircuit(circuit([{ type: "R", name: "R1", n: ["a", "b"], value: 1000 }]));
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("E_NO_GROUND");
  });

  test("simulateNetlist runs declared analyses (default .op)", () => {
    const { title, results } = simulateNetlist("T\nV1 a 0 5\nR1 a 0 1k");
    expect(title).toBe("T");
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("op");
    expect(results[0]?.signals.find((s) => s.name === "v(a)")?.values[0]).toBe(5);
  });

  test("simulateCircuit runs every declared analysis in order", () => {
    const results = simulateCircuit(
      circuit(
        [
          {
            type: "V",
            name: "V1",
            n: ["a", "0"],
            dc: 0,
            wave: {
              kind: "PULSE",
              v1: 0,
              v2: 5,
              delay: 0,
              rise: 1e-9,
              fall: 1e-9,
              width: 1,
              period: 2,
            },
          },
          { type: "R", name: "R1", n: ["a", "b"], value: 1000 },
          { type: "C", name: "C1", n: ["b", "0"], value: 1e-6 },
        ],
        [{ kind: "op" }, { kind: "tran", tstep: 1e-4, tstop: 1e-3 }],
      ),
    );
    expect(results.map((r) => r.kind)).toEqual(["op", "tran"]);
    expect(results[1]?.axis.length).toBe(11);
  });
});

describe("CLI", () => {
  function cli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(["bun", CLI, ...args]);
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }

  test("check prints tables and exits 0", () => {
    const r = cli(["check", join(FIXTURES, "rc-divider.cir")]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Nodes:");
    expect(r.stdout).toContain("OK");
  });

  test("check reports located errors with exit 1", () => {
    const r = cli(["check", join(FIXTURES, "floating.cir")]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("E_FLOATING_NODE");
  });

  test("check surfaces parse diagnostics with line numbers", () => {
    const r = cli(["check", join(FIXTURES, "parse-error.cir")]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("E_PARSE");
    expect(r.stderr).toContain("line 3");
  });

  test("run executes op + tran and prints values", () => {
    const r = cli(["run", join(FIXTURES, "rc-divider.cir")]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("op");
    expect(r.stdout).toContain("tran");
    expect(r.stdout).toContain("v(out)");
    expect(r.stdout).toContain("analysis(es)");
  });

  test("run --csv emits header and rows", () => {
    const r = cli(["run", join(FIXTURES, "rc-divider.cir"), "--csv"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("time,v(out)");
  });

  test("run --json emits valid JSON with signal arrays", () => {
    const r = cli(["run", join(FIXTURES, "rc-divider.cir"), "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      kind: string;
      signals: { name: string; values: number[] }[];
    }[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]?.signals.length).toBeGreaterThan(0);
  });

  test("run of a broken netlist exits 1 with the engine error", () => {
    const r = cli(["run", join(FIXTURES, "floating.cir")]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("E_FLOATING_NODE");
  });

  test("--help exits 0 and lists commands", () => {
    const r = cli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("spicekit run");
    expect(r.stdout).toContain("spicekit check");
  });

  test("convert round-trips netlist ⇄ IR JSON (E4)", () => {
    const tmpIn = join(FIXTURES, "convert-in.cir");
    const tmpJson = join(FIXTURES, "convert-out.json");
    const tmpBack = join(FIXTURES, "convert-back.cir");
    writeFileSync(tmpIn, "convert rt\nV1 a 0 5\nR1 a b 1k\nRl b 0 1k\n.end\n");
    try {
      const r1 = cli(["convert", tmpIn, tmpJson]);
      expect(r1.exitCode).toBe(0);
      const ir = JSON.parse(readFileSync(tmpJson, "utf8")) as Circuit;
      expect(ir.elements.length).toBe(3);
      const r2 = cli(["convert", tmpJson, tmpBack]);
      expect(r2.exitCode).toBe(0);
      const text = readFileSync(tmpBack, "utf8");
      expect(text).toContain("V1 a 0 DC 5");
      expect(text).toContain(".end");
    } finally {
      for (const f of [tmpIn, tmpJson, tmpBack]) {
        try {
          unlinkSync(f);
        } catch {
          // best effort cleanup
        }
      }
    }
  });

  test("serve starts the WebSocket host and answers /healthz (E4)", async () => {
    const port = 47_781;
    const proc = Bun.spawn(["bun", CLI, "serve", "--port", String(port)], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    try {
      // Poll until the host answers (or time out).
      let ok = false;
      for (let i = 0; i < 50 && !ok; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/healthz`);
          ok = res.status === 200;
        } catch {
          await sleep(100);
        }
      }
      expect(ok).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 15_000);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
