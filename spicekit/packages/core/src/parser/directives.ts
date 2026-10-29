/**
 * Dot-directive parsing (SPEC §5.1): .param, .model, .subckt/.ends,
 * .options, analysis cards (.op/.dc/.tran/.ac), .ic, .print/.probe, .end.
 * Directives mutate a ParseAccumulator owned by the top-level parser.
 */

import type { AnalysisRequest, Circuit, ModelCard, SimOptions } from "@spicekit/protocol";
import { DEFAULT_SIM_OPTIONS } from "@spicekit/protocol";
import type { CardToken, LexCard } from "./lexer.ts";
import { NetlistSyntaxError } from "./lexer.ts";
import { parseValue } from "./suffix.ts";

/** State accumulated while walking the card stream. */
export interface ParseAccumulator {
  circuit: Circuit;
  /** Open .subckt bodies awaiting .ends (nesting support). */
  subcktStack: SubcktFrame[];
  ended: boolean;
}

interface SubcktFrame {
  name: string;
  ports: string[];
  body: Circuit;
}

export function newAccumulator(title: string): ParseAccumulator {
  return {
    circuit: emptyCircuit(title),
    subcktStack: [],
    ended: false,
  };
}

function emptyCircuit(title: string): Circuit {
  return {
    title,
    elements: [],
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [],
    probes: [],
  };
}

/** The circuit currently receiving cards (top level or open subcircuit). */
export function target(acc: ParseAccumulator): Circuit {
  const open = acc.subcktStack[acc.subcktStack.length - 1];
  return open !== undefined ? open.body : acc.circuit;
}

const FAIL = NetlistSyntaxError;

export function handleDirective(card: LexCard, acc: ParseAccumulator): void {
  const name = (card.tokens[0] as CardToken).text.toLowerCase();
  switch (name) {
    case ".param":
      parseParam(card, acc);
      return;
    case ".model":
      parseModel(card, acc);
      return;
    case ".subckt":
      parseSubcktOpen(card, acc);
      return;
    case ".ends":
      parseSubcktClose(card, acc);
      return;
    case ".options":
    case ".opt":
      parseOptions(card, acc);
      return;
    case ".op":
      target(acc).analyses.push({ kind: "op" });
      return;
    case ".dc":
      target(acc).analyses.push(parseDc(card));
      return;
    case ".tran":
      target(acc).analyses.push(parseTran(card));
      return;
    case ".ac":
      target(acc).analyses.push(parseAc(card));
      return;
    case ".ic":
      parseIc(card, acc);
      return;
    case ".print":
    case ".probe":
      parseProbes(card, acc);
      return;
    case ".end":
      acc.ended = true;
      return;
    default:
      throw new FAIL(
        `Unsupported directive "${(card.tokens[0] as CardToken).text}"`,
        card.startLine,
        1,
      );
  }
}

function parseParam(card: LexCard, acc: ParseAccumulator): void {
  const params = target(acc).params;
  let i = 1;
  while (i < card.tokens.length) {
    const t = card.tokens[i] as CardToken;
    const eq = t.text.indexOf("=");
    if (eq <= 0) {
      throw new FAIL(`.param expects name=value, got "${t.text}"`, t.line, t.col);
    }
    const key = t.text.slice(0, eq).toLowerCase();
    const inline = t.text.slice(eq + 1);
    if (inline.length > 0) {
      params[key] = paramValue(inline, t);
      i += 1;
    } else {
      const v = card.tokens[i + 1];
      if (v === undefined) {
        throw new FAIL(`Missing value for .param ${key}`, t.line, t.col);
      }
      params[key] = paramValue(v.text, v);
      i += 2;
    }
  }
}

/** Param values keep `{expr}` strings as expressions; numbers via parseValue. */
function paramValue(text: string, at: CardToken): number | string {
  if (text.startsWith("{")) {
    return text.slice(1, text.endsWith("}") ? -1 : undefined).trim();
  }
  try {
    return parseValue(text);
  } catch {
    throw new FAIL(`Invalid .param value "${text}"`, at.line, at.col);
  }
}

