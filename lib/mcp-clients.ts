import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, ServerConfig>;
}

let configCache: McpConfig | null | undefined;
const clientCache = new Map<string, Client>();

async function loadConfig(): Promise<McpConfig | null> {
  if (configCache !== undefined) return configCache;
  const path = resolve(process.cwd(), "mcp.config.json");
  if (!existsSync(path)) {
    configCache = null;
    return null;
  }
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as McpConfig;
    configCache = parsed;
    return parsed;
  } catch (err) {
    console.error("Failed to load mcp.config.json:", err);
    configCache = null;
    return null;
  }
}

function resolveEnvInterpolation(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => process.env[name] ?? "");
  }
  return out;
}

async function spawn(name: string, config: ServerConfig): Promise<Client> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: { ...process.env, ...resolveEnvInterpolation(config.env ?? {}) } as Record<string, string>,
  });
  const client = new Client({ name: `prism-client-${name}`, version: "0.1.0" });
  await client.connect(transport);
  return client;
}

export async function listConfiguredServers(): Promise<string[]> {
  const cfg = await loadConfig();
  if (!cfg) return [];
  return Object.keys(cfg.servers);
}

export async function getAllClients(): Promise<Record<string, Client>> {
  const cfg = await loadConfig();
  if (!cfg) return {};
  const out: Record<string, Client> = {};
  for (const [name, config] of Object.entries(cfg.servers)) {
    try {
      let c = clientCache.get(name);
      if (!c) {
        c = await spawn(name, config);
        clientCache.set(name, c);
      }
      out[name] = c;
    } catch (err) {
      console.error(`Failed to spawn MCP server '${name}':`, err);
    }
  }
  return out;
}

export function clearConfigCache(): void {
  configCache = undefined;
}
