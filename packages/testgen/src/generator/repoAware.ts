import path from 'node:path';
import { ComponentInfo } from '../analyzer';
import type {
  ReferenceModuleMock,
  ReferenceObjectShape,
  ReferencePatternSummary,
  ReferenceShapeProperty,
} from '../repoPatterns';
import { mockFn, mockGlobalName, mockModuleFn } from '../utils/framework';
import { buildHookMockReturnValue } from './autoMocks';
import type { ConditionalTestCase } from './interactions';

export interface RepoAwareOptions {
  sourceFilePath: string;
  testFilePath: string;
}

export interface RepoAwareSetup {
  declarations: string[];
  mockStatements: string[];
  beforeEachLines: string[];
}

interface BoundMockPattern extends ReferenceModuleMock {
  importSource: string;
  factoryName: string;
}

export function buildReferenceAwareSetup(
  component: ComponentInfo,
  referencePatterns: ReferencePatternSummary | undefined,
  options: RepoAwareOptions,
): RepoAwareSetup {
  if (!referencePatterns) {
    return { declarations: [], mockStatements: [], beforeEachLines: [] };
  }

  const declarations: string[] = [];
  const mockStatements: string[] = [];
  const beforeEachLines: string[] = [];
  const boundModuleMocks = bindModuleMocks(component, referencePatterns, options);
  const providerObjects = resolveProviderObjects(referencePatterns);

  for (const providerObject of providerObjects) {
    declarations.push(buildObjectFactoryDeclaration(providerObject));
    beforeEachLines.push(`${providerObject.name} = ${buildFactoryName(providerObject.name)}();`);
  }

  for (const moduleMock of boundModuleMocks) {
    const shape = moduleMock.returnShape ?? {
      name: `${moduleMock.mockVariableName}Value`,
      properties: [],
    };
    declarations.push(buildHookFactoryDeclaration(moduleMock.factoryName, shape, moduleMock.mockVariableName));
    mockStatements.push(`${mockModuleFn()}("${moduleMock.importSource}", () => ({
  ${moduleMock.exportName}: ${moduleMock.mockVariableName},
}));`);
    beforeEachLines.push(`${moduleMock.mockVariableName}.mockReset();`);
    beforeEachLines.push(`${moduleMock.mockVariableName}.mockReturnValue(${moduleMock.factoryName}());`);
  }

  if ((referencePatterns.useClearAllMocks || boundModuleMocks.length > 0) && beforeEachLines[0] !== `${mockGlobalName()}.clearAllMocks();`) {
    beforeEachLines.unshift(`${mockGlobalName()}.clearAllMocks();`);
  }

  return {
    declarations: dedupeLines(declarations),
    mockStatements: dedupeLines(mockStatements),
    beforeEachLines: dedupeLines(beforeEachLines),
  };
}

