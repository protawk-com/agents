import type { LanguageModel } from "ai";
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
  execute(args: Record<string, unknown>, ctx: AgentContext): Promise<unknown>;
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
  toolCalls: ToolCallRecord[];
  toolErrors: ToolErrorRecord[];
}

export interface RunAgentOptions {
  maxSteps?: number;
  systemPrompt?: string;
  model?: LanguageModel;
  modelId?: string;
  apiKey?: string;
  registry?: ToolRegistry;
}
