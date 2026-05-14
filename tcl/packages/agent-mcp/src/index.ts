/**
 * agent-mcp — descriptor + client contract for MCP servers.
 *
 * MCP is the standard way agents discover external tools. Storage shape +
 * client interface are defined here; client implementations live downstream.
 */

export type McpTransport = 'stdio' | 'sse' | 'websocket' | 'http';

export interface McpServerDescriptor {
  id: string;
  orgId: string;
  teamId: string | null;
  name: string;
  transport: McpTransport;
  /** Required for `stdio` transport. */
  command?: string;
  /** Required for `sse` / `websocket` / `http` transports. */
  url?: string;
  args: string[];
  /** Non-secret env vars; secrets must come from `provider-keys`. */
  env: Record<string, string>;
  enabledTools: string[];
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface McpToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  content?: unknown;
  error?: string;
}

/**
 * Client contract — the orchestrator gateway will call into this. The MVP
 * ships a no-op client that records calls in memory.
 */
export interface McpClient {
  listTools(server: McpServerDescriptor): Promise<string[]>;
  callTool(server: McpServerDescriptor, call: McpToolCall): Promise<McpToolResult>;
}

export class NoopMcpClient implements McpClient {
  readonly calls: McpToolCall[] = [];

  async listTools(server: McpServerDescriptor): Promise<string[]> {
    return server.enabledTools;
  }

  async callTool(_server: McpServerDescriptor, call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(call);
    return { ok: true, content: { echoed: call } };
  }
}