export function buildReferenceScenarioTests(
  component: ComponentInfo,
  referencePatterns: ReferencePatternSummary | undefined,
): ConditionalTestCase[] {
  if (!referencePatterns) return [];

  const tests: ConditionalTestCase[] = [];
  const hookPatterns = referencePatterns.moduleMocks.filter((pattern) =>
    component.hooks.some((hook) => hook.name === pattern.exportName),
  );

  const primaryHook = [...hookPatterns].sort((left, right) => scoreScenarioPattern(right) - scoreScenarioPattern(left))[0];
  if (primaryHook) {
    const factoryName = buildFactoryName(primaryHook.mockVariableName);
    const arrayKey = findFirstProperty(primaryHook.returnShape, ['array']);
    const loadingKey = findPreferredKey(primaryHook.returnShape, ['isLoading', 'loading', 'pending', 'fetching']);
    const errorKey = findPreferredKey(primaryHook.returnShape, ['errorMessage', 'error', 'failureReason']);
    const actionKey = findPreferredActionKey(primaryHook.returnShape);

    if (referencePatterns.scenarios.loading && loadingKey) {
      tests.push({
        title: 'renders loading state',
        body: [
          `${primaryHook.mockVariableName}.mockReturnValue(${factoryName}({ ${loadingKey}: true }));`,
          'renderUI();',
          'expect(screen.queryByText(/loading|please wait/i) ?? screen.queryByRole("status") ?? screen.queryByRole("progressbar")).toBeInTheDocument();',
        ],
      });
    }

    if (referencePatterns.scenarios.empty && arrayKey) {
      tests.push({
        title: 'renders empty state',
        body: [
          `${primaryHook.mockVariableName}.mockReturnValue(${factoryName}({ ${arrayKey}: [] }));`,
          'renderUI();',
          'expect(screen.queryByText(/no .*records|no .*results|no .*transfers|empty/i) ?? screen.queryByText(/no data/i)).toBeInTheDocument();',
        ],
      });
    }

    if (referencePatterns.scenarios.error && errorKey) {
      tests.push({
        title: 'renders error state',
        body: [
          `${primaryHook.mockVariableName}.mockReturnValue(${factoryName}({ ${errorKey}: "Service unavailable" }));`,
          'renderUI();',
          'expect(screen.queryByText(/error|failed|service unavailable|unable/i)).toBeInTheDocument();',
        ],
      });
    }

    if (referencePatterns.scenarios.data && arrayKey) {
      const sampleObject = buildSampleArrayEntry(primaryHook.returnShape, component.name);
      const sampleLabel = /transfers?/i.test(component.name) ? 'Scheduled Transfer' : `${component.name} Row`;
      tests.push({
        title: 'renders data state',
        body: [
          `${primaryHook.mockVariableName}.mockReturnValue(${factoryName}({ ${arrayKey}: [${sampleObject}] }));`,
          'renderUI();',
          `expect(screen.queryByText(/${escapeForRegex(sampleLabel)}/i) ?? screen.queryByRole("table") ?? screen.queryByRole("list")).toBeInTheDocument();`,
        ],
      });
    }

    if (referencePatterns.scenarios.modal && actionKey && component.buttons.length > 0) {
      tests.push({
        title: 'triggers modal action when requested',
        isAsync: true,
        body: [
          'const user = userEvent.setup();',
          `const state = ${factoryName}();`,
          `${primaryHook.mockVariableName}.mockReturnValue(state);`,
          'renderUI();',
          'await user.click(screen.getAllByRole("button")[0]);',
          `expect(state.${actionKey}).toHaveBeenCalled();`,
        ],
      });
    }
  }

  return tests;
}

function scoreScenarioPattern(pattern: ReferenceModuleMock): number {
  if (!pattern.returnShape) return 0;
  return pattern.returnShape.properties.reduce((score, property) => {
    if (property.kind === 'array') return score + 4;
    if (property.kind === 'fn') return score + 2;
    if (/loading|error|message|failure/i.test(property.key)) return score + 5;
    return score + 1;
  }, 0);
}

function bindModuleMocks(
  component: ComponentInfo,
  referencePatterns: ReferencePatternSummary,
  options: RepoAwareOptions,
): BoundMockPattern[] {
  const bound: BoundMockPattern[] = [];

  for (const hook of component.hooks) {
    if (!hook.importSource) continue;
    const pattern = referencePatterns.moduleMocks.find((entry) => entry.exportName === hook.name);
    if (!pattern) continue;

    bound.push({
      ...pattern,
      importSource: rebaseRelativeImport(hook.importSource, options.sourceFilePath, options.testFilePath),
      factoryName: buildFactoryName(pattern.mockVariableName),
    });
  }

  return bound;
}

function resolveProviderObjects(referencePatterns: ReferencePatternSummary): ReferenceObjectShape[] {
  return referencePatterns.providerWrappers
    .map((wrapper) => wrapper.valueObjectName)
    .filter((value): value is string => Boolean(value))
    .map((name) => referencePatterns.objectShapes.find((shape) => shape.name === name))
    .filter((shape): shape is ReferenceObjectShape => Boolean(shape));
}

function buildHookFactoryDeclaration(
  factoryName: string,
  shape: ReferenceObjectShape,
  mockVariableName: string,
): string {
  const body = shape.properties.length > 0
    ? buildObjectLiteral(shape.properties)
    : buildFallbackHookValue(factoryName, mockVariableName);

  return [
    `const ${factoryName} = (overrides: Record<string, unknown> = {}) => ({`,
    ...indentLines(body),
    '  ...overrides,',
    '});',
    `const ${mockVariableName} = ${mockGlobalName()}.fn(() => ${factoryName}());`,
  ].join('\n');
}

