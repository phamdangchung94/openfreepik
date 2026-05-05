/** Custom error class for all Freepik API errors. */

export type FreepikErrorCode =
  | "AUTH"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  /**
   * Magnific/Freepik plan-level usage cap reached on the upstream
   * account. Distinct from QUOTA_EXHAUSTED (which we treat as the key
   * being permanently dead): PLAN_LIMIT means "this account is over
   * its monthly/plan ceiling, will reset on renewal". Orchestrator
   * rotates to the next key but doesn't flip is_active=false.
   */
  | "PLAN_LIMIT"
  | "SERVER"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export interface InvalidParam {
  name: string;
  reason: string;
}

export class FreepikApiError extends Error {
  public readonly code: FreepikErrorCode;
  public readonly status: number;
  public readonly invalidParams: InvalidParam[];

  /**
   * @param opts.message — human-readable error message; surfaced to the
   *   customer via the orchestrator's `fail()` helper. Avoid stack-leaking
   *   wording (Drizzle SQL, Neon hostnames). Default messages in
   *   `mapHttpError` are already safe.
   * @param opts.code — domain code consumed by `isKeyExhaustedError`,
   *   the rate-limit gate, and `friendlyError()` for Vietnamese display.
   * @param opts.status — original Freepik HTTP status. Bubbled to the
   *   route handler; `mapHttpError` clamps non-standard codes via
   *   `safeStatus` before reuse.
   * @param opts.invalidParams — when Freepik returns 400/403 with
   *   `problem.invalid_params`, these get surfaced to the customer so
   *   they know which form field to fix. Empty array when not present.
   */
  constructor(opts: {
    message: string;
    code: FreepikErrorCode;
    status: number;
    invalidParams?: InvalidParam[];
  }) {
    super(opts.message);
    this.name = "FreepikApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.invalidParams = opts.invalidParams ?? [];
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      status: this.status,
      invalidParams:
        this.invalidParams.length > 0 ? this.invalidParams : undefined,
    };
  }
}