function parseModel(card: LexCard, acc: ParseAccumulator): void {
  const nameTok = card.tokens[1];
  const typeTok = card.tokens[2];
  if (nameTok === undefined || typeTok === undefined) {
    throw new FAIL(".model expects .model name type (params)", card.startLine, 1);
  }
  // The lexer keeps "type(param=..." glued into one token (waveform syntax
  // relies on that), so split the parameter group back off the type token.
  const typeRaw = typeTok.text;
  let modelType = typeRaw;
  let head = "";
  const paren = typeRaw.indexOf("(");
  if (paren >= 0) {
    modelType = typeRaw.slice(0, paren);
    head = typeRaw.slice(paren);
  }
  const model: ModelCard = { name: nameTok.text, type: modelType.toLowerCase(), parameters: {} };
  // Join the parameter group and strip a wrapping (...) if present.
  const rest = [head, ...card.tokens.slice(3).map((t) => t.text)].join(" ").trim();
  const inner = rest.startsWith("(") && rest.endsWith(")") ? rest.slice(1, -1) : rest;
  for (const piece of inner.split(/[\s,]+/)) {
    if (piece.length === 0) {
      continue;
    }
    const eq = piece.indexOf("=");
    if (eq <= 0) {
      continue; // bare level names etc. are tolerated in model cards
    }
    const key = piece.slice(0, eq).toLowerCase();
    const raw = piece.slice(eq + 1);
    try {
      model.parameters[key] = parseValue(raw);
    } catch {
      model.parameters[key] = raw; // string parameter (e.g. a model reference)
    }
  }
  target(acc).models[nameTok.text.toLowerCase()] = model;
}

function parseSubcktOpen(card: LexCard, acc: ParseAccumulator): void {
  const nameTok = card.tokens[1];
  if (nameTok === undefined) {
    throw new FAIL(".subckt expects a name", card.startLine, 1);
  }
  const ports: string[] = [];
  let params: Record<string, number | string> = {};
  let i = 2;
  while (i < card.tokens.length) {
    const t = card.tokens[i] as CardToken;
    if (t.text.toLowerCase() === "params:") {
      let j = i + 1;
      while (j < card.tokens.length) {
        const p = card.tokens[j] as CardToken;
        const eq = p.text.indexOf("=");
        if (eq <= 0) {
          break;
        }
        params = {
          ...params,
          [p.text.slice(0, eq).toLowerCase()]: paramValue(p.text.slice(eq + 1), p),
        };
        j += 1;
      }
      i = j;
      continue;
    }
    ports.push(t.text);
    i += 1;
  }
  const body = emptyCircuit(nameTok.text);
  body.params = params;
  acc.subcktStack.push({ name: nameTok.text, ports, body });
}

function parseSubcktClose(card: LexCard, acc: ParseAccumulator): void {
  const open = acc.subcktStack.pop();
  if (open === undefined) {
    throw new FAIL(".ends without matching .subckt", card.startLine, 1);
  }
  target(acc).subcircuits[open.name.toLowerCase()] = {
    name: open.name,
    ports: open.ports,
    circuit: open.body,
  };
}

const OPTION_KEYS: Readonly<Record<string, keyof SimOptions>> = {
  reltol: "reltol",
  abstol: "abstol",
  vntol: "vntol",
  gmin: "gmin",
  itl1: "itl1",
  itl4: "itl4",
  trtol: "trtol",
  method: "method",
  temp: "temp",
  tnom: "tnom",
  maxstep: "maxStepRatio",
};

function parseOptions(card: LexCard, acc: ParseAccumulator): void {
  const options = target(acc).options;
  for (let i = 1; i < card.tokens.length; i++) {
    const t = card.tokens[i] as CardToken;
    const text = t.text.replace(/^no(?=[a-z])/i, "");
    const eq = text.indexOf("=");
    if (eq <= 0) {
      throw new FAIL(`.options expects key=value, got "${t.text}"`, t.line, t.col);
    }
    const key = text.slice(0, eq).toLowerCase();
    const raw = text.slice(eq + 1);
    const mapped = OPTION_KEYS[key];
    if (mapped === undefined) {
      throw new FAIL(`Unknown .options key "${key}"`, t.line, t.col);
    }
    if (mapped === "method") {
      const method = raw.toLowerCase();
      if (method !== "trap" && method !== "be" && method !== "gear2" && method !== "gear") {
        throw new FAIL(`Invalid integration method "${raw}" (trap|be|gear2)`, t.line, t.col);
      }
      options.method = method === "gear" ? "gear2" : method;
      continue;
    }
    applyNumericOption(options, mapped, parseValue(raw));
  }
}