function buildObjectFactoryDeclaration(shape: ReferenceObjectShape): string {
  const factoryName = buildFactoryName(shape.name);
  return [
    `const ${factoryName} = (overrides: Record<string, unknown> = {}) => ({`,
    ...indentLines(buildObjectLiteral(shape.properties)),
    '  ...overrides,',
    '});',
    `let ${shape.name} = ${factoryName}();`,
  ].join('\n');
}

function buildObjectLiteral(properties: ReferenceShapeProperty[]): string[] {
  return properties.map((property) => `  ${property.key}: ${normalizeLiteral(property)},`);
}

function buildFallbackHookValue(factoryName: string, mockVariableName: string): string[] {
  const rawHookName = mockVariableName.replace(/^mock/, '');
  const hookName = rawHookName.length > 0
    ? rawHookName.charAt(0).toLowerCase() + rawHookName.slice(1)
    : factoryName;
  const fallback = buildHookMockReturnValue(hookName);
  const inner = fallback.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (inner.length === 0) {
    return ['  data: [],'];
  }
  return splitTopLevel(inner).map((segment) => `  ${segment.trim()},`);
}

function normalizeLiteral(property: ReferenceShapeProperty): string {
  if (property.kind === 'fn') return mockFn();
  return property.literal;
}

function buildSampleArrayEntry(shape: ReferenceObjectShape | undefined, componentName: string): string {
  const properties = shape?.properties ?? [];
  if (properties.length === 0) {
    return `{ id: "1", name: "${componentName} Row" }`;
  }

  const mapped = properties
    .filter((property) => property.kind !== 'array')
    .slice(0, 4)
    .map((property) => {
      if (/name|title|label|description/i.test(property.key)) {
        return `${property.key}: "Scheduled Transfer"`;
      }
      if (property.kind === 'fn') {
        return `${property.key}: ${mockFn()}`;
      }
      if (property.kind === 'number') {
        return `${property.key}: 1`;
      }
      if (property.kind === 'boolean') {
        return `${property.key}: false`;
      }
      if (property.kind === 'null') {
        return `${property.key}: null`;
      }
      if (property.kind === 'object') {
        return `${property.key}: { id: "1" }`;
      }
      return `${property.key}: "Scheduled Transfer"`;
    });

  if (!mapped.some((entry) => entry.startsWith('id:'))) {
    mapped.unshift('id: "1"');
  }
  if (!mapped.some((entry) => /name:|title:|label:|description:/.test(entry))) {
    mapped.push('name: "Scheduled Transfer"');
  }

  return `{ ${mapped.join(', ')} }`;
}

function findPreferredKey(
  shape: ReferenceObjectShape | undefined,
  preferredKeys: string[],
): string | null {
  if (!shape) return null;
  const keyMap = new Map(shape.properties.map((property) => [property.key, property.key]));
  for (const key of preferredKeys) {
    if (keyMap.has(key)) return keyMap.get(key) ?? null;
  }
  return null;
}

function findFirstProperty(
  shape: ReferenceObjectShape | undefined,
  kinds: Array<ReferenceShapeProperty['kind']>,
): string | null {
  if (!shape) return null;
  const match = shape.properties.find((property) => kinds.includes(property.kind));
  return match?.key ?? null;
}

function findPreferredActionKey(shape: ReferenceObjectShape | undefined): string | null {
  if (!shape) return null;
  const preferred = shape.properties.find((property) =>
    property.kind === 'fn' && /open|show|toggle|handle|set|dispatch/i.test(property.key),
  );
  return preferred?.key ?? null;
}

function buildFactoryName(baseName: string): string {
  const normalized = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  return `create${normalized}`;
}

function rebaseRelativeImport(importSource: string, sourceFilePath: string, testFilePath: string): string {
  if (!importSource.startsWith('.')) return importSource;

  const sourceDir = path.dirname(sourceFilePath);
  const testDir = path.dirname(testFilePath);
  const absoluteTarget = path.resolve(sourceDir, importSource);
  let rebased = path.relative(testDir, absoluteTarget).split('\\').join('/');
  if (!rebased.startsWith('.')) rebased = `./${rebased}`;
  return rebased;
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

function dedupeLines(lines: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    deduped.push(line);
  }

  return deduped;
}

function indentLines(lines: string[]): string[] {
  return lines.map((line) => `  ${line.trimStart()}`);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
