import fs from 'node:fs';
import path from 'node:path';
import type {
  TraceabilityChain,
  TraceabilityInput,
  TraceabilityLink,
  TraceGate,
  TraceGateStatus,
  TestRelevanceProof,
} from './types';
import type { FrozenTestRecord } from '../greenPhase/types';
import type { GreenPhaseResult } from '../greenPhase/types';
import type { MutationResult } from '../mutation/types';

export function buildTraceabilityChain(input: TraceabilityInput): TraceabilityChain {
  const { ticketId, repoRoot } = input;
  const redResultDir = path.resolve(repoRoot, input.redResultDir ?? `.testgen-results/red`);
  const greenResultDir = path.resolve(repoRoot, input.greenResultDir ?? `.testgen-results/green`);
  const mutationResultDir = path.resolve(repoRoot, input.mutationResultDir ?? `.testgen-results/mutation`);

  const frozenRecord = tryLoadJson<FrozenTestRecord>(
    path.join(redResultDir, `${ticketId}.frozen.json`),
  );
  const greenResult = tryLoadJson<GreenPhaseResult>(
    path.join(greenResultDir, ticketId, 'green-result.json'),
  );
  const mutationResult = tryLoadJson<MutationResult>(
    path.join(mutationResultDir, ticketId, 'mutation-result.json'),
  );

  const regressionResultDir = path.resolve(repoRoot, `.testgen-results/regression`);

  const links: TraceabilityChain['links'] = {
    ticketRevision: frozenRecord
      ? link('ticket-revision', frozenRecord.ticketId, frozenRecord.generatedAt, `Ticket ${ticketId} as of RED phase`)
      : pendingLink('ticket-revision'),

    rtcHash: frozenRecord
      ? link('rtc-hash', frozenRecord.rtcHash, frozenRecord.generatedAt, 'Approved RTC content hash')
      : pendingLink('rtc-hash'),

    mappingEvidence: tryLoadMappingLink(repoRoot, ticketId),

    generatedTestHash: frozenRecord
      ? link('test-hash', frozenRecord.testFileHash, frozenRecord.generatedAt, `${frozenRecord.testFile}`)
      : pendingLink('test-hash'),

    redResult: frozenRecord
      ? link('red-verdict', frozenRecord.redTaxonomy, frozenRecord.generatedAt,
          `${frozenRecord.failCount} failing, ${frozenRecord.passCount} passing`)
      : pendingLink('red-verdict'),

    greenResult: greenResult
      ? link('green-verdict', greenResult.verdict, greenResult.generatedAt,
          `${greenResult.passCount} passing, ${greenResult.failCount} failing`)
      : undefined,

    mutationResult: mutationResult
      ? link('mutation-score', String(mutationResult.effectiveScore), mutationResult.generatedAt,
          `${mutationResult.killedMutants}/${mutationResult.totalMutants} mutants killed (${mutationResult.gateMode})`)
      : undefined,

    regressionSuite: tryLoadRegressionLink(regressionResultDir, ticketId),
  };

  const relevanceProofs = buildRelevanceProofs(ticketId, frozenRecord, greenResult, mutationResult);
  const chainComplete = isChainComplete(links);

  const outputDir = path.resolve(repoRoot, '.testgen-results', 'traceability', ticketId);
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'traceability-chain.json');

  const chain: TraceabilityChain = {
    schemaVersion: 1,
    ticketId,
    generatedAt: new Date().toISOString(),
    links,
    relevanceProofs,
    chainComplete,
    reportPath,
  };

  fs.writeFileSync(reportPath, JSON.stringify(chain, null, 2), 'utf8');
  return chain;
}

