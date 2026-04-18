import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface GatherOptions {
  client: Anthropic;
  model: string;
  userPrompt: string;
  mcpClients: Record<string, Client>;
  maxToolCalls?: number;
  timeoutMs?: number;
}

export interface GatherResult {
  summary: string;
  toolCallCount: number;
  timedOut: boolean;
}

interface McpToolDef {
  serverName: string;
  toolName: string;
  combinedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const GATHER_SYSTEM_PROMPT = `You are a context-gathering assistant. The user is about to ask another tool to build them a webpage.

Use your available tools to gather any context, data, assets, or design references the user's request implies. Be efficient — only make tool calls that will actually help the build step.

You must NOT write code. You must NOT describe a webpage. Your ONLY job is to gather and summarize relevant context.

When you have enough, respond with a concise markdown summary of what you found (500 words maximum). Use headings to organize by source. Include key facts, URLs, data, values, and specifications the build step will need.

If you can't find anything useful, say so briefly and stop.`;

async function fetchToolDefs(
  mcpClients: Record<string, Client>,
): Promise<McpToolDef[]> {
  const out: McpToolDef[] = [];
  for (const [serverName, client] of Object.entries(mcpClients)) {
    try {
      const { tools } = await client.listTools();
      for (const t of tools) {
        out.push({
          serverName,
          toolName: t.name,
          combinedName: `${serverName}__${t.name}`,
          description: t.description ?? "",
          inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
        });
      }
    } catch (err) {
      console.error(`listTools failed for '${serverName}':`, err);
    }
  }
  return out;
}

export async function gatherContext(opts: GatherOptions): Promise<GatherResult> {
  const { client, model, userPrompt, mcpClients } = opts;
  const maxToolCalls = opts.maxToolCalls ?? 6;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const toolDefs = await fetchToolDefs(mcpClients);
  if (toolDefs.length === 0) {
    return { summary: "No MCP tools available.", toolCallCount: 0, timedOut: false };
  }

  const anthropicTools = toolDefs.map((t) => ({
    name: t.combinedName,
    description: `[from ${t.serverName}] ${t.description}`,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));
  const byCombinedName = new Map(toolDefs.map((t) => [t.combinedName, t]));

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `User's upcoming request: "${userPrompt}"\n\nGather relevant context using your tools.`,
    },
  ];

  let toolCallCount = 0;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (Date.now() > deadline) {
      return {
        summary: "Context gathering timed out. Proceeding without context.",
        toolCallCount,
        timedOut: true,
      };
    }

    const resp = await client.messages.create({
      model,
      max_tokens: 2000,
      tools: anthropicTools,
      system: GATHER_SYSTEM_PROMPT,
      messages,
    });

    const toolUses = resp.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n\n");
      return {
        summary: text || "No context gathered.",
        toolCallCount,
        timedOut: false,
      };
    }

    if (toolCallCount + toolUses.length > maxToolCalls) {
      return {
        summary: `Tool-call budget exceeded (>${maxToolCalls}). Proceeding with partial context.`,
        toolCallCount,
        timedOut: false,
      };
    }

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCallCount++;
      const def = byCombinedName.get(tu.name);
      if (!def) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: unknown tool '${tu.name}'`,
          is_error: true,
        });
        continue;
      }
      try {
        const mcpClient = mcpClients[def.serverName];
        const result = await mcpClient.callTool({
          name: def.toolName,
          arguments: tu.input as Record<string, unknown>,
        });
        const textContent = Array.isArray(result.content)
          ? result.content
              .filter(
                (c: unknown): c is { type: "text"; text: string } =>
                  typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
              )
              .map((c) => c.text)
              .join("\n")
          : "(no content)";
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: textContent,
          is_error: result.isError === true,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error calling ${def.serverName}.${def.toolName}: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }
}
