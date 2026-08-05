import {
  generateText,
  jsonSchema,
  stepCountIs,
  streamText,
  tool as defineAiTool,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { createOpenRouterModel } from "../providers/openrouter.js";
import { defaultToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { AgentHooks } from "./hooks.js";
import type { Message } from "./memory.js";
import type {
  AgentContext,
  AgentRunResult,
  RunAgentOptions,
  StreamAgentResult,
  ToolCallRecord,
  ToolErrorRecord,
} from "./types.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tool execution was aborted";
    if (error.name === "TimeoutError") return `Tool timed out: ${error.message}`;
    return error.message;
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "name" in error && "message" in error) {
    const e = error as { name: string; message: string };
    if (e.name === "TimeoutError") return `Tool timed out: ${e.message}`;
    if (e.name === "AbortError") return "Tool execution was aborted";
    return e.message;
  }
  return "Tool execution failed";
}

function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"));

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function deriveAbortSignal(
  abortSignal: AbortSignal | undefined,
  toolTimeout: number | undefined,
): AbortSignal | undefined {
  if (abortSignal && toolTimeout != null) {
    return AbortSignal.any([abortSignal, AbortSignal.timeout(toolTimeout)]);
  }
  if (abortSignal) return abortSignal;
  if (toolTimeout != null) return AbortSignal.timeout(toolTimeout);
  return undefined;
}

function toCoreMessages(messages: Message[]): ModelMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "user":
        return { role: "user" as const, content: msg.content };
      case "assistant":
        return { role: "assistant" as const, content: [{ type: "text" as const, text: msg.content }] };
      case "system":
        return { role: "system" as const, content: msg.content };
    }
  });
}

function buildAssistantMessage(
  content: string,
  toolCalls: ToolCallRecord[],
): Message {
  if (toolCalls.length > 0) {
    return { role: "assistant", content, toolCalls: [...toolCalls] };
  }
  return { role: "assistant", content };
}

function buildToolSet(
  registry: ToolRegistry,
  ctx: AgentContext,
  toolAbortSignal: AbortSignal | undefined,
  hooks: AgentHooks | undefined,
  toolCalls: ToolCallRecord[],
  toolErrors: ToolErrorRecord[],
): ToolSet {
  return Object.fromEntries(
    registry.list().map((registeredTool) => [
      registeredTool.name,
      defineAiTool({
        description: registeredTool.description,
        inputSchema: jsonSchema(registeredTool.parameters),
        execute: async (args: unknown) => {
          const normalizedArgs = args as Record<string, unknown>;

          if (hooks?.onToolCall) {
            await hooks.onToolCall({ name: registeredTool.name, args: normalizedArgs });
          }

          let executionPromise = registeredTool.execute({
            args: normalizedArgs,
            ctx,
            signal: toolAbortSignal,
          });

          if (toolAbortSignal) {
            executionPromise = withAbortSignal(executionPromise, toolAbortSignal);
          }

          try {
            const result = await executionPromise;
            toolCalls.push({
              name: registeredTool.name,
              args: normalizedArgs,
            });
            hooks?.onToolResult?.({ name: registeredTool.name, args: normalizedArgs, result });
            return result;
          } catch (error) {
            const message = toErrorMessage(error);
            toolErrors.push({
              name: registeredTool.name,
              args: normalizedArgs,
              error: message,
            });
            hooks?.onToolResult?.({ name: registeredTool.name, args: normalizedArgs, result: undefined, error: message });
            return { error: message };
          }
        },
      }),
    ])
  ) as ToolSet;
}

function buildHistory(userPrompt: string, options: RunAgentOptions): Message[] {
  const history: Message[] = [...(options.messages ?? [])];
  history.push({ role: "user", content: userPrompt });

  const systemPrompt = options.systemPrompt;
  if (systemPrompt && history.length === 1) {
    history.unshift({ role: "system", content: systemPrompt });
  }

  return history;
}

export async function runAgent(
  userPrompt: string,
  ctx: AgentContext,
  options: RunAgentOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 10;
  const toolTimeout = options.toolTimeout;
  const abortSignal = options.abortSignal;
  const registry = options.registry ?? defaultToolRegistry;
  const toolCalls: ToolCallRecord[] = [];
  const toolErrors: ToolErrorRecord[] = [];
  const hooks = options.hooks;
  const toolAbortSignal = deriveAbortSignal(abortSignal, toolTimeout);

  const history = buildHistory(userPrompt, options);
  const tools = buildToolSet(registry, ctx, toolAbortSignal, hooks, toolCalls, toolErrors);

  const compression = options.compression;
  if (compression && compression.shouldCompress(history)) {
    await compression.compress(history);
  }

  const activeMessages = history.filter(m => m.active !== false);

  hooks?.onStepStart?.(1);

  const result = await generateText({
    model:
      options.model ??
      createOpenRouterModel({
        apiKey: options.apiKey,
        modelId: options.modelId,
      }),
    messages: toCoreMessages(activeMessages),
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(abortSignal ? { abortSignal } : {}),
    onStepFinish: (step) => {
      hooks?.onStepFinish?.(
        step.stepNumber,
        step.text,
        step.toolCalls?.map((tc) => ({
          name: tc.toolName,
          args: tc.input as Record<string, unknown>,
        })) ?? [],
      );
    },
  });

  const assistantMessage = buildAssistantMessage(result.text, toolCalls);
  history.push(assistantMessage);

  return {
    content: result.text,
    messages: history,
    toolCalls,
    toolErrors,
  };
}

export async function streamAgent(
  userPrompt: string,
  ctx: AgentContext,
  options: RunAgentOptions = {}
): Promise<StreamAgentResult> {
  const maxSteps = options.maxSteps ?? 10;
  const toolTimeout = options.toolTimeout;
  const abortSignal = options.abortSignal;
  const registry = options.registry ?? defaultToolRegistry;
  const toolCalls: ToolCallRecord[] = [];
  const toolErrors: ToolErrorRecord[] = [];
  const hooks = options.hooks;
  const toolAbortSignal = deriveAbortSignal(abortSignal, toolTimeout);

  const history = buildHistory(userPrompt, options);
  const tools = buildToolSet(registry, ctx, toolAbortSignal, hooks, toolCalls, toolErrors);

  const compression = options.compression;
  if (compression && compression.shouldCompress(history)) {
    await compression.compress(history);
  }

  const activeMessages = history.filter(m => m.active !== false);

  hooks?.onStepStart?.(1);

  const stream = streamText({
    model:
      options.model ??
      createOpenRouterModel({
        apiKey: options.apiKey,
        modelId: options.modelId,
      }),
    messages: toCoreMessages(activeMessages),
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(abortSignal ? { abortSignal } : {}),
    onStepFinish: (step) => {
      hooks?.onStepFinish?.(
        step.stepNumber,
        step.text,
        step.toolCalls?.map((tc) => ({
          name: tc.toolName,
          args: tc.input as Record<string, unknown>,
        })) ?? [],
      );
    },
  });

  const resultPromise = (async (): Promise<AgentRunResult> => {
    const text = await stream.text;
    const assistantMessage = buildAssistantMessage(text, toolCalls);
    history.push(assistantMessage);

    return {
      content: text,
      messages: history,
      toolCalls,
      toolErrors,
    };
  })();

  return {
    textStream: stream.textStream,
    fullStream: stream.fullStream,
    result: resultPromise,
  };
}
