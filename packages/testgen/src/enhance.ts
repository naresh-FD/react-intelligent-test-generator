import fs from 'fs';
import path from 'path';
import { scanSourceFiles, getTestFilePath } from './utils/path';
import { writeFile } from './fs';

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'testgen-coder-finetuned';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2, num_predict: 2048 } }),
  });
  if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
  const data = await res.json() as { response: string };
  const raw = data.response.trim();
  const m = raw.match(/^```(?:tsx?|javascript|typescript)?\n([\s\S]*?)```\s*$/);
  return m ? m[1] : raw;
}

async function checkOllama(): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const { models } = await res.json() as { models: Array<{ name: string }> };
    const found = models.some(m => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}:`));
    if (!found) {
      console.error(`\n❌  Model "${OLLAMA_MODEL}" not found. Run: ollama list`);
      process.exit(1);
    }
    console.log(`✅  Model "${OLLAMA_MODEL}" ready`);
  } catch {
    console.error(`\n❌  Cannot reach Ollama at ${OLLAMA_BASE_URL} — run: ollama serve`);
    process.exit(1);
  }
}

function buildPrompt(source: string, fileName: string): string {
  return `You are an expert React test engineer.\nGenerate a complete Jest + React Testing Library test file for this TypeScript/React file.\nFile: ${fileName}\n\n\`\`\`tsx\n${source}\n\`\`\`\n\nGenerate only the test file, no explanation:`;
}

async function run(): Promise<void> {
  console.log(`\n🚀  testgen:enhance  |  model: ${OLLAMA_MODEL}\n`);
  await checkOllama();
  const files = scanSourceFiles();
  console.log(`\nFound ${files.length} source file(s)\n`);
  let generated = 0, skipped = 0, failed = 0;
  for (const [i, filePath] of files.entries()) {
    const fileName = path.basename(filePath);
    process.stdout.write(`[${i + 1}/${files.length}] ${fileName} ... `);
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      if (source.trim().length < 50) { console.log('skipped (too small)'); skipped++; continue; }
      const testCode = await callOllama(buildPrompt(source, fileName));
      if (!testCode.trim()) { console.log('skipped (empty response)'); skipped++; continue; }
      writeFile(getTestFilePath(filePath), testCode);
      console.log(`✅`);
      generated++;
    } catch (e) {
      console.log(`❌  ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }
  console.log(`\n  Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}
run().catch(e => { console.error(e); process.exit(1); });