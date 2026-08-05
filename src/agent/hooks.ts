import type { ToolCallRecord } from "./types.js";

export interface AgentHooks {
  onStepStart?(step: number): void;
  onStepFinish?(step: number, text: string, toolCalls: ToolCallRecord[]): void;
  onToolCall?(tool: { name: string; args: Record<string, unknown> }): Promise<void> | void;
  onToolResult?(result: {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    error?: string;
  }): void;
}
