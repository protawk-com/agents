import type { LanguageModel } from "ai";
import type { CompressionStrategy } from "../compression/strategy.js";
import type { AgentHooks } from "./hooks.js";
import type { Message } from "./memory.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface AgentContext {
  userId: string;
  organizationId: string;
  permissions: string[];
  role: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: ToolExecuteArgs): Promise<unknown>;
}

export interface ToolExecuteArgs {
  args: Record<string, unknown>;
  ctx: AgentContext;
  signal?: AbortSignal;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolErrorRecord extends ToolCallRecord {
  error: string;
}

export interface AgentRunResult {
  content: string;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  toolErrors: ToolErrorRecord[];
}

export interface StreamAgentResult {
  textStream: AsyncIterable<string>;
  fullStream: AsyncIterable<unknown>;
  result: Promise<AgentRunResult>;
}

export interface RunAgentOptions {
  maxSteps?: number;
  systemPrompt?: string;
  model?: LanguageModel;
  modelId?: string;
  apiKey?: string;
  registry?: ToolRegistry;
  abortSignal?: AbortSignal;
  toolTimeout?: number;
  messages?: Message[];
  hooks?: AgentHooks;
  compression?: CompressionStrategy;
}
