/**
 * IR → SPICE text serializer (SPEC §4.1: "the IR serializes back to SPICE").
 * Combined with parseNetlist this satisfies the round-trip property
 * `parse(serialize(ir)) === ir` (SPEC §5.1, §13.3), using exact number
 * formatting (`formatExact`).
 */

import type { Circuit, Element, Expr, Waveform } from "@spicekit/protocol";
import { DEFAULT_SIM_OPTIONS } from "@spicekit/protocol";

import { formatExact } from "./suffix.ts";

function val(expr: Expr): string {
  return typeof expr === "number" ? formatExact(expr) : `{${expr}}`;
}

function optional(prefix: string, expr: Expr | undefined): string {
  return expr === undefined ? "" : ` ${prefix} ${val(expr)}`;
}

export function serializeNetlist(circuit: Circuit): string {
  const lines: string[] = [circuit.title.length > 0 ? circuit.title : "Untitled"];
  for (const element of circuit.elements) {
    lines.push(serializeElement(element));
  }
  for (const model of Object.values(circuit.models)) {
    lines.push(serializeModel(model));
  }
  for (const sub of Object.values(circuit.subcircuits)) {
    lines.push(...serializeSubcircuit(sub));
  }
  if (Object.keys(circuit.params).length > 0) {
    lines.push(serializeParams(circuit));
  }
  lines.push(...serializeOptions(circuit));
  if (circuit.ic !== undefined && Object.keys(circuit.ic).length > 0) {
    const pairs = Object.entries(circuit.ic).map(([n, v]) => `v(${n})=${formatExact(v)}`);
    lines.push(`.ic ${pairs.join(" ")}`);
  }
  for (const analysis of circuit.analyses) {
    lines.push(serializeAnalysis(analysis));
  }
  if (circuit.probes.length > 0) {
    lines.push(`.probe ${circuit.probes.map((p) => p.signal).join(" ")}`);
  }
  lines.push(".end");
  return `${lines.join("\n")}\n`;
}

