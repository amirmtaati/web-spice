/**
 * zod schemas for protocol messages (SPEC §2.1: "Control messages are JSON
 * validated with zod"). Bulk data (`data` chunks) is validated structurally
 * only — typed arrays never survive JSON.
 */
import { z } from "zod";
import { ERROR_CODES } from "./errors.ts";

const nodeId = z.string().min(1);
const expr = z.union([z.number(), z.string()]);

const simOptions = z.object({
  reltol: z.number().positive(),
  abstol: z.number().positive(),
  vntol: z.number().positive(),
  gmin: z.number().nonnegative(),
  itl1: z.number().int().positive(),
  itl4: z.number().int().positive(),
  trtol: z.number().positive(),
  method: z.enum(["trap", "be", "gear2"]),
  temp: z.number(),
  tnom: z.number(),
  maxStepRatio: z.number().positive().optional(),
  seed: z.number().int().optional(),
  noopiter: z.number().int().nonnegative().optional(),
  gminsteps: z.number().int().nonnegative().optional(),
  srcsteps: z.number().int().nonnegative().optional(),
});

const waveform = z.object({ kind: z.string() }).loose();

const elementBase = z.object({ name: z.string().min(1) }).loose();

/** Element schemas are kept permissive at scaffold time; strict per-type
 * schemas land with the parser (E1) and are property-tested (SPEC §13.3). */
const element = z.union([
  elementBase.extend({ type: z.literal("R"), n: z.tuple([nodeId, nodeId]), value: expr }),
  elementBase.extend({ type: z.literal("C"), n: z.tuple([nodeId, nodeId]), value: expr }),
  elementBase.extend({ type: z.literal("L"), n: z.tuple([nodeId, nodeId]), value: expr }),
  elementBase.extend({
    type: z.literal("K"),
    inductors: z.tuple([z.string(), z.string()]),
    coupling: expr,
  }),
  elementBase.extend({
    type: z.enum(["V", "I"]),
    n: z.tuple([nodeId, nodeId]),
    dc: expr.optional(),
    ac: z.object({ mag: z.number(), phase: z.number().optional() }).optional(),
    wave: waveform.optional(),
  }),
  elementBase.extend({ type: z.enum(["E", "G", "F", "H"]), n: z.array(nodeId) }),
  elementBase.extend({
    type: z.literal("B"),
    n: z.tuple([nodeId, nodeId]),
    kind: z.enum(["V", "I"]),
    expr: z.string(),
  }),
  elementBase.extend({
    type: z.literal("D"),
    n: z.tuple([nodeId, nodeId]),
    model: z.string(),
    area: z.number().positive().optional(),
  }),
  elementBase.extend({
    type: z.literal("Q"),
    n: z.tuple([nodeId, nodeId, nodeId]),
    model: z.string(),
    area: z.number().positive().optional(),
  }),
  elementBase.extend({
    type: z.literal("M"),
    n: z.tuple([nodeId, nodeId, nodeId, nodeId]),
    model: z.string(),
    w: expr.optional(),
    l: expr.optional(),
  }),
  elementBase.extend({
    type: z.literal("J"),
    n: z.tuple([nodeId, nodeId, nodeId]),
    model: z.string(),
    area: z.number().positive().optional(),
  }),
  elementBase.extend({
    type: z.literal("S"),
    n: z.tuple([nodeId, nodeId]),
    ctrl: z.union([z.tuple([nodeId, nodeId]), z.object({ element: z.string() })]),
    model: z.string(),
  }),
  elementBase.extend({ type: z.literal("X"), n: z.array(nodeId), subckt: z.string() }),
]);

const analysisRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("op") }),
  z.object({
    kind: z.literal("dc"),
    source: z.string(),
    start: z.number(),
    stop: z.number(),
    step: z.number(),
  }),
  z.object({
    kind: z.literal("ac"),
    sweep: z.enum(["dec", "oct", "lin"]),
    points: z.number().int().positive(),
    fstart: z.number().nonnegative(),
    fstop: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("tran"),
    tstep: z.number().positive(),
    tstop: z.number().positive(),
    tstart: z.number().nonnegative().optional(),
    tmax: z.number().positive().optional(),
    uic: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("noise"),
    output: z.string(),
    source: z.string(),
    sweep: z.enum(["dec", "oct", "lin"]),
    points: z.number().int().positive(),
    fstart: z.number().nonnegative(),
    fstop: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal("tf"), output: z.string(), source: z.string() }),
]);

export const circuitSchema = z.object({
  title: z.string(),
  elements: z.array(element),
  models: z.record(
    z.string(),
    z.object({ name: z.string(), type: z.string(), parameters: z.record(z.string(), expr) }),
  ),
  subcircuits: z.record(z.string(), z.unknown()),
  params: z.record(z.string(), expr),
  options: simOptions,
  analyses: z.array(analysisRequest),
  probes: z.array(z.object({ signal: z.string() })),
  measures: z
    .object({
      analysis: z.enum(["tran", "ac", "dc", "op"]),
      name: z.string().min(1),
      mode: z.enum(["find", "max", "min", "avg", "rms", "pp", "integ"]),
      expr: z.string().min(1),
      at: z.number().optional(),
      when: z
        .object({
          expr: z.string().min(1),
          value: z.number(),
          edge: z.enum(["rise", "fall", "cross"]),
          count: z.number().int().positive(),
        })
        .optional(),
      from: z.number().optional(),
      to: z.number().optional(),
    })
    .loose()
    .array()
    .optional(),
  sourceMap: z.record(z.string(), z.string()).optional(),
});

export const loadSpicePayload = z.object({ text: z.string().max(10 * 1024 * 1024) });

export const runPayload = z.object({
  analysis: analysisRequest,
  stream: z
    .object({
      mode: z.enum(["buffered", "live"]),
      realtimeFactor: z.number().positive().optional(),
    })
    .optional(),
  probes: z.array(z.object({ signal: z.string() })).optional(),
});

export const controlPayload = z.object({
  runId: z.string(),
  op: z.enum(["pause", "resume", "stop", "step"]),
});

export const setParamPayload = z.object({
  runId: z.string(),
  target: z.object({
    elementName: z.string(),
    property: z.enum([
      "value",
      "amplitude",
      "frequency",
      "offset",
      "dutyCycle",
      "wiper",
      "switchState",
    ]),
  }),
  value: z.number(),
});

export const setExternalPayload = z.object({
  runId: z.string(),
  channel: z.string(),
  value: z.union([z.number(), z.array(z.number())]),
});

export const evaluatePayload = z.object({
  expr: z.string().max(4096),
  context: z.record(z.string(), z.number()).optional(),
});

export const helloPayload = z.object({ protocol: z.string() });

/** Discriminated validation of every JSON request by message type. */
export const requestSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("hello"), payload: helloPayload }),
  z.object({
    id: z.string(),
    type: z.literal("loadCircuit"),
    payload: z.object({ circuit: circuitSchema }),
  }),
  z.object({ id: z.string(), type: z.literal("loadSpice"), payload: loadSpicePayload }),
  z.object({ id: z.string(), type: z.literal("run"), payload: runPayload }),
  z.object({ id: z.string(), type: z.literal("control"), payload: controlPayload }),
  z.object({ id: z.string(), type: z.literal("setParam"), payload: setParamPayload }),
  z.object({ id: z.string(), type: z.literal("setExternal"), payload: setExternalPayload }),
  z.object({ id: z.string(), type: z.literal("evaluate"), payload: evaluatePayload }),
  z.object({ id: z.string(), type: z.literal("exportSpice") }),
]);

export const errorPayloadSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  location: z
    .object({
      elementName: z.string().optional(),
      node: z.string().optional(),
      line: z.number().int().nonnegative().optional(),
      componentId: z.string().optional(),
    })
    .optional(),
});
