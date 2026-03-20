import fs from 'node:fs';
import path from 'node:path';
import { ComponentInfo } from './analyzer';
import { listFilesRecursive } from './fs';

export interface ReferenceScenarioFlags {
  loading: boolean;
  empty: boolean;
  error: boolean;
  data: boolean;
  modal: boolean;
  apiFailure: boolean;
}

export type ReferenceValueKind =
  | 'array'
  | 'boolean'
  | 'fn'
  | 'null'
  | 'number'
  | 'object'
  | 'string'
  | 'unknown';

export interface ReferenceShapeProperty {
  key: string;
  kind: ReferenceValueKind;
  literal: string;
}

export interface ReferenceObjectShape {
  name: string;
  properties: ReferenceShapeProperty[];
}

export interface ReferenceProviderWrapper {
  name: string;
  valueObjectName?: string;
}

export interface ReferenceModuleMock {
  exportName: string;
  mockVariableName: string;
  returnShape?: ReferenceObjectShape;
}

export interface ReferencePatternSummary {
  selectedReferences: string[];
  providerWrappers: ReferenceProviderWrapper[];
  moduleMocks: ReferenceModuleMock[];
  objectShapes: ReferenceObjectShape[];
  scenarios: ReferenceScenarioFlags;
  useClearAllMocks: boolean;
  preferredQueryStyle: 'role-first' | 'text-first';
  preferredTimingStyle: 'async-first' | 'sync-first';
}

interface SourceSignals {
  componentNames: Set<string>;
  hookNames: Set<string>;
  contextNames: Set<string>;
  providerNames: Set<string>;
  serviceTokens: Set<string>;
  pathTokens: Set<string>;
  providerSignals: Set<string>;
}

interface ScoredReference {
  filePath: string;
  score: number;
}

interface ParsedReferenceFile {
  filePath: string;
  providerWrappers: ReferenceProviderWrapper[];
  moduleMocks: ReferenceModuleMock[];
  objectShapes: ReferenceObjectShape[];
  scenarios: ReferenceScenarioFlags;
  useClearAllMocks: boolean;
  roleQueries: number;
  textQueries: number;
  asyncSignals: number;
  syncSignals: number;
}

const SOURCE_ROOT_SEGMENTS = ['src', 'app', 'lib', 'source'];

export function mineReferencePatterns(
  sourceFilePath: string,
  testFilePath: string,
  components: ComponentInfo[],
): ReferencePatternSummary | null {
  const packageRoot = detectPackageRoot(sourceFilePath);
  if (!packageRoot || !fs.existsSync(packageRoot)) {
    return null;
  }

  const signals = buildSourceSignals(sourceFilePath, components);
  const candidates = findCandidateTests(packageRoot, testFilePath, sourceFilePath, signals);
  if (candidates.length === 0) {
    return null;
  }

  const parsed = candidates
    .slice(0, 4)
    .map((candidate) => parseReferenceFile(candidate.filePath, signals))
    .filter((entry): entry is ParsedReferenceFile => entry !== null);

  if (parsed.length === 0) {
    return null;
  }

  const roleQueries = parsed.reduce((sum, entry) => sum + entry.roleQueries, 0);
  const textQueries = parsed.reduce((sum, entry) => sum + entry.textQueries, 0);
  const asyncSignals = parsed.reduce((sum, entry) => sum + entry.asyncSignals, 0);
  const syncSignals = parsed.reduce((sum, entry) => sum + entry.syncSignals, 0);

  return {
    selectedReferences: parsed.map((entry) => entry.filePath),
    providerWrappers: dedupeProviderWrappers(parsed.flatMap((entry) => entry.providerWrappers), signals),
    moduleMocks: dedupeModuleMocks(parsed.flatMap((entry) => entry.moduleMocks), signals),
    objectShapes: dedupeObjectShapes(parsed.flatMap((entry) => entry.objectShapes)),
    scenarios: mergeScenarioFlags(parsed.map((entry) => entry.scenarios)),
    useClearAllMocks: parsed.some((entry) => entry.useClearAllMocks),
    preferredQueryStyle: roleQueries >= textQueries ? 'role-first' : 'text-first',
    preferredTimingStyle: asyncSignals >= syncSignals ? 'async-first' : 'sync-first',
  };
}

function detectPackageRoot(sourceFilePath: string): string | null {
  const normalized = normalizeSlashes(path.resolve(sourceFilePath));

  for (const segment of SOURCE_ROOT_SEGMENTS) {
    const marker = `/${segment}/`;
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) {
      return normalized.slice(0, index);
    }
  }

  return path.dirname(sourceFilePath);
}

