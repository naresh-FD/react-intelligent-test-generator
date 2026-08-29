import fs from 'node:fs';
import path from 'node:path';
import {
  extractRtc,
  readRtc,
  scoreReadiness,
  validateRtcSchema,
  writeRtcDraft,
} from '../requirements';
import { buildSymbolIndex, mapRequirements } from '../mapping';
import { runRedPhase } from '../redPhase';
import { runGreenPhase, classifyRedTaxonomy } from '../greenPhase';
import { runMutation } from '../mutation';
import { loadWaivers } from '../mutation/waiver';
import { buildTraceabilityChain } from '../traceability';
import { generateBoardReport, postBoardComment } from '../reportPhase';
import { loadRequirementsConfig, saveAndCompareSnapshot } from '../workItems';
import type { WorkItemProvider } from '../workItems/types';
import type { PilotTicketResult, PilotStepResult } from './types';
import type { TraceGateStatus } from '../traceability/types';
import type { FrozenTestRecord } from '../greenPhase/types';
import type { MappingResult } from '../mapping/types';

export function loadPilotResult(ticketId: string, repoRoot: string): PilotTicketResult | null {
  const filePath = path.resolve(repoRoot, '.testgen-results', 'pilot', ticketId, 'pilot-result.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PilotTicketResult;
}

export function savePilotResult(result: PilotTicketResult, repoRoot: string): string {
  const dir = path.resolve(repoRoot, '.testgen-results', 'pilot', result.ticketId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'pilot-result.json');
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}

export async function runPilotRtcStep(
  ticketId: string,
  provider: WorkItemProvider,
  config: ReturnType<typeof loadRequirementsConfig>,
  repoRoot: string,
): Promise<NonNullable<PilotTicketResult['steps']['rtc']>> {
  const t0 = Date.now();
  try {
    const project = config.provider === 'ado' ? config.ado?.project : undefined;
    const ticket = await provider.getTicket({ provider: config.provider, id: ticketId, project });
    saveAndCompareSnapshot(ticket, repoRoot);
    const rtc = extractRtc(ticket);
    const schema = validateRtcSchema(rtc);
    if (!schema.valid || !schema.rtc) {
      return makeStep('rtc', 'FAIL', Date.now() - t0, `RTC schema invalid: ${schema.errors.join(', ')}`,
        { readinessScore: 0, readinessBand: 'blocked', ambiguityCount: 0, approvalRequired: true });
    }
    const rtcDir = path.resolve(repoRoot, config.rtcDirectory);
    writeRtcDraft(path.join(rtcDir, `${ticketId}.rtc.yaml`), schema.rtc, repoRoot);
    const readiness = scoreReadiness(schema.rtc.requirements, schema.rtc.ambiguities);
    const approvalRequired = readiness.band !== 'ready';
    return makeStep('rtc', approvalRequired ? 'BLOCKED' : 'PASS', Date.now() - t0,
      `Score ${readiness.score} (${readiness.band}), ${schema.rtc.ambiguities.length} ambiguities`,
      { readinessScore: readiness.score, readinessBand: readiness.band, ambiguityCount: schema.rtc.ambiguities.length, approvalRequired });
  } catch (err) {
    return makeStep('rtc', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { readinessScore: 0, readinessBand: 'blocked', ambiguityCount: 0, approvalRequired: true });
  }
}

export function runPilotMappingStep(
  ticketId: string,
  repoRoot: string,
  tsconfig?: string,
  rtcDirectory?: string,
): NonNullable<PilotTicketResult['steps']['mapping']> {
  const t0 = Date.now();
  try {
    const rtcPath = resolveRtcPath(ticketId, repoRoot, rtcDirectory);
    if (!rtcPath) return makeStep('mapping', 'FAIL', Date.now() - t0, 'RTC file not found — run rtc step first.', { autoMapped: 0, reviewRequired: 0, blocked: 0, avgConfidence: 0 });
    const loaded = readRtc(rtcPath, repoRoot);
    const schema = validateRtcSchema(loaded);
    if (!schema.valid || !schema.rtc) return makeStep('mapping', 'FAIL', Date.now() - t0, 'Invalid RTC file.', { autoMapped: 0, reviewRequired: 0, blocked: 0, avgConfidence: 0 });

    const index = buildSymbolIndex(repoRoot, tsconfig);
    const result = mapRequirements(schema.rtc, index);

    const outputDir = path.resolve(repoRoot, '.testgen-results', 'mapping');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${ticketId}-mapping.json`), JSON.stringify(result, null, 2), 'utf8');

    const autoMapped = result.decisions.filter((d) => d.policy === 'auto-map').length;
    const reviewRequired = result.decisions.filter((d) => d.policy === 'review-required').length;
    const blocked = result.decisions.filter((d) => d.policy === 'blocked').length;
    const confidences = result.decisions.flatMap((d) => d.candidates.map((c) => c.confidence));
    const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return makeStep('mapping', blocked > 0 ? 'BLOCKED' : 'PASS', Date.now() - t0,
      `${autoMapped} auto-mapped, ${reviewRequired} review-required, ${blocked} blocked. Avg confidence ${(avgConfidence * 100).toFixed(0)}%`,
      { autoMapped, reviewRequired, blocked, avgConfidence });
  } catch (err) {
    return makeStep('mapping', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err), { autoMapped: 0, reviewRequired: 0, blocked: 0, avgConfidence: 0 });
  }
}

export function runPilotRedStep(
  ticketId: string,
  repoRoot: string,
  framework: 'jest' | 'vitest' = 'jest',
  rtcDirectory?: string,
): NonNullable<PilotTicketResult['steps']['red']> {
  const t0 = Date.now();
  try {
    const rtcPath = resolveRtcPath(ticketId, repoRoot, rtcDirectory);
    if (!rtcPath) return makeStep('red', 'FAIL', Date.now() - t0, 'RTC not found.', { taxonomy: 'INVALID_RED_COMPILE', frozenHashWritten: false, testsGenerated: 0, rtcHash: '' });
    const loaded = readRtc(rtcPath, repoRoot);
    const schema = validateRtcSchema(loaded);
    if (!schema.valid || !schema.rtc) return makeStep('red', 'FAIL', Date.now() - t0, 'Invalid RTC.', { taxonomy: 'INVALID_RED_COMPILE', frozenHashWritten: false, testsGenerated: 0, rtcHash: '' });

    const mappingPath = path.resolve(repoRoot, '.testgen-results', 'mapping', `${ticketId}-mapping.json`);
    const mapping: MappingResult = fs.existsSync(mappingPath)
      ? JSON.parse(fs.readFileSync(mappingPath, 'utf8')) as MappingResult
      : mapRequirements(schema.rtc, buildSymbolIndex(repoRoot));

    const outputDir = '.testgen-results/red';
    const result = runRedPhase({ rtc: schema.rtc, mapping, config: { framework, outputDir, dryRun: false }, repoRoot });

    const frozenPath = path.resolve(repoRoot, outputDir, `${ticketId}.frozen.json`);
    const frozenHashWritten = fs.existsSync(frozenPath);
    const v = result.verifications[0];
    const taxonomy = classifyRedTaxonomy(v?.errorOutput ?? '', v?.failCount ?? 0, v?.passCount ?? 0);

    if (taxonomy === 'BASELINE_ALREADY_GREEN') {
      return makeStep('red', 'BLOCKED', Date.now() - t0,
        'BASELINE_ALREADY_GREEN — behavior already exists, wrong target, or test too weak. Stop and investigate.',
        { taxonomy, frozenHashWritten, testsGenerated: result.summary.testsGenerated, rtcHash: result.rtcHash });
    }

    const status = taxonomy.startsWith('INVALID') ? 'FAIL' : 'PASS';
    return makeStep('red', status, Date.now() - t0,
      `${taxonomy} — ${result.summary.testsGenerated} tests, frozen hash written: ${frozenHashWritten}`,
      { taxonomy, frozenHashWritten, testsGenerated: result.summary.testsGenerated, rtcHash: result.rtcHash });
  } catch (err) {
    return makeStep('red', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { taxonomy: 'INVALID_RED_COMPILE', frozenHashWritten: false, testsGenerated: 0, rtcHash: '' });
  }
}

export function runPilotVerifyStep(
  ticketId: string,
  repoRoot: string,
  framework: 'jest' | 'vitest' = 'jest',
  implementationAttempts = 1,
): NonNullable<PilotTicketResult['steps']['green']> {
  const t0 = Date.now();
  try {
    const result = runGreenPhase({ ticketId, repoRoot, redResultDir: '.testgen-results/red', framework });
    // Persist so the traceability chain can read it in Step F
    const greenOutputDir = path.resolve(repoRoot, '.testgen-results', 'green', ticketId);
    fs.mkdirSync(greenOutputDir, { recursive: true });
    fs.writeFileSync(path.join(greenOutputDir, 'green-result.json'), JSON.stringify(result, null, 2), 'utf8');
    const passed = result.verdict === 'GREEN' && result.hashMatch;
    const status = passed ? 'PASS' : result.verdict === 'HASH_MISMATCH' || result.verdict === 'ASSERTION_WEAKENED' ? 'BLOCKED' : 'FAIL';
    return makeStep('green', status, Date.now() - t0,
      `${result.verdict} — hash match: ${result.hashMatch}, ${result.passCount} passing`,
      { verdict: result.verdict, hashMatched: result.hashMatch, implementationAttempts });
  } catch (err) {
    return makeStep('green', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { verdict: 'ERROR', hashMatched: false, implementationAttempts });
  }
}

export function runPilotMutationStep(
  ticketId: string,
  repoRoot: string,
  mutatedFiles: string[],
): NonNullable<PilotTicketResult['steps']['mutation']> {
  const t0 = Date.now();
  try {
    const frozenPath = path.resolve(repoRoot, '.testgen-results', 'red', `${ticketId}.frozen.json`);
    if (!fs.existsSync(frozenPath)) {
      return makeStep('mutation', 'SKIPPED', Date.now() - t0, 'No frozen record — run red step first.',
        { score: 0, killedMutants: 0, survivedMutants: 0, waiversUsed: 0, strykerAvailable: false });
    }
    const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8')) as FrozenTestRecord;
    const waivers = loadWaivers(repoRoot).filter((w) => w.ticketId === ticketId);
    const result = runMutation({ ticketId, repoRoot, mutatedFiles, testFile: frozen.testFile, gateMode: 'report-only' }, frozen.rtcHash);
    const outputDir = path.resolve(repoRoot, '.testgen-results', 'mutation', ticketId);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'mutation-result.json'), JSON.stringify(result, null, 2), 'utf8');
    return makeStep('mutation', 'PASS', Date.now() - t0,
      `Score ${result.effectiveScore}% — ${result.killedMutants}/${result.totalMutants} killed, ${waivers.length} waivers. Stryker: ${result.strykerAvailable}`,
      { score: result.effectiveScore, killedMutants: result.killedMutants, survivedMutants: result.survivedMutants, waiversUsed: waivers.length, strykerAvailable: result.strykerAvailable });
  } catch (err) {
    return makeStep('mutation', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { score: 0, killedMutants: 0, survivedMutants: 0, waiversUsed: 0, strykerAvailable: false });
  }
}

export function runPilotTraceStep(
  ticketId: string,
  repoRoot: string,
): NonNullable<PilotTicketResult['steps']['trace']> {
  const t0 = Date.now();
  try {
    const chain = buildTraceabilityChain({ ticketId, repoRoot });
    const gatesMap: Record<string, TraceGateStatus> = {};
    let passed = 0;
    let totalGates = 0;
    for (const proof of chain.relevanceProofs) {
      for (const [key, gate] of Object.entries(proof.gates)) {
        totalGates++;
        gatesMap[key] = gate.status; // summary view: last proof's status per gate name
        if (gate.status === 'PASS') passed++;
      }
    }
    return makeStep('trace', chain.chainComplete ? 'PASS' : 'FAIL', Date.now() - t0,
      `${passed}/${totalGates} gates passed. Chain complete: ${chain.chainComplete}`,
      { gatesPassed: passed, totalGates, gates: gatesMap });
  } catch (err) {
    return makeStep('trace', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { gatesPassed: 0, totalGates: 0, gates: {} });
  }
}

export async function runPilotReportStep(
  ticketId: string,
  repoRoot: string,
  provider?: WorkItemProvider,
  project?: string,
): Promise<NonNullable<PilotTicketResult['steps']['report']>> {
  const t0 = Date.now();
  try {
    const report = generateBoardReport(ticketId, repoRoot);
    const outputDir = path.resolve(repoRoot, '.testgen-results', 'reports', ticketId);
    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, 'board-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'board-report.md'), report.comment, 'utf8');

    let postedToAdo = false;
    if (provider?.addComment) {
      const r = await postBoardComment(report, provider, reportPath, project);
      postedToAdo = r.postedToAdo;
    }

    return makeStep('report', 'PASS', Date.now() - t0,
      `${report.overallStatus} — ADO post: ${postedToAdo}. Ticket state changed: never.`,
      { overallStatus: report.overallStatus, postedToAdo, ticketStateChanged: false as const });
  } catch (err) {
    return makeStep('report', 'FAIL', Date.now() - t0, err instanceof Error ? err.message : String(err),
      { overallStatus: 'PENDING', postedToAdo: false, ticketStateChanged: false as const });
  }
}

function resolveRtcPath(ticketId: string, repoRoot: string, rtcDirectory?: string): string | null {
  const candidates = [
    path.resolve(repoRoot, '.testgen-results', 'requirements', 'drafts', `${ticketId}.rtc.yaml`),
    path.resolve(repoRoot, '.testgen-results', 'requirements', 'drafts', `${ticketId}.rtc.json`),
  ];
  if (rtcDirectory) {
    candidates.push(
      path.resolve(repoRoot, rtcDirectory, `${ticketId}.rtc.yaml`),
      path.resolve(repoRoot, rtcDirectory, `${ticketId}.rtc.json`),
    );
  }
  return candidates.find(fs.existsSync) ?? null;
}

function makeStep<T extends Record<string, unknown>>(
  stepName: string,
  status: PilotStepResult['status'],
  durationMs: number,
  notes: string,
  extra: T,
): PilotStepResult & T {
  return { step: stepName, status, durationMs, notes, data: extra, ...extra };
}
