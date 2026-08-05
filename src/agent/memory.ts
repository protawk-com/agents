import type { ToolCallRecord } from "./types.js";

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRecord[] }
  | { role: "system"; content: string };

export interface MemoryProvider {
  add(message: Message): void;
  getAll(): Message[];
  clear(): void;
}

export class InMemoryProvider implements MemoryProvider {
  private messages: Message[] = [];

  add(message: Message): void {
    this.messages.push(message);
  }

  getAll(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}
