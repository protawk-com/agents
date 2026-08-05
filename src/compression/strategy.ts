import { generateText, type LanguageModel } from "ai";
import type { Message } from "../agent/memory.js";

const CJK_PATTERN = new RegExp(
  "[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF\\u3400-\\u4DBF\\uAC00-\\uD7AF\\uFF00-\\uFFEF]",
  "g",
);

function estimateTokens(text: string): number {
  const cjkCount = (text.match(CJK_PATTERN)?.length ?? 0);
  const asciiLength = text.length - cjkCount;
  return cjkCount + Math.floor((asciiLength + 3) / 4);
}

function estimateTokensForMessages(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

function serializeForCompression(messages: Message[]): string {
  return messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
}

export interface CompressionStrategy {
  shouldCompress(messages: Message[]): boolean;
  compress(messages: Message[]): Promise<Message[]>;
}

export class SummarizeCompression implements CompressionStrategy {
  private options: {
    model: LanguageModel;
    maxTokens: number;
    keepLastN: number;
    headCount: number;
  };

  constructor(options: {
    model: LanguageModel;
    maxTokens: number;
    keepLastN: number;
    headCount: number;
  }) {
    this.options = options;
  }

  shouldCompress(messages: Message[]): boolean {
    const active = messages.filter(m => m.active !== false);
    return estimateTokensForMessages(active) > this.options.maxTokens;
  }

  async compress(messages: Message[]): Promise<Message[]> {
    const summaryIndex = messages.findIndex(
      m => m.role === "system" && m.compacted === true,
    );

    const headEnd = summaryIndex >= 0 ? summaryIndex + 1 : this.options.headCount;
    const tailStart = messages.length - this.options.keepLastN;
    const middleStart = headEnd;
    const middleEnd = tailStart;

    if (middleEnd <= middleStart) return messages;

    const toCompress: Message[] = [
      ...messages.slice(middleStart, middleEnd).filter(m => m.active !== false),
      ...messages.filter(m => m.active === false && m.compacted === true),
    ];

    if (toCompress.length === 0) return messages;

    const result = await generateText({
      model: this.options.model,
      messages: [
        {
          role: "user" as const,
          content: serializeForCompression(toCompress),
        },
      ],
    });

    for (let i = middleStart; i < middleEnd; i++) {
      messages[i] = { ...messages[i], active: false, compacted: true };
    }

    if (summaryIndex >= 0) messages.splice(summaryIndex, 1);

    messages.splice(headEnd, 0, {
      role: "system",
      content: `[Conversation summary]: ${result.text}`,
      compacted: true,
    });

    return messages;
  }
}
