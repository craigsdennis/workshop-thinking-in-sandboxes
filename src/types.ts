import type { ExampleId, SessionId } from './workshop';

export type ExampleRunResult = {
  ok: boolean;
  exampleId: ExampleId;
  sandboxId: string;
  summary: string;
  previewUrl?: string;
  output?: string;
  stderr?: string;
  exitCode?: number;
  details?: unknown;
};

export type SessionRunResult = {
  ok: boolean;
  sessionId: SessionId;
  sandboxId: string;
  summary: string;
  output?: string;
  stderr?: string;
  exitCode?: number;
  previewUrl?: string;
  details?: unknown;
};

export type TerminalBootstrapResult = {
  ok: boolean;
  sandboxId: string;
  sessionId: string;
  summary: string;
};