function applyNumericOption(options: SimOptions, key: keyof SimOptions, value: number): void {
  switch (key) {
    case "reltol":
      options.reltol = value;
      return;
    case "abstol":
      options.abstol = value;
      return;
    case "vntol":
      options.vntol = value;
      return;
    case "gmin":
      options.gmin = value;
      return;
    case "itl1":
      options.itl1 = value;
      return;
    case "itl4":
      options.itl4 = value;
      return;
    case "trtol":
      options.trtol = value;
      return;
    case "temp":
      options.temp = value;
      return;
    case "tnom":
      options.tnom = value;
      return;
    case "maxStepRatio":
      options.maxStepRatio = value;
      return;
    case "method":
    case "seed":
      return; // handled elsewhere / not numeric
    default:
      return;
  }
}

function sweepFrom(
  tokens: CardToken[],
  from: number,
): { sweep: { source: string; start: number; stop: number; step: number }; next: number } {
  const source = (tokens[from] as CardToken).text;
  const start = parseValue((tokens[from + 1] as CardToken).text);
  const stop = parseValue((tokens[from + 2] as CardToken).text);
  const step = parseValue((tokens[from + 3] as CardToken).text);
  return { sweep: { source, start, stop, step }, next: from + 4 };
}

function parseDc(card: LexCard): AnalysisRequest {
  const t = card.tokens;
  const first = sweepFrom(t, 1);
  if (t.length > first.next) {
    const second = sweepFrom(t, first.next);
    return { kind: "dc", ...first.sweep, second: second.sweep };
  }
  return { kind: "dc", ...first.sweep };
}

function parseTran(card: LexCard): AnalysisRequest {
  const t = card.tokens;
  if (t.length < 3) {
    throw new FAIL(".tran expects .tran tstep tstop [tstart [tmax]] [uic]", card.startLine, 1);
  }
  const tstep = parseValue((t[1] as CardToken).text);
  const tstop = parseValue((t[2] as CardToken).text);
  const req: AnalysisRequest & { kind: "tran" } = { kind: "tran", tstep, tstop };
  let i = 3;
  while (i < t.length) {
    const tok = t[i] as CardToken;
    if (tok.text.toLowerCase() === "uic") {
      req.uic = true;
      i += 1;
      continue;
    }
    if (i === 3) {
      req.tstart = parseValue(tok.text);
    } else if (i === 4) {
      req.tmax = parseValue(tok.text);
    } else {
      throw new FAIL(`Unexpected token "${tok.text}" in .tran`, tok.line, tok.col);
    }
    i += 1;
  }
  return req;
}

function parseAc(card: LexCard): AnalysisRequest {
  const t = card.tokens;
  if (t.length < 5) {
    throw new FAIL(".ac expects .ac dec|oct|lin points fstart fstop", card.startLine, 1);
  }
  const sweep = (t[1] as CardToken).text.toLowerCase();
  if (sweep !== "dec" && sweep !== "oct" && sweep !== "lin") {
    throw new FAIL(
      `Invalid .ac sweep type "${sweep}"`,
      (t[1] as CardToken).line,
      (t[1] as CardToken).col,
    );
  }
  return {
    kind: "ac",
    sweep,
    points: parseValue((t[2] as CardToken).text),
    fstart: parseValue((t[3] as CardToken).text),
    fstop: parseValue((t[4] as CardToken).text),
  };
}

/** .ic v(node)=value — node initial conditions for transient/uic. */
function parseIc(card: LexCard, acc: ParseAccumulator): void {
  const circuit = target(acc);
  const ic = circuit.ic ?? {};
  for (let i = 1; i < card.tokens.length; i++) {
    const t = card.tokens[i] as CardToken;
    const m = /^v\(([^)]+)\)\s*=\s*(.+)$/i.exec(t.text);
    if (m === null) {
      throw new FAIL(`.ic expects v(node)=value, got "${t.text}"`, t.line, t.col);
    }
    ic[m[1] as string] = parseValue((m[2] as string).trim());
  }
  circuit.ic = ic;
}

function parseProbes(card: LexCard, acc: ParseAccumulator): void {
  const probes = target(acc).probes;
  for (let i = 1; i < card.tokens.length; i++) {
    const t = card.tokens[i] as CardToken;
    probes.push({ signal: t.text.toLowerCase() });
  }
}
