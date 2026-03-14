import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ComponentInfo, analyzeSourceFile } from '../src/analyzer';
import { generateTests } from '../src/generator';
import { createParser, getSourceFile } from '../src/parser';
import { classifyFailure } from '../src/selfHeal/failureClassifier';
import { chooseRepairStrategy } from '../src/selfHeal/repairEngine';
import { buildRepairTraitsFromComponents } from '../src/selfHeal/repairTraits';
import { ComponentTraits, RepairPatchOperationType } from '../src/selfHeal/types';
import { setActiveFramework } from '../src/utils/framework';
import { getTestFilePath, setPathResolutionContext } from '../src/utils/path';

interface RegressionHealingExpectation {
  failureText: string;
  expectedActionId: string;
  expectedCategory?: string;
  seedTestContentPath?: string;
  expectedHealedSnippets?: string[];
  forbiddenHealedSnippets?: string[];
  expectedGeneratorPatchTypes?: RepairPatchOperationType[];
}

interface RegressionFixtureManifest {
  name: string;
  description: string;
  sourceFile: string;
  expectedGeneratedSnippets?: string[];
  forbiddenGeneratedSnippets?: string[];
  traitOverrides?: Partial<ComponentTraits>;
  healing: RegressionHealingExpectation;
}

const regressionsRoot = path.resolve(__dirname, 'fixtures', 'regressions');
const expectedRoot = path.join(regressionsRoot, 'expected');

export function runHealedRegressionSuite(): void {
  const manifests = loadRegressionManifests();
  const parser = createParser(regressionsRoot);

  setActiveFramework('jest');
  setPathResolutionContext({
    packageRoot: regressionsRoot,
    renderHelperOverride: 'auto',
  });

  try {
    for (const manifest of manifests) {
      runRegressionFixture(parser.project, parser.checker, manifest);
    }
  } finally {
    setPathResolutionContext(null);
    setActiveFramework(null);
  }

  console.log(`Healed regression fixture checks passed (${manifests.length} fixtures)`);
}

function loadRegressionManifests(): RegressionFixtureManifest[] {
  return fs.readdirSync(expectedRoot)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => {
      const manifestPath = path.join(expectedRoot, entry);
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RegressionFixtureManifest;
    });
}

function runRegressionFixture(
  project: ReturnType<typeof createParser>['project'],
  checker: ReturnType<typeof createParser>['checker'],
  manifest: RegressionFixtureManifest,
): void {
  const sourceFilePath = path.join(regressionsRoot, manifest.sourceFile);
  const testFilePath = getTestFilePath(sourceFilePath);
  const sourceFile = getSourceFile(project, sourceFilePath);
  const components = analyzeSourceFile(sourceFile, project, checker);

  assert.ok(components.length > 0, `${manifest.name}: fixture should analyze at least one component`);

  const generatedContent = generateTests(components, {
    pass: 1,
    testFilePath,
    sourceFilePath,
    project,
    checker,
  });

  for (const snippet of manifest.expectedGeneratedSnippets ?? []) {
    assert.match(
      generatedContent,
      new RegExp(escapeRegExp(snippet)),
      `${manifest.name}: expected generated output to contain ${snippet}`,
    );
  }

  for (const snippet of manifest.forbiddenGeneratedSnippets ?? []) {
    assert.doesNotMatch(
      generatedContent,
      new RegExp(escapeRegExp(snippet)),
      `${manifest.name}: generated output should not contain ${snippet}`,
    );
  }

  const seedContent = manifest.healing.seedTestContentPath
    ? fs.readFileSync(path.join(regressionsRoot, manifest.healing.seedTestContentPath), 'utf8')
    : generatedContent;
  const failure = classifyFailure(manifest.healing.failureText);
  const repairTraits = mergeTraits(
    buildRepairTraitsFromComponents(components, sourceFilePath, testFilePath),
    manifest.traitOverrides,
  );
  const decision = chooseRepairStrategy({
    testContent: seedContent,
    failure,
    componentTraits: repairTraits,
    sourceFilePath,
    testFilePath,
  });

  if (manifest.healing.expectedCategory) {
    assert.equal(
      failure.category,
      manifest.healing.expectedCategory,
      `${manifest.name}: classified failure category should match`,
    );
  }

  assert.equal(
    decision.action.id,
    manifest.healing.expectedActionId,
    `${manifest.name}: chosen repair action should match`,
  );

  if ((manifest.healing.expectedHealedSnippets?.length ?? 0) > 0) {
    assert.ok(decision.updatedContent, `${manifest.name}: repair should produce updated content`);
    const updatedContent = decision.updatedContent ?? '';
    for (const snippet of manifest.healing.expectedHealedSnippets ?? []) {
      assert.match(
        updatedContent,
        new RegExp(escapeRegExp(snippet)),
        `${manifest.name}: healed output should contain ${snippet}`,
      );
    }
    for (const snippet of manifest.healing.forbiddenHealedSnippets ?? []) {
      assert.doesNotMatch(
        updatedContent,
        new RegExp(escapeRegExp(snippet)),
        `${manifest.name}: healed output should not contain ${snippet}`,
      );
    }
  }

  if ((manifest.healing.expectedGeneratorPatchTypes?.length ?? 0) > 0) {
    const actualTypes = new Set<RepairPatchOperationType>(
      (decision.generatorPatch ?? []).map((patch) => patch.type),
    );
    for (const patchType of manifest.healing.expectedGeneratorPatchTypes ?? []) {
      assert.ok(
        actualTypes.has(patchType),
        `${manifest.name}: expected generator patch type ${patchType}`,
      );
    }
  }
}

function mergeTraits(
  baseTraits: ComponentTraits | undefined,
  overrides: Partial<ComponentTraits> | undefined,
): ComponentTraits | undefined {
  if (!baseTraits && !overrides) {
    return undefined;
  }

  return {
    ...(baseTraits ?? {}),
    ...(overrides ?? {}),
    requiredProviders: overrides?.requiredProviders ?? baseTraits?.requiredProviders,
    importResolutionHints: overrides?.importResolutionHints ?? baseTraits?.importResolutionHints,
    selectorReplacements: overrides?.selectorReplacements ?? baseTraits?.selectorReplacements,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  runHealedRegressionSuite();
}
