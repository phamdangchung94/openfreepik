/** Custom error class for all Freepik API errors. */

export type FreepikErrorCode =
  | "AUTH"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
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
