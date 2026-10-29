import { describe, expect, test } from "bun:test";
import {
  circuitSchema,
  DEFAULT_SIM_OPTIONS,
  EngineError,
  ERROR_CODES,
  helloPayload,
  isCompatibleProtocol,
  PROTOCOL_VERSION,
  requestSchema,
} from "../src/index.ts";

describe("PROTOCOL_VERSION", () => {
  test("is valid semver", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("same major is compatible, different major is not", () => {
    const [major] = PROTOCOL_VERSION.split(".");
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol(`${major === undefined ? "0" : Number(major) + 1}.0.0`)).toBe(
      false,
    );
  });
});

describe("circuitSchema", () => {
  test("accepts a minimal RC circuit IR", () => {
    const circuit = {
      title: "RC divider",
      elements: [
        { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
        { type: "R", name: "R1", n: ["in", "out"], value: "1k" },
        { type: "C", name: "C1", n: ["out", "0"], value: "1u" },
      ],
      models: {},
      subcircuits: {},
      params: {},
      options: DEFAULT_SIM_OPTIONS,
      analyses: [{ kind: "tran", tstep: 1e-3, tstop: 10e-3 }],
      probes: [{ signal: "v(out)" }],
    };
    const result = circuitSchema.safeParse(circuit);
    expect(result.success).toBe(true);
  });

  test("rejects an element with no name", () => {
    const result = circuitSchema.safeParse({
      title: "bad",
      elements: [{ type: "R", n: ["a", "b"], value: 1 }],
      models: {},
      subcircuits: {},
      params: {},
      options: DEFAULT_SIM_OPTIONS,
      analyses: [],
      probes: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("requestSchema", () => {
  test("validates a hello message", () => {
    const result = requestSchema.safeParse({
      id: "1",
      type: "hello",
      payload: { protocol: PROTOCOL_VERSION },
    });
    expect(result.success).toBe(true);
  });

  test("rejects hello with a missing protocol field", () => {
    expect(helloPayload.safeParse({}).success).toBe(false);
  });

  test("rejects unknown message types and malformed payloads", () => {
    expect(requestSchema.safeParse({ id: "1", type: "explode" }).success).toBe(false);
    expect(
      requestSchema.safeParse({
        id: "1",
        type: "control",
        payload: { runId: "r", op: "fast-forward" },
      }).success,
    ).toBe(false);
  });
});

describe("EngineError", () => {
  test("carries a stable code and location, and serializes losslessly", () => {
    const err = new EngineError({
      code: "E_FLOATING_NODE",
      message: "Node out has no DC path to ground",
      location: { node: "out", elementName: "C1", line: 4 },
    });
    expect(err.code).toBe("E_FLOATING_NODE");
    expect(err.location?.elementName).toBe("C1");
    const parsed = JSON.parse(JSON.stringify(err.toJSON())) as unknown;
    expect(parsed).toEqual(err.toJSON());
  });

  test("all error codes are E_-prefixed and unique", () => {
    const set = new Set(ERROR_CODES);
    expect(set.size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) {
      expect(code.startsWith("E_")).toBe(true);
    }
  });
});
