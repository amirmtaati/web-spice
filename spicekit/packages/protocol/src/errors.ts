/**
 * Stable error codes + typed error hierarchy (SPEC §4.3, §12.4).
 * Every error carries a stable `code`, a human `message`, and a `location`
 * (element name, node, netlist line, or UI component id) so the UI can
 * highlight the culprit (SPEC §9.9).
 */

export const ERROR_CODES = [
  "E_PARSE",
  "E_SINGULAR_MATRIX",
  "E_NO_CONVERGENCE",
  "E_FLOATING_NODE",
  "E_VSOURCE_LOOP",
  "E_UNKNOWN_MODEL",
  "E_TIMESTEP_TOO_SMALL",
  "E_LIMIT_EXCEEDED",
  "E_PROTOCOL_VERSION",
  "E_NOT_IMPLEMENTED", // scaffold stubs; removed once features land
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Where an error happened, for UI pinning (SPEC §4.3). */
export interface ErrorLocation {
  elementName?: string;
  node?: string;
  line?: number;
  componentId?: string;
}

export interface EngineErrorPayload {
  code: ErrorCode;
  message: string;
  location?: ErrorLocation;
}

/** Root of the engine error hierarchy (SPEC §12.4). */
export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly location?: ErrorLocation;

  constructor(payload: EngineErrorPayload, options?: { cause?: unknown }) {
    super(payload.message, options);
    this.name = "EngineError";
    this.code = payload.code;
    if (payload.location !== undefined) {
      this.location = payload.location;
    }
  }

  toJSON(): EngineErrorPayload {
    const payload: EngineErrorPayload = { code: this.code, message: this.message };
    if (this.location !== undefined) {
      payload.location = this.location;
    }
    return payload;
  }
}