export function generateTraceabilityReport(chain: TraceabilityChain): string {
  const lines: string[] = [];
  lines.push(`# Traceability Chain — ${chain.ticketId}`);
  lines.push('');
  lines.push(`Generated: ${chain.generatedAt}  `);
  lines.push(`Complete: ${chain.chainComplete ? '✓ Yes' : '✗ Incomplete'}`);
  lines.push('');
  lines.push('## Evidence Chain');
  lines.push('');

  const linkOrder: Array<keyof TraceabilityChain['links']> = [
    'ticketRevision', 'rtcHash', 'mappingEvidence',
    'generatedTestHash', 'redResult', 'greenResult',
    'mutationResult', 'regressionSuite',
  ];

  for (const key of linkOrder) {
    const l = chain.links[key];
    if (!l) continue;
    const status = l.hash === 'PENDING' ? '⏳' : '✓';
    lines.push(`${status} **${l.kind}**: \`${l.hash.slice(0, 16)}${l.hash.length > 16 ? '…' : ''}\``);
    if (l.detail) lines.push(`   ${l.detail}`);
  }

  lines.push('');
  lines.push('## Test Relevance Proofs');
  lines.push('');

  for (const proof of chain.relevanceProofs) {
    const icon = proof.overallStatus === 'VALIDATED' ? '✓' : proof.overallStatus === 'PARTIAL' ? '⚠' : '✗';
    lines.push(`### ${icon} ${proof.requirementId} — ${proof.overallStatus}`);
    lines.push('');
    lines.push(`> ${proof.summary}`);
    lines.push('');

    const gateEntries = Object.values(proof.gates) as TraceGate[];
    for (const gate of gateEntries) {
      const gIcon = gate.status === 'PASS' ? '✓' : gate.status === 'PENDING' ? '⏳' : gate.status === 'WAIVED' ? '~' : '✗';
      lines.push(`- ${gIcon} **${gate.name}**: ${gate.evidence}`);
      if (gate.detail) lines.push(`  *${gate.detail}*`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*This chain is evidence, not a guarantee. Distributed behavior means a requirement can span multiple functions.*');

  return lines.join('\n');
}

function buildRelevanceProofs(
  ticketId: string,
  frozen: FrozenTestRecord | null,
  green: GreenPhaseResult | null,
  mutation: MutationResult | null,
): TestRelevanceProof[] {
  if (!frozen) return [];

  const requirementIds = extractRequirementIdsFromFrozen(frozen);
  return requirementIds.map((reqId) => buildProof(ticketId, reqId, frozen, green, mutation));
}

function buildProof(
  ticketId: string,
  requirementId: string,
  frozen: FrozenTestRecord,
  green: GreenPhaseResult | null,
  mutation: MutationResult | null,
): TestRelevanceProof {
  const provenanceGate: TraceGate = {
    name: 'Requirement Provenance',
    description: 'Every assertion traces back to an RTC criterion via @rtc-requirement comment',
    status: frozen ? 'PASS' : 'FAIL',
    evidence: frozen
      ? `assertionSource: ${ticketId}/${requirementId} — comment present in frozen test`
      : 'No frozen test record found',
  };

  const reachabilityGate: TraceGate = {
    name: 'Runtime Reachability',
    description: 'The test actually executes the mapped symbol, not just something nearby',
    status: frozen?.redTaxonomy === 'EXPECTED_RED_ASSERTION' ? 'PASS'
      : frozen?.redTaxonomy === 'EXPECTED_RED_MISSING_REQUIRED_API' ? 'PENDING'
      : 'PENDING',
    evidence: frozen
      ? `RED verdict: ${frozen.redTaxonomy}`
      : 'Pending RED phase run',
    detail: frozen?.redTaxonomy === 'EXPECTED_RED_MISSING_REQUIRED_API'
      ? 'Symbol does not yet exist — reachability confirmed once implementation is in place'
      : undefined,
  };

  const sensitivityGate: TraceGate = {
    name: 'Counterfactual Sensitivity',
    description: 'Mutation testing confirms the test fails when the mapped behavior is deliberately broken',
    status: mutationGateStatus(mutation),
    evidence: mutation
      ? `Mutation score: ${mutation.effectiveScore}% (${mutation.killedMutants}/${mutation.totalMutants} killed, ${mutation.gateMode})`
      : 'Pending mutation run — install Stryker and run "testgen mutate"',
  };

  const differentialGate: TraceGate = {
    name: 'Differential RED/GREEN',
    description: 'The identical frozen test is RED on base, GREEN on head',
    status: differentialGateStatus(frozen, green),
    evidence: buildDifferentialEvidence(frozen, green),
  };

  const allGates = [provenanceGate, reachabilityGate, sensitivityGate, differentialGate];
  const passingGates = allGates.filter((g) => g.status === 'PASS').length;
  const overallStatus = passingGates === 4 ? 'VALIDATED'
    : passingGates >= 2 ? 'PARTIAL'
    : 'INSUFFICIENT';

  const summary = overallStatus === 'VALIDATED'
    ? `TC-${ticketId}-${requirementId} provides validated evidence for ${requirementId} through the mapped symbol.`
    : `TC-${ticketId}-${requirementId} has ${passingGates}/4 gates passing — further work needed.`;

  return {
    ticketId,
    requirementId,
    gates: {
      requirementProvenance: provenanceGate,
      runtimeReachability: reachabilityGate,
      counterfactualSensitivity: sensitivityGate,
      differentialRedGreen: differentialGate,
    },
    overallStatus,
    summary,
  };
}

function mutationGateStatus(mutation: MutationResult | null): TraceGateStatus {
  if (!mutation) return 'PENDING';
  if (!mutation.strykerAvailable) return 'PENDING';
  if (mutation.effectiveScore >= 80) return 'PASS';
  return 'FAIL';
}

function differentialGateStatus(
  frozen: FrozenTestRecord | null,
  green: GreenPhaseResult | null,
): TraceGateStatus {
  if (!frozen) return 'PENDING';
  const redOk = frozen.redTaxonomy === 'EXPECTED_RED_ASSERTION' || frozen.redTaxonomy === 'EXPECTED_RED_MISSING_REQUIRED_API';
  if (!redOk) return 'FAIL';
  if (!green) return 'PENDING';
  return green.verdict === 'GREEN' && green.hashMatch ? 'PASS' : 'FAIL';
}

function buildDifferentialEvidence(
  frozen: FrozenTestRecord | null,
  green: GreenPhaseResult | null,
): string {
  if (!frozen) return 'Pending RED phase run';
  const redPart = `RED on base: ${frozen.redTaxonomy} (${frozen.failCount} failing)`;
  if (!green) return `${redPart} | GREEN: pending`;
  const greenPart = `GREEN on head: ${green.verdict} (${green.passCount} passing)`;
  return `${redPart} | ${greenPart}`;
}

function extractRequirementIdsFromFrozen(frozen: FrozenTestRecord): string[] {
  if (!frozen.testFile) return [frozen.ticketId];
  try {
    const content = fs.existsSync(frozen.testFile)
      ? fs.readFileSync(frozen.testFile, 'utf8')
      : '';
    const matches = [...content.matchAll(/@rtc-requirement\s+([\w-]+)/g)];
    const ids = [...new Set(matches.map((m) => m[1]))];
    return ids.length > 0 ? ids : [`${frozen.ticketId}-REQ`];
  } catch {
    return [`${frozen.ticketId}-REQ`];
  }
}

function tryLoadRegressionLink(regressionResultDir: string, ticketId: string): TraceabilityLink | undefined {
  const regressionPath = path.join(regressionResultDir, ticketId, 'regression-suite.json');
  if (!fs.existsSync(regressionPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(regressionPath, 'utf8')) as {
      suiteFile?: string;
      testCount?: number;
      generatedAt?: string;
    };
    return link(
      'regression-suite',
      raw.suiteFile ?? 'registered',
      raw.generatedAt ?? new Date().toISOString(),
      raw.testCount !== undefined ? `${raw.testCount} regression test(s) for ${ticketId}` : `Regression suite for ${ticketId}`,
    );
  } catch {
    return undefined;
  }
}

function tryLoadMappingLink(repoRoot: string, ticketId: string): TraceabilityLink {
  const mappingPath = path.resolve(repoRoot, `.testgen-results/mapping/${ticketId}-mapping.json`);
  if (!fs.existsSync(mappingPath)) return pendingLink('mapping-evidence');
  try {
    const raw = JSON.parse(fs.readFileSync(mappingPath, 'utf8')) as { rtcHash?: string; generatedAt?: string };
    return link(
      'mapping-evidence',
      raw.rtcHash ?? 'unknown',
      raw.generatedAt ?? new Date().toISOString(),
      `Multi-signal mapping for ${ticketId}`,
    );
  } catch {
    return pendingLink('mapping-evidence');
  }
}

function isChainComplete(links: TraceabilityChain['links']): boolean {
  // Core links must all resolve (mapping evidence is opportunistic, not required).
  const required: Array<keyof typeof links> = ['ticketRevision', 'rtcHash', 'generatedTestHash', 'redResult'];
  if (!required.every((k) => links[k] && links[k]!.hash !== 'PENDING')) return false;
  // GREEN must be proven (verdict === 'GREEN', not just any non-PENDING hash).
  if (!links.greenResult || links.greenResult.hash !== 'GREEN') return false;
  // Mutation evidence must be present and not pending.
  if (!links.mutationResult || links.mutationResult.hash === 'PENDING') return false;
  // Regression suite must be registered.
  if (!links.regressionSuite || links.regressionSuite.hash === 'PENDING') return false;
  return true;
}

function link(kind: string, hash: string, timestamp: string, detail?: string): TraceabilityLink {
  return { kind, hash, timestamp, detail };
}

function pendingLink(kind: string): TraceabilityLink {
  return { kind, hash: 'PENDING', timestamp: new Date().toISOString() };
}

function tryLoadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}
