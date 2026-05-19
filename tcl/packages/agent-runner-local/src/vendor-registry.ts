export interface AgentVendorDefinition {
  key: string;
  name: string;
  executionMode: 'api' | 'local_http' | 'cli' | 'sdk' | 'custom';
  keyStorageMode: 'LOCAL_COMPANION_VAULT' | 'ENV_VAR' | 'NONE';
  defaultModels: string[];
  supportedUseCases: string[];
  requiresBaseUrl?: boolean;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
}

export const VENDOR_REGISTRY: AgentVendorDefinition[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    executionMode: 'api',
    keyStorageMode: 'LOCAL_COMPANION_VAULT',
    defaultModels: ['gpt-4o', 'gpt-4o-mini'],
    supportedUseCases: ['orchestrate', 'plan', 'code', 'review', 'qa', 'summarize', 'chat'],
    supportsStreaming: true,
    supportsTools: true,
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    executionMode: 'api',
    keyStorageMode: 'LOCAL_COMPANION_VAULT',
    defaultModels: ['claude-sonnet-4-20250514'],
    supportedUseCases: ['orchestrate', 'plan', 'code', 'review', 'research', 'chat'],
    supportsStreaming: true,
    supportsTools: true,
  },
  {
    key: 'google-gemini',
    name: 'Google Gemini',
    executionMode: 'api',
    keyStorageMode: 'LOCAL_COMPANION_VAULT',
    defaultModels: ['gemini-2.0-flash'],
    supportedUseCases: ['orchestrate', 'research', 'summarize', 'chat'],
    supportsStreaming: true,
  },
  {
    key: 'ollama',
    name: 'Ollama',
    executionMode: 'local_http',
    keyStorageMode: 'NONE',
    defaultModels: ['llama3.2'],
    supportedUseCases: ['code', 'chat', 'summarize'],
    requiresBaseUrl: true,
  },
  {
    key: 'lm-studio',
    name: 'LM Studio',
    executionMode: 'local_http',
    keyStorageMode: 'NONE',
    defaultModels: ['local-model'],
    supportedUseCases: ['code', 'chat'],
    requiresBaseUrl: true,
  },
];

export function getVendor(key: string): AgentVendorDefinition | undefined {
  return VENDOR_REGISTRY.find((v) => v.key === key);
}