function buildSourceSignals(sourceFilePath: string, components: ComponentInfo[]): SourceSignals {
  const componentNames = new Set<string>();
  const hookNames = new Set<string>();
  const contextNames = new Set<string>();
  const providerNames = new Set<string>();
  const serviceTokens = new Set<string>();
  const pathTokens = new Set<string>();
  const providerSignals = new Set<string>();

  for (const component of components) {
    componentNames.add(component.name.toLowerCase());
    component.hooks.forEach((hook) => hookNames.add(hook.name.toLowerCase()));
    component.contexts.forEach((context) => {
      contextNames.add(context.contextName.toLowerCase());
      if (context.providerName) {
        providerNames.add(context.providerName.toLowerCase());
      }
    });
    component.serviceImports.forEach((serviceImport) => {
      tokenizeValue(serviceImport).forEach((token) => serviceTokens.add(token));
    });
    component.traits.providerSignals.forEach((signal) => providerSignals.add(signal));
  }

  tokenizeValue(sourceFilePath).forEach((token) => pathTokens.add(token));

  return {
    componentNames,
    hookNames,
    contextNames,
    providerNames,
    serviceTokens,
    pathTokens,
    providerSignals,
  };
}

function findCandidateTests(
  packageRoot: string,
  testFilePath: string,
  sourceFilePath: string,
  signals: SourceSignals,
): ScoredReference[] {
  const allFiles = listFilesRecursive(packageRoot);
  const normalizedCurrentTest = normalizeSlashes(path.resolve(testFilePath));
  const normalizedSourceFile = normalizeSlashes(path.resolve(sourceFilePath));

  return allFiles
    .filter((filePath) => isEligibleReferenceTest(filePath, normalizedCurrentTest))
    .map((filePath) => ({
      filePath,
      score: scoreReferenceFile(filePath, normalizedSourceFile, signals),
    }))
    .filter((candidate) => candidate.score >= 20)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.filePath.localeCompare(right.filePath);
    });
}

function isEligibleReferenceTest(filePath: string, currentTestFilePath: string): boolean {
  const normalized = normalizeSlashes(path.resolve(filePath));
  if (normalized === currentTestFilePath) return false;
  if (!/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(normalized)) return false;
  if (normalized.includes('/node_modules/')) return false;
  if (normalized.includes('/dist/') || normalized.includes('/build/') || normalized.includes('/coverage/')) {
    return false;
  }

  try {
    const firstChunk = fs.readFileSync(filePath, 'utf8').slice(0, 160);
    return !firstChunk.includes('@generated by react-testgen');
  } catch {
    return false;
  }
}

function scoreReferenceFile(filePath: string, sourceFilePath: string, signals: SourceSignals): number {
  const normalizedReference = normalizeSlashes(path.resolve(filePath));
  const normalizedSource = normalizeSlashes(path.resolve(sourceFilePath));
  const referenceDir = normalizedReference.replace(/\/__tests__\/[^/]+$/, '').replace(/\/[^/]+$/, '');
  const sourceDir = normalizedSource.replace(/\/[^/]+$/, '');
  const sourceRel = tokenizeValue(sourceDir);
  const referenceRel = tokenizeValue(referenceDir);

  let score = 0;
  const sharedPathTokens = referenceRel.filter((token) => sourceRel.includes(token));
  score += sharedPathTokens.length * 6;

  const sourceParent = path.basename(sourceDir).toLowerCase();
  const referenceParent = path.basename(referenceDir).toLowerCase();
  if (sourceParent === referenceParent) score += 30;

  const sourceGrandParent = path.basename(path.dirname(sourceDir)).toLowerCase();
  const referenceGrandParent = path.basename(path.dirname(referenceDir)).toLowerCase();
  if (sourceGrandParent === referenceGrandParent) score += 18;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    score += countSignalHits(content, signals.hookNames) * 8;
    score += countSignalHits(content, signals.contextNames) * 7;
    score += countSignalHits(content, signals.providerNames) * 7;
    score += countSignalHits(content, signals.serviceTokens) * 4;
    score += countSignalHits(content, signals.componentNames) * 3;

    if (signals.providerSignals.has('react-query') && /QueryClientProvider/.test(content)) score += 10;
    if (signals.providerSignals.has('redux') && /<Provider\b|react-redux/.test(content)) score += 10;
    if (signals.providerSignals.has('router') && /MemoryRouter|BrowserRouter/.test(content)) score += 10;
    if (signals.providerSignals.has('context') && /\.Provider\b/.test(content)) score += 12;
  } catch {
    return score;
  }

  return score;
}

function countSignalHits(content: string, values: Set<string>): number {
  let count = 0;
  const lower = content.toLowerCase();
  for (const value of values) {
    if (value.length < 3) continue;
    if (lower.includes(value)) count++;
  }
  return count;
}

