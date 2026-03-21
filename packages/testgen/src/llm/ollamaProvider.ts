import http from 'node:http';
import type { LlmConfig, LlmMessage, LlmProvider, LlmResponse } from './types';

/**
 * Ollama LLM provider — calls the local Ollama server on localhost.
 * Zero external dependencies: uses Node's built-in `http` module.
 *
 * Setup:
 *   1. Install Ollama: https://ollama.com
 *   2. Pull a model: `ollama pull deepseek-coder:6.7b`
 *   3. Ollama runs automatically on http://localhost:11434
 */
export function createOllamaProvider(config: LlmConfig): LlmProvider {
  const { model, baseUrl, timeoutMs, temperature } = config;

  return {
    name: 'ollama',

    async chat(messages: LlmMessage[]): Promise<LlmResponse> {
      const start = Date.now();

      const body = JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature,
        },
      });

      const raw = await httpPost(`${baseUrl}/api/chat`, body, timeoutMs);

      const parsed = JSON.parse(raw) as {
        message?: { content?: string };
        model?: string;
        error?: string;
      };

      if (parsed.error) {
        throw new Error(`Ollama error: ${parsed.error}`);
      }

      const content = parsed.message?.content ?? '';

      return {
        content,
        model: parsed.model ?? model,
        durationMs: Date.now() - start,
      };
    },

    async healthCheck(): Promise<boolean> {
      try {
        const raw = await httpGet(`${baseUrl}/api/tags`, 5_000);
        const parsed = JSON.parse(raw) as { models?: Array<{ name: string }> };
        const models = parsed.models ?? [];

        // Check if the configured model is available
        const modelBase = model.split(':')[0];
        const available = models.some(
          (m) => m.name === model || m.name.startsWith(`${modelBase}:`)
        );

        if (!available) {
          const names = models.map((m) => m.name).join(', ');
          console.warn(
            `⚠️  Ollama is running but model "${model}" not found. Available: ${names || '(none)'}`
          );
          console.warn(`   Run: ollama pull ${model}`);
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal HTTP helpers (no external deps — Node built-in only)
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 11434,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Ollama connection failed (${parsed.hostname}:${parsed.port}): ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Ollama request timed out after ${timeoutMs}ms`));
    });

    req.write(body);
    req.end();
  });
}

function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = http.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || 11434,
        path: parsed.pathname,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Ollama connection failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Ollama health check timed out after ${timeoutMs}ms`));
    });
  });
}