function serializeElement(el: Element): string {
  switch (el.type) {
    case "R": {
      let tc = "";
      if (el.tc1 !== undefined) {
        tc =
          el.tc2 !== undefined
            ? ` TC=${formatExact(el.tc1)},${formatExact(el.tc2)}`
            : ` TC=${formatExact(el.tc1)}`;
      }
      return `${el.name} ${el.n[0]} ${el.n[1]} ${val(el.value)}${tc}`;
    }
    case "C":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${val(el.value)}${el.ic !== undefined ? ` IC=${formatExact(el.ic)}` : ""}`;
    case "L":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${val(el.value)}${el.ic !== undefined ? ` IC=${formatExact(el.ic)}` : ""}`;
    case "K":
      return `${el.name} ${el.inductors[0]} ${el.inductors[1]} ${val(el.coupling)}`;
    case "V":
    case "I":
      return serializeSource(el);
    case "E":
      return `${el.name} ${el.n.join(" ")} ${num(el.gain)}`;
    case "G":
      return `${el.name} ${el.n.join(" ")} ${num(el.gm)}`;
    case "F":
    case "H":
      return `${el.name} ${el.n.join(" ")} ${str(el.control)} ${num(el.gain)}`;
    case "D":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${el.model}${areaSuffix(el.area)}`;
    case "Q":
      return `${el.name} ${el.n.join(" ")} ${el.model}${areaSuffix(el.area)}`;
    case "M":
      return `${el.name} ${el.n.join(" ")} ${el.model}${wls(el)}`;
    case "J":
      return `${el.name} ${el.n.join(" ")} ${el.model}${areaSuffix(el.area)}`;
    case "S":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${el.ctrl[0]} ${el.ctrl[1]} ${el.model}${onOffSuffix(el)}`;
    case "W":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${el.control} ${el.model}${onOffSuffix(el)}`;
    case "B":
      return `${el.name} ${el.n[0]} ${el.n[1]} ${el.kind} = ${el.expr}`;
    case "X":
      return `${el.name} ${el.n.join(" ")} ${el.subckt}`;
  }
}

/** ON/OFF suffix for switch cards (round-trips the initial state). */
function onOffSuffix(el: Extract<Element, { type: "S" | "W" }>): string {
  if (el.on === true) {
    return " ON";
  }
  if (el.on === false) {
    return " OFF";
  }
  return "";
}

/** Index-signature fields on E/G/F/H are typed unknown; narrow defensively. */
function num(x: unknown): string {
  return typeof x === "number" ? formatExact(x) : "0";
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function areaSuffix(area: number | undefined): string {
  return area !== undefined ? ` ${formatExact(area)}` : "";
}

function wls(m: Extract<Element, { type: "M" }>): string {
  let out = "";
  if (m.w !== undefined) {
    out += ` W=${val(m.w)}`;
  }
  if (m.l !== undefined) {
    out += ` L=${val(m.l)}`;
  }
  return out;
}

function serializeSource(el: Extract<Element, { type: "V" | "I" }>): string {
  let line = `${el.name} ${el.n[0]} ${el.n[1]}`;
  line += optional("DC", el.dc);
  if (el.ac !== undefined) {
    line += ` AC ${formatExact(el.ac.mag)}${el.ac.phase !== undefined ? ` ${formatExact(el.ac.phase)}` : ""}`;
  }
  if (el.wave !== undefined) {
    line += ` ${serializeWave(el.wave)}`;
  }
  return line;
}

function serializeWave(w: Waveform): string {
  switch (w.kind) {
    case "SIN": {
      const args = [w.offset, w.amp, w.freq, w.delay, w.damping, w.phase]
        .filter((x) => x !== undefined)
        .map((x) => val(x))
        .join(" ");
      return `SIN(${args})`;
    }
    case "PULSE":
      return `PULSE(${[w.v1, w.v2, w.delay, w.rise, w.fall, w.width, w.period].map((x) => val(x)).join(" ")})`;
    case "PWL":
      return `PWL(${w.points.map(([t, v]) => `${formatExact(t)} ${formatExact(v)}`).join(" ")}${w.repeat === true ? " REPEAT" : ""})`;
    case "EXP":
    case "SFFM":
    case "AM":
    case "NOISE":
    case "EXTERNAL":
    case "TRIANGLE":
    case "SAWTOOTH":
    case "SQUARE":
      throw new Error(`serializeWave: ${w.kind} serialization lands with E2/E3`);
  }
}

function serializeModel(model: {
  name: string;
  type: string;
  parameters: Record<string, number | string>;
}): string {
  const params = Object.entries(model.parameters)
    .map(([k, v]) => `${k}=${typeof v === "number" ? formatExact(v) : v}`)
    .join(" ");
  const body = params.length > 0 ? ` (${params})` : "";
  return `.model ${model.name} ${model.type}${body}`;
}

function serializeSubcircuit(sub: {
  name: string;
  ports: readonly string[];
  circuit: Circuit;
}): string[] {
  const body = sub.circuit;
  const paramKeys = Object.keys(body.params);
  const portSuffix =
    paramKeys.length > 0
      ? ` params: ${paramKeys.map((k) => `${k}=${typeof body.params[k] === "number" ? formatExact(body.params[k]) : `{${String(body.params[k])}}`}`).join(" ")}`
      : "";
  const lines = [`.subckt ${sub.name} ${sub.ports.join(" ")}${portSuffix}`];
  for (const el of body.elements) {
    lines.push(serializeElement(el));
  }
  for (const model of Object.values(body.models)) {
    lines.push(serializeModel(model));
  }
  lines.push(`.ends ${sub.name}`);
  return lines;
}

function serializeParams(circuit: Circuit): string {
  const parts = Object.entries(circuit.params).map(([k, v]) =>
    typeof v === "number" ? `${k}=${formatExact(v)}` : `${k}={${v}}`,
  );
  return `.param ${parts.join(" ")}`;
}

function serializeOptions(circuit: Circuit): string[] {
  const defaults = DEFAULT_SIM_OPTIONS;
  const entries: string[] = [];
  const keys: readonly (keyof typeof defaults)[] = [
    "reltol",
    "abstol",
    "vntol",
    "gmin",
    "itl1",
    "itl4",
    "trtol",
    "method",
    "temp",
    "tnom",
  ];
  for (const key of keys) {
    const value = circuit.options[key];
    if (value !== defaults[key]) {
      entries.push(
        `${key.toLowerCase()}=${typeof value === "number" ? formatExact(value) : value}`,
      );
    }
  }
  if (
    circuit.options.maxStepRatio !== undefined &&
    circuit.options.maxStepRatio !== defaults.maxStepRatio
  ) {
    entries.push(`maxstep=${formatExact(circuit.options.maxStepRatio)}`);
  }
  return entries.length > 0 ? [`.options ${entries.join(" ")}`] : [];
}

function serializeAnalysis(a: { kind: string } & Record<string, unknown>): string {
  switch (a.kind) {
    case "op":
      return ".op";
    case "dc": {
      const base = `.dc ${a.source as string} ${formatExact(a.start as number)} ${formatExact(a.stop as number)} ${formatExact(a.step as number)}`;
      const second = a.second as
        | { source: string; start: number; stop: number; step: number }
        | undefined;
      return second === undefined
        ? base
        : `${base} ${second.source} ${formatExact(second.start)} ${formatExact(second.stop)} ${formatExact(second.step)}`;
    }
    case "tran": {
      let line = `.tran ${formatExact(a.tstep as number)} ${formatExact(a.tstop as number)}`;
      if (a.tstart !== undefined) {
        line += ` ${formatExact(a.tstart as number)}`;
        if (a.tmax !== undefined) {
          line += ` ${formatExact(a.tmax as number)}`;
        }
      } else if (a.tmax !== undefined) {
        line += ` 0 ${formatExact(a.tmax as number)}`;
      }
      if (a.uic === true) {
        line += " uic";
      }
      return line;
    }
    case "ac":
      return `.ac ${(a.sweep as string).toLowerCase()} ${formatExact(a.points as number)} ${formatExact(a.fstart as number)} ${formatExact(a.fstop as number)}`;
    default:
      throw new Error(`serializeAnalysis: unsupported analysis "${a.kind}"`);
  }
}