function parseReferenceFile(filePath: string, signals: SourceSignals): ParsedReferenceFile | null {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const objectShapes = extractObjectShapes(content);
  const moduleMocks = extractModuleMocks(content, signals, objectShapes);
  const providerWrappers = extractProviderWrappers(content, signals);
  const titles = extractTestTitles(content);

  return {
    filePath,
    providerWrappers,
    moduleMocks,
    objectShapes,
    scenarios: {
      loading: titles.some((title) => /\bloading|loader|busy|pending|fetching\b/.test(title)),
      empty: titles.some((title) => /\bempty|no data|no records|no results|no .*transfers|no .*transactions\b/.test(title)),
      error: titles.some((title) => /\berror|failure|failed|unable\b/.test(title)),
      data: titles.some((title) => /\btable|list|rows|data|records|renders .*transfers|renders .*transactions\b/.test(title)),
      modal: titles.some((title) => /\bmodal|dialog|drawer|open\b/.test(title)),
      apiFailure: titles.some((title) => /\bapi|request|service failure|network|server\b/.test(title)),
    },
    useClearAllMocks: /\b(beforeEach|afterEach)\b[\s\S]{0,200}\b(?:vi|jest)\.clearAllMocks\(\)/.test(content),
    roleQueries: countMatches(content, /\b(?:getByRole|findByRole|queryByRole|getAllByRole)\b/g),
    textQueries: countMatches(content, /\b(?:getByText|findByText|queryByText)\b/g),
    asyncSignals: countMatches(content, /\bwaitFor\(|\bfindBy[A-Z]|\basync\s*\(/g),
    syncSignals: countMatches(content, /\bgetBy[A-Z]|\bqueryBy[A-Z]/g),
  };
}

function extractProviderWrappers(content: string, signals: SourceSignals): ReferenceProviderWrapper[] {
  const wrappers: ReferenceProviderWrapper[] = [];
  const wrapperRegex = /<([A-Z][A-Za-z0-9_.]+(?:Provider|\.Provider))(?:\s+[^>]*value=\{(\w+)\})?[^>]*>/g;

  for (const match of content.matchAll(wrapperRegex)) {
    const name = match[1];
    const lowerName = name.toLowerCase();
    const contextRelevant =
      signals.contextNames.size === 0 ||
      Array.from(signals.contextNames).some((token) => lowerName.includes(token.replace(/context$/, '')));
    const providerRelevant =
      signals.providerNames.size === 0 ||
      Array.from(signals.providerNames).some((token) => lowerName.includes(token.replace(/provider$/, '')));
    const frameworkWrapper = /MemoryRouter|QueryClientProvider|Provider$/.test(name);

    if (contextRelevant || providerRelevant || frameworkWrapper) {
      wrappers.push({
        name,
        valueObjectName: match[2],
      });
    }
  }

  return wrappers;
}

function extractModuleMocks(
  content: string,
  signals: SourceSignals,
  objectShapes: ReferenceObjectShape[],
): ReferenceModuleMock[] {
  const mocks: ReferenceModuleMock[] = [];
  const mockBlocks = content.matchAll(/(?:vi|jest)\.mock\((["'])([^"'`]+)\1,\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/g);

  for (const match of mockBlocks) {
    const body = match[3];
    const exportRegex = /([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const exportMatch of body.matchAll(exportRegex)) {
      const exportName = exportMatch[1];
      const mockVariableName = exportMatch[2];
      const lowerExportName = exportName.toLowerCase();
      const relevant =
        signals.hookNames.has(lowerExportName) ||
        signals.contextNames.has(lowerExportName) ||
        signals.providerNames.has(lowerExportName);

      if (!relevant && !/^mock[A-Z]/.test(mockVariableName)) continue;

      const returnShape = findReturnShapeForMock(content, exportName, mockVariableName, objectShapes);
      mocks.push({
        exportName,
        mockVariableName,
        returnShape,
      });
    }
  }

  return mocks;
}

function findReturnShapeForMock(
  content: string,
  exportName: string,
  mockVariableName: string,
  objectShapes: ReferenceObjectShape[],
): ReferenceObjectShape | undefined {
  const inlineReturnRegex = new RegExp(
    `${escapeRegExp(exportName)}\\s*:\\s*(?:vi|jest)\\.fn\\(\\(\\)\\s*=>\\s*\\((\\{[\\s\\S]*?\\})\\)\\)`,
    'm',
  );
  const inlineMatch = inlineReturnRegex.exec(content);
  if (inlineMatch) {
    return {
      name: `${mockVariableName}Value`,
      properties: extractObjectProperties(inlineMatch[1]),
    };
  }

  const returnValueRegex = new RegExp(
    `${escapeRegExp(mockVariableName)}\\.mockReturnValue(?:Once)?\\((\\{[\\s\\S]*?\\})\\)`,
    'm',
  );
  const returnValueMatch = returnValueRegex.exec(content);
  if (returnValueMatch) {
    return {
      name: `${mockVariableName}Value`,
      properties: extractObjectProperties(returnValueMatch[1]),
    };
  }

  const fallback = objectShapes.find((shape) => shape.name.toLowerCase().includes(exportName.toLowerCase()));
  return fallback;
}

function extractObjectShapes(content: string): ReferenceObjectShape[] {
  const shapes: ReferenceObjectShape[] = [];
  const objectRegex = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]*?\n\})\s*;?/g;
  const factoryRegex = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*\((\{[\s\S]*?\})\)\s*;?/g;

  for (const match of content.matchAll(objectRegex)) {
    const properties = extractObjectProperties(match[2]);
    if (properties.length > 0) {
      shapes.push({ name: match[1], properties });
    }
  }

  for (const match of content.matchAll(factoryRegex)) {
    const properties = extractObjectProperties(match[2]);
    if (properties.length > 0) {
      shapes.push({ name: match[1], properties });
    }
  }

  return shapes;
}

function extractObjectProperties(text: string): ReferenceShapeProperty[] {
  const inner = text.trim().replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  const properties: ReferenceShapeProperty[] = [];

  for (const segment of splitTopLevel(inner)) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = segment.slice(0, colonIndex).trim().replace(/^["']|["']$/g, '');
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    const literal = segment.slice(colonIndex + 1).trim();
    properties.push({
      key,
      literal,
      kind: classifyLiteralKind(literal),
    });
  }

  return properties;
}

function splitTopLevel(value: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const prev = value[index - 1];

    if (quote) {
      current += char;
      if (char === quote && prev !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') depth++;
    if (char === '}' || char === ']' || char === ')') depth--;

    if (char === ',' && depth === 0) {
      if (current.trim().length > 0) segments.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }

  return segments;
}

function classifyLiteralKind(literal: string): ReferenceValueKind {
  const trimmed = literal.trim();
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed === 'null') return 'null';
  if (/^(?:vi|jest)\.fn/.test(trimmed) || /\(\)\s*=>/.test(trimmed)) return 'fn';
  if (/^\[/.test(trimmed)) return 'array';
  if (/^\{/.test(trimmed)) return 'object';
  if (/^["'`]/.test(trimmed)) return 'string';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return 'number';
  return 'unknown';
}

function extractTestTitles(content: string): string[] {
  return Array.from(content.matchAll(/\b(?:it|test)\(\s*(["'`])([\s\S]*?)\1/g))
    .map((match) => match[2].toLowerCase());
}

function dedupeProviderWrappers(
  wrappers: ReferenceProviderWrapper[],
  signals: SourceSignals,
): ReferenceProviderWrapper[] {
  const seen = new Set<string>();
  const filtered: ReferenceProviderWrapper[] = [];

  for (const wrapper of wrappers) {
    const lowerName = wrapper.name.toLowerCase();
    if (
      !/MemoryRouter|QueryClientProvider|Provider$/.test(wrapper.name) &&
      !Array.from(signals.contextNames).some((token) => lowerName.includes(token.replace(/context$/, '')))
    ) {
      continue;
    }

    const key = `${wrapper.name}::${wrapper.valueObjectName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(wrapper);
  }

  return filtered;
}

function dedupeModuleMocks(
  mocks: ReferenceModuleMock[],
  signals: SourceSignals,
): ReferenceModuleMock[] {
  const seen = new Set<string>();
  const filtered: ReferenceModuleMock[] = [];

  for (const mock of mocks) {
    if (!signals.hookNames.has(mock.exportName.toLowerCase())) continue;
    const key = mock.exportName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(mock);
  }

  return filtered;
}

function dedupeObjectShapes(shapes: ReferenceObjectShape[]): ReferenceObjectShape[] {
  const merged = new Map<string, ReferenceObjectShape>();

  for (const shape of shapes) {
    const key = shape.name.toLowerCase();
    const existing = merged.get(key);
    if (!existing || shape.properties.length > existing.properties.length) {
      merged.set(key, shape);
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function mergeScenarioFlags(flags: ReferenceScenarioFlags[]): ReferenceScenarioFlags {
  return {
    loading: flags.some((entry) => entry.loading),
    empty: flags.some((entry) => entry.empty),
    error: flags.some((entry) => entry.error),
    data: flags.some((entry) => entry.data),
    modal: flags.some((entry) => entry.modal),
    apiFailure: flags.some((entry) => entry.apiFailure),
  };
}

function tokenizeValue(value: string): string[] {
  return normalizeSlashes(value)
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);
}

function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

function normalizeSlashes(value: string): string {
  return value.split('\\').join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
