/**
 * Stub engine (SPEC §2.1: "an EngineAdapter seam … exercised in v1 by a stub
 * adapter"). Implements the protocol handshake and happy-path acks so the UI
 * shell, conformance suite, and CI pipeline are real end-to-end from P0.
 * Responses are marked STUB; milestone E1 replaces this with the core engine.
 */
import {
  type Circuit,
  type ClientToEngine,
  DEFAULT_ENGINE_LIMITS,
  DEFAULT_SIM_OPTIONS,
  type EngineCapabilities,
  EngineError,
  type EngineLimits,
  type EngineToClient,
  PROTOCOL_VERSION,
  type RunStats,
} from "@spicekit/protocol";

export type EngineReply = (message: EngineToClient) => void;

const STUB_CAPABILITIES: EngineCapabilities = {
  analyses: ["op"],
  devices: [],
  waveforms: [],
  liveParamMode: false,
  streaming: ["buffered"],
};

const STUB_STATS: RunStats = {
  timesteps: 0,
  rejectedSteps: 0,
  newtonIterations: 0,
  method: "stub",
  fallbackUsed: false,
};

let runCounter = 0;

export class StubEngine {
  readonly engineVersion = `${PROTOCOL_VERSION}+stub`;
  readonly limits: EngineLimits = DEFAULT_ENGINE_LIMITS;

  handle(message: ClientToEngine, reply: EngineReply): void {
    switch (message.type) {
      case "hello": {
        reply({
          id: message.id,
          type: "ready",
          payload: {
            engineVersion: this.engineVersion,
            capabilities: STUB_CAPABILITIES,
            limits: this.limits,
          },
        });
        return;
      }
      case "loadCircuit": {
        const { circuit } = message.payload;
        const nodeNames = [
          ...new Set(circuit.elements.flatMap((e) => ("n" in e ? e.n : []))),
        ].filter((n) => n !== "0");
        reply({
          id: message.id,
          type: "loadResult",
          payload: {
            ok: true,
            nodeTable: nodeNames.map((name, index) => ({ name, index: index + 1 })),
            branchTable: [],
            warnings: [
              { code: "STUB", message: "Stub engine: circuit not compiled or validated." },
            ],
          },
        });
        return;
      }
      case "run": {
        runCounter += 1;
        const runId = `stub-run-${runCounter}`;
        reply({ id: message.id, type: "runAccepted", payload: { ok: true, runId } });
        // A stub "run" completes immediately with zero timesteps.
        reply({
          id: message.id,
          type: "data",
          payload: { runId, signals: [], tStart: 0, chunk: [] },
        });
        reply({ id: message.id, type: "done", payload: { runId, stats: STUB_STATS } });
        return;
      }
      case "loadSpice": {
        reply({
          id: message.id,
          type: "error",
          payload: new EngineError({
            code: "E_NOT_IMPLEMENTED",
            message:
              "The SPICE parser lands with milestone E1 (SPEC §22); the stub accepts Circuit IR only.",
          }).toJSON(),
        });
        return;
      }
      case "control":
      case "setParam":
      case "setExternal":
      case "evaluate":
      case "exportSpice": {
        reply({
          id: message.id,
          type: "error",
          payload: new EngineError({
            code: "E_NOT_IMPLEMENTED",
            message: `"${message.type}" is not implemented by the stub engine.`,
          }).toJSON(),
        });
        return;
      }
    }
  }
}

/** Convenience for examples/tests: a minimal valid IR the stub accepts. */
export function stubCircuit(): Circuit {
  return {
    title: "Stub",
    elements: [
      { type: "V", name: "V1", n: ["in", "0"], dc: 5 },
      { type: "R", name: "R1", n: ["in", "out"], value: "1k" },
    ],
    models: {},
    subcircuits: {},
    params: {},
    options: { ...DEFAULT_SIM_OPTIONS },
    analyses: [{ kind: "op" }],
    probes: [],
  };
}
