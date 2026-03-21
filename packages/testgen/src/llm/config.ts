import type { LlmConfig } from './types';

const DEFAULTS: LlmConfig = {
  provider: 'none',
  model: 'testgen-coder',
  baseUrl: 'http://localhost:11434',
  timeoutMs: 300_000,
  temperature: 0.2,
};

/**
 * Resolve LLM config from environment variables.
 *
 * Env vars:
 *   TESTGEN_LLM_PROVIDER  — "ollama" | "none" (default: "none")
 *   OLLAMA_MODEL           — model tag (default: "deepseek-coder:6.7b")
 *   OLLAMA_BASE_URL        — server URL (default: "http://localhost:11434")
 *   OLLAMA_TIMEOUT_MS      — request timeout (default: 120000)
 *   OLLAMA_TEMPERATURE     — generation temperature (default: 0.2)
 */
export function resolveConfig(): LlmConfig {
  const provider = parseProvider(process.env.TESTGEN_LLM_PROVIDER);

  return {
    provider,
    model: process.env.OLLAMA_MODEL || DEFAULTS.model,
    baseUrl: (process.env.OLLAMA_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    timeoutMs: parsePositiveInt(process.env.OLLAMA_TIMEOUT_MS, DEFAULTS.timeoutMs),
    temperature: parseFloat01(process.env.OLLAMA_TEMPERATURE, DEFAULTS.temperature),
  };
}

function parseProvider(value: string | undefined): LlmConfig['provider'] {
  if (value === 'ollama') return 'ollama';
  return 'none';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFloat01(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : fallback;
}
