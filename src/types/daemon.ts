export interface NdjsonStart {
  type: "start";
  pid: number;
  startedAt: number;
}

export interface NdjsonProgress {
  type: "progress";
  event: Record<string, unknown>;
}

export interface NdjsonResult {
  type: "result";
  result: Record<string, unknown>;
}

export interface NdjsonError {
  type: "error";
  error: string;
}

export type NdjsonEvent = NdjsonStart | NdjsonProgress | NdjsonResult | NdjsonError;
