import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool as defineAiTool,
  type ToolSet,
} from "ai";
import { createOpenRouterModel } from "../providers/openrouter.js";
import { defaultToolRegistry } from "../tools/registry.js";
import type {
  AgentContext,
  AgentRunResult,
  RunAgentOptions,
  ToolCallRecord,
  ToolErrorRecord,
} from "./types.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Tool execution failed";
}

export async function runAgent(
  userPrompt: string,
  ctx: AgentContext,
  options: RunAgentOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 10;
  const registry = options.registry ?? defaultToolRegistry;
  const toolCalls: ToolCallRecord[] = [];
  const toolErrors: ToolErrorRecord[] = [];

  const tools = Object.fromEntries(
    registry.list().map((registeredTool) => [
      registeredTool.name,
      defineAiTool({
        description: registeredTool.description,
        inputSchema: jsonSchema(registeredTool.parameters),
        execute: async (args: unknown) => {
          const normalizedArgs = args as Record<string, unknown>;

          try {
            const result = await registeredTool.execute(normalizedArgs, ctx);
            toolCalls.push({
              name: registeredTool.name,
              args: normalizedArgs,
            });
            return result;
          } catch (error) {
            const message = toErrorMessage(error);
            toolErrors.push({
              name: registeredTool.name,
              args: normalizedArgs,
              error: message,
            });
            return { error: message };
          }
        },
      }),
    ])
  ) as ToolSet;

  const result = await generateText({
    model:
      options.model ??
      createOpenRouterModel({
        apiKey: options.apiKey,
        modelId: options.modelId,
      }),
    system: options.systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(maxSteps),
  });

  return {
    content: result.text,
    toolCalls,
    toolErrors,
  };
}
