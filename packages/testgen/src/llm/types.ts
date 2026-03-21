/**
 * LLM provider abstraction for test enhancement.
 * Currently supports: ollama (local), template-only (no LLM).
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  /** Time taken in milliseconds */
  durationMs: number;
}

export interface LlmProvider {
  readonly name: string;
  /**
   * Send a chat completion request to the LLM.
   * Throws on network/parse errors.
   */
  chat(messages: LlmMessage[]): Promise<LlmResponse>;
  /** Check if the provider is reachable (e.g. Ollama server running). */
  healthCheck(): Promise<boolean>;
}

export interface LlmConfig {
  provider: 'ollama' | 'none';
  /** Ollama model name (e.g. "deepseek-coder:6.7b", "qwen2.5-coder:7b") */
  model: string;
  /** Ollama server URL (default: http://localhost:11434) */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 120000) */
  timeoutMs: number;
  /** Temperature for generation (default: 0.2 — low for deterministic code output) */
  temperature: number;
}
