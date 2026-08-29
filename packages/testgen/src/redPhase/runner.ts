import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { rtcContentHash } from '../requirements/hash';
import { verifyRtcIntegrity } from '../requirements/approval';
import type { MappingResult } from '../mapping/types';
import type { RequirementTestContract } from '../requirements/types';
import type {
  RedPhaseInput,
  RedPhaseResult,
  RedVerification,
  TestFramework,
} from './types';
import { generateTestSuite } from './templateEngine';
import { classifyRedTaxonomy } from '../greenPhase/runner';
import type { FrozenTestRecord } from '../greenPhase/types';

export function runRedPhase(input: RedPhaseInput): RedPhaseResult {
  validateInputs(input);

  const { rtc, mapping, config, repoRoot } = input;
  const outputDir = path.resolve(repoRoot, config.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const suite = generateTestSuite(
    rtc.source.ticketId,
    rtc.ticket.title,
    rtc.requirements,
    mapping.decisions,
    config.framework,
    repoRoot,
    outputDir,
  );

  const suites = [suite];
  const testsGenerated = suite.testCases.filter(tc => !tc.skipped).length;
  const testsSkipped = suite.testCases.filter(tc => tc.skipped).length;

  if (!config.dryRun) {
    const filePath = path.join(outputDir, suite.fileName);
    fs.writeFileSync(filePath, suite.source, 'utf8');
    console.log(`Wrote ${filePath}`);
  }

  const verifications: RedVerification[] = [];
  if (!config.dryRun) {
    const v = verifyRed(path.join(outputDir, suite.fileName), config.framework);
    verifications.push(v);
  }

  const PROVEN_RED = new Set(['EXPECTED_RED_ASSERTION', 'EXPECTED_RED_MISSING_REQUIRED_API']);

  if (!config.dryRun) {
    const rawOutput = verifications[0]?.errorOutput ?? '';
    const failCount = verifications[0]?.failCount ?? 0;
    const passCount = verifications[0]?.passCount ?? 0;
    const taxonomy = classifyRedTaxonomy(rawOutput, failCount, passCount);

    if (!PROVEN_RED.has(taxonomy)) {
      console.error(
        `\nRED phase REFUSED to freeze: taxonomy is "${taxonomy}".\n` +
        `A frozen record is only written when the generated test proves RED behavior\n` +
        `(EXPECTED_RED_ASSERTION or EXPECTED_RED_MISSING_REQUIRED_API).\n` +
        `Fix the template or mapping and re-run.`,
      );
      return {
        ticketId: rtc.source.ticketId,
        rtcHash: rtcContentHash(rtc),
        suites,
        verifications,
        generatedAt: new Date().toISOString(),
        summary: {
          totalRequirements: rtc.requirements.length,
          testsGenerated,
          testsSkipped,
          redConfirmed: 0,
          errors: 1,
        },
      };
    }

    writeFrozenRecord(rtc, suite.source, suite.fileName, outputDir, verifications);
  }

  return {
    ticketId: rtc.source.ticketId,
    rtcHash: rtcContentHash(rtc),
    suites,
    verifications,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRequirements: rtc.requirements.length,
      testsGenerated,
      testsSkipped,
      redConfirmed: verifications.filter(v => v.verdict === 'red').length,
      errors: verifications.filter(v => v.verdict === 'error').length,
    },
  };
}

function writeFrozenRecord(
  rtc: RequirementTestContract,
  testSource: string,
  fileName: string,
  outputDir: string,
  verifications: RedVerification[],
): void {
  const testFileHash = createHash('sha256').update(testSource, 'utf8').digest('hex');
  const v = verifications[0];
  const failCount = v?.failCount ?? 0;
  const passCount = v?.passCount ?? 0;
  const rawOutput = v?.errorOutput ?? '';
  const redTaxonomy = classifyRedTaxonomy(rawOutput, failCount, passCount);
  const frozenRecord: FrozenTestRecord = {
    schemaVersion: 1,
    ticketId: rtc.source.ticketId,
    rtcHash: rtcContentHash(rtc),
    testFile: path.join(outputDir, fileName),
    testFileHash,
    redTaxonomy,
    failCount,
    passCount,
    generatedAt: new Date().toISOString(),
  };
  const frozenPath = path.join(outputDir, `${rtc.source.ticketId}.frozen.json`);
  fs.writeFileSync(frozenPath, JSON.stringify(frozenRecord, null, 2), 'utf8');
  console.log(`Froze test artifact at ${frozenPath} (hash: ${testFileHash.slice(0, 12)}…)`);
}

function validateInputs(input: RedPhaseInput): void {
  const { rtc, mapping } = input;

  if (rtc.status !== 'approved' && rtc.status !== 'review-required') {
    throw new Error(
      `RTC status is "${rtc.status}" — RED phase requires an approved or review-required RTC. ` +
      `Run "testgen rtc review" first.`,
    );
  }

  if (rtc.readiness.band === 'blocked') {
    throw new Error(
      `RTC readiness is "blocked" (score ${rtc.readiness.score}). ` +
      `Resolve blockers before generating tests.`,
    );
  }

  const integrity = verifyRtcIntegrity(rtc);
  if (rtc.status === 'approved' && !integrity.valid) {
    const staleMsg = integrity.stale ? ' The RTC appears stale — re-review it.' : '';
    throw new Error(
      `RTC integrity check failed: ${integrity.errors.join(', ')}.${staleMsg}`,
    );
  }

  if (mapping.ticketId !== rtc.source.ticketId) {
    throw new Error(
      `Mapping is for ticket "${mapping.ticketId}" but RTC is for "${rtc.source.ticketId}".`,
    );
  }

  if (rtc.requirements.length === 0) {
    throw new Error('RTC has no requirements — nothing to generate.');
  }
}

function verifyRed(testFile: string, framework: TestFramework): RedVerification {
  const runner = framework === 'vitest' ? 'npx vitest run' : 'npx jest';
  const cmd = `${runner} --no-coverage "${testFile}" 2>&1`;

  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const { pass, fail } = parseTestOutput(output);
    if (fail > 0) {
      return { testFile, verdict: 'red', failCount: fail, passCount: pass };
    }
    return {
      testFile,
      verdict: 'green',
      failCount: 0,
      passCount: pass,
      errorOutput: 'Tests passed unexpectedly — RED phase violation. Tests should fail before implementation.',
    };
  } catch (err: unknown) {
    const output = (err as { stdout?: string; stderr?: string }).stdout
      ?? (err as { stderr?: string }).stderr ?? '';
    const { pass, fail } = parseTestOutput(output);
    if (fail > 0) {
      return { testFile, verdict: 'red', failCount: fail, passCount: pass };
    }
    return {
      testFile,
      verdict: 'error',
      failCount: 0,
      passCount: 0,
      errorOutput: typeof output === 'string' ? output.slice(0, 2000) : 'Unknown error',
    };
  }
}

function parseTestOutput(output: string): { pass: number; fail: number } {
  const passMatch = output.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const failMatch = output.match(/(\d+)\s+fail(?:ed|ing)?/i);
  return {
    pass: passMatch ? parseInt(passMatch[1], 10) : 0,
    fail: failMatch ? parseInt(failMatch[1], 10) : 0,
  };
}
