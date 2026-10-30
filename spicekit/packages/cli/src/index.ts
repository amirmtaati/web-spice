#!/usr/bin/env bun
/**
 * `spicekit` CLI (SPEC §7.2): `run`, `check`, `convert`, `serve` over the
 * in-process engine / WebSocket host.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { RunResult } from "@spicekit/core";
import {
  describeError,
  loadCircuit,
  parseNetlist,
  serializeNetlist,
  simulateNetlist,
} from "@spicekit/core";
import type { Circuit } from "@spicekit/protocol";

function usage(): string {
  return `spicekit — SPICE-class circuit simulation

Usage:
  spicekit run <netlist> [--csv|--json]   Run all analyses in a netlist
  spicekit check <netlist>                Parse + pre-flight checks
  spicekit convert <in> <out>             Netlist ⇄ circuit-IR JSON
  spicekit serve [--port N]               Start the WebSocket engine server

Options:
  --csv     Machine-readable CSV output
  --json    JSON output
  -h, --help  This help`;
}

function readNetlist(path: string): string {
  return readFileSync(path, "utf8");
}

function formatSignalValue(v: number): string {
  if (!Number.isFinite(v)) {
    return String(v);
  }
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) {
    return v.toExponential(4);
  }
  return v.toPrecision(6).replace(/\.?0+$/, "");
}

function printOpLike(result: RunResult): void {
  console.log(
    `  ${result.kind} — ${result.stats.points} point(s), op via ${result.stats.opMethod}`,
  );
  for (const s of result.signals) {
    console.log(`    ${s.name.padEnd(12)} ${formatSignalValue(s.values[0] ?? 0)}`);
  }
}

function printSweep(result: RunResult, csv: boolean): void {
  const cols = [
    result.axisName,
    ...(result.axis2Name !== undefined ? [result.axis2Name] : []),
    ...result.signals.map((s) => s.name),
  ];
  if (csv) {
    console.log(cols.join(","));
  } else {
    console.log(`  ${result.kind} — ${result.stats.points} points (${cols.join(", ")})`);
  }
  const n = result.stats.points;
  const rows = csv || n <= 30 ? range(n) : [...range(12), -1, ...range(n - 8, n)];
  for (const i of rows) {
    if (i === -1) {
      console.log(csv ? "..." : "    ...");
      continue;
    }
    const cells = [
      result.axis[i] ?? 0,
      ...(result.axis2 !== undefined ? [result.axis2[i] ?? 0] : []),
      ...result.signals.map((s) => s.values[i] ?? 0),
    ];
    const line = cells.map(formatSignalValue).join(csv ? "," : "  ");
    console.log(csv ? line : `    ${line}`);
  }
}

function range(n: number, from = 0): number[] {
  return Array.from({ length: Math.max(0, n - from) }, (_, i) => i + from);
}

function printResults(results: RunResult[], csv: boolean, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          kind: r.kind,
          axisName: r.axisName,
          axis: [...r.axis],
          ...(r.axis2 !== undefined ? { axis2: [...r.axis2] } : {}),
          signals: r.signals.map((s) => ({ name: s.name, values: [...s.values] })),
          stats: r.stats,
        })),
      ),
    );
    return;
  }
  for (const result of results) {
    if (result.kind === "op") {
      printOpLike(result);
    } else {
      printSweep(result, csv);
    }
  }
}

function run(args: string[]): number {
  const file = args.find((a) => !a.startsWith("--"));
  if (file === undefined) {
    console.error("spicekit run: missing netlist path\n");
    console.error(usage());
    return 2;
  }
  const csv = args.includes("--csv");
  const json = args.includes("--json");
  try {
    const text = readNetlist(file);
    const started = performance.now();
    const { title, results } = simulateNetlist(text);
    const elapsed = performance.now() - started;
    if (!json) {
      console.log(`Title: ${title}`);
      printResults(results, csv, false);
      const steps = results.reduce(
        (acc, r) => acc + r.stats.acceptedSteps + r.stats.rejectedSteps,
        0,
      );
      console.log(
        `\n${results.length} analysis(es) in ${elapsed.toFixed(1)} ms (${steps} integration steps)`,
      );
    } else {
      printResults(results, true, true);
    }
    return 0;
  } catch (error) {
    console.error(`spicekit run: ${describeError(error)}`);
    return 1;
  }
}

function check(args: string[]): number {
  const file = args.find((a) => !a.startsWith("--"));
  if (file === undefined) {
    console.error("spicekit check: missing netlist path\n");
    console.error(usage());
    return 2;
  }
  try {
    const text = readNetlist(file);
    const circuit = parseNetlist(text);
    const outcome = loadCircuit(circuit);
    if (!outcome.ok) {
      console.error(`spicekit check: ${outcome.error?.code}: ${outcome.error?.message}`);
      return 1;
    }
    console.log(`Title:    ${circuit.title}`);
    console.log(`Elements: ${circuit.elements.length}`);
    console.log(`Nodes:    ${outcome.nodeNames.join(", ") || "(none)"}`);
    if (outcome.branchNames.length > 0) {
      console.log(`Branches: ${outcome.branchNames.join(", ")}`);
    }
    for (const warning of outcome.warnings) {
      console.log(`Warning:  ${warning.message}`);
    }
    console.log("OK");
    return 0;
  } catch (error) {
    console.error(`spicekit check: ${describeError(error)}`);
    return 1;
  }
}

function convert(args: string[]): number {
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length !== 2) {
    console.error("spicekit convert: expected <in> <out>\n");
    console.error(usage());
    return 2;
  }
  const [input, output] = files as [string, string];
  try {
    const text = readFileSync(input, "utf8");
    let out: string;
    if (input.endsWith(".json")) {
      // IR JSON → netlist text.
      const circuit = JSON.parse(text) as Circuit;
      out = serializeNetlist(circuit);
    } else {
      // Netlist text → IR JSON.
      const circuit = parseNetlist(text);
      out = JSON.stringify(circuit, null, 2);
    }
    writeFileSync(output, out);
    console.log(`spicekit convert: wrote ${output}`);
    return 0;
  } catch (error) {
    console.error(`spicekit convert: ${describeError(error)}`);
    return 1;
  }
}

function serve(args: string[]): number {
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0) {
    const value = args[portIdx + 1];
    if (value !== undefined) {
      process.env.SPICEKIT_PORT = value;
    }
  }
  // Deferred import: keeps `run`/`check` usable without the server stack.
  void import("@spicekit/server").then((m) => {
    m.main();
  });
  return 0;
}

function main(): number {
  const args = Bun.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  switch (command) {
    case "run":
      return run(rest);
    case "check":
      return check(rest);
    case "convert":
      return convert(rest);
    case "serve":
      return serve(rest);
    case "--help":
    case "-h":
    case undefined:
      console.log(usage());
      return 0;
    default:
      console.error(`Unknown command: ${command}\n\n${usage()}`);
      return 1;
  }
}

process.exitCode = main();
