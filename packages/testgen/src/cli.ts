/*
Usage:
  npm run testgen                         # default mode from config (git-unstaged by default)
  npm run testgen -- --mode all           # scan configured package files
  npm run testgen -- --file src/x.tsx     # single file
  npm run testgen -- --changed-since origin/main --mode changed-since
*/

import path from 'path';
import { createParser } from './parser';
import { analyzeSourceFile } from './analyzer';
import { getTestFilePath, isTestFile, setPathResolutionContext } from './utils/path';
import { writeFile } from './fs';
import { generateTests } from './generator';
import { generateBarrelTest } from './generator/barrel';
import { generateUtilityTest } from './generator/utility';
import { generateContextTest } from './generator/context';
import { setActiveFramework } from './utils/framework';
import { ROOT_DIR } from './config';
import { loadConfig, GenerationMode, FrameworkMode } from './workspace/config';
import { resolveWorkspacePackages, resolveTargetFiles, TargetFile } from './workspace/discovery';

interface CliOptions {
    file?: string;
    gitUnstaged?: boolean;
    all?: boolean;
    config?: string;
    packageName?: string;
    changedSince?: string;
    mode?: GenerationMode;
    framework?: FrameworkMode;
    dryRun?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {};
    const fileIndex = argv.indexOf('--file');
    if (fileIndex >= 0 && argv[fileIndex + 1]) options.file = argv[fileIndex + 1];

    const configIndex = argv.indexOf('--config');
    if (configIndex >= 0 && argv[configIndex + 1]) options.config = argv[configIndex + 1];

    const packageIndex = argv.indexOf('--package');
    if (packageIndex >= 0 && argv[packageIndex + 1]) options.packageName = argv[packageIndex + 1];

    const changedSinceIndex = argv.indexOf('--changed-since');
    if (changedSinceIndex >= 0 && argv[changedSinceIndex + 1]) options.changedSince = argv[changedSinceIndex + 1];

    const modeIndex = argv.indexOf('--mode');
    if (modeIndex >= 0 && argv[modeIndex + 1]) options.mode = argv[modeIndex + 1] as GenerationMode;

    const frameworkIndex = argv.indexOf('--framework');
    if (frameworkIndex >= 0 && argv[frameworkIndex + 1]) options.framework = argv[frameworkIndex + 1] as FrameworkMode;

    if (argv.includes('--git-unstaged')) options.gitUnstaged = true;
    if (argv.includes('--all')) options.all = true;
    if (argv.includes('--dry-run')) options.dryRun = true;

    return options;
}

function resolveMode(args: CliOptions, defaultMode: GenerationMode): GenerationMode {
    if (args.mode) return args.mode;
    if (args.file) return 'file';
    if (args.changedSince) return 'changed-since';
    if (args.all) return 'all';
    if (args.gitUnstaged) return 'git-unstaged';
    return defaultMode;
}

function isServiceFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    if (/service|api|client|repository|gateway|adapter/i.test(basename)) return true;
    const hasHttpClient = content.includes('axios') || content.includes('fetch(') || content.includes('ky.') || content.includes('got.');
    const hasAsyncMethods = (content.match(/async\s/g) || []).length >= 2;
    return hasHttpClient && hasAsyncMethods;
}

function isContextProviderFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    if (basename.includes('context')) return true;
    return content.includes('createContext') && (content.includes('Provider') || content.includes('useContext'));
}

function isTestUtilityFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/test-utils/') || normalized.includes('/test-helpers/') ||
        normalized.includes('/testUtils/') || normalized.includes('/testHelpers/') ||
        normalized.includes('/testing/') || normalized.includes('/__test-utils__/')) {
        return true;
    }
    const basename = path.basename(filePath).toLowerCase();
    return /^(renderwithproviders|customrender|test-?helpers?|test-?utils?|setup-?tests?|jest-?setup|vitest-?setup|test-?wrapper)/i
        .test(basename.replace(/\.(tsx?|jsx?)$/, ''));
}

function isBarrelFile(filePath: string, content: string): boolean {
    const basename = path.basename(filePath);
    if (!/^index\.(ts|tsx)$/.test(basename)) return false;
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return false;
    const exportLines = lines.filter((line) => /^\s*(export\s|import\s)/.test(line));
    return exportLines.length >= lines.length * 0.7;
}

function isLikelyHookFile(filePath: string, sourceText: string): boolean {
    const base = path.basename(filePath, path.extname(filePath));
    if (/^use[A-Z]/.test(base)) return true;
    return /export\s+(?:const|function)\s+use[A-Z]/.test(sourceText);
}

function shouldGenerateNonComponent(target: TargetFile, filePath: string, sourceText: string): boolean {
    const isHook = isLikelyHookFile(filePath, sourceText);
    if (isHook) return target.generateFor.includes('hooks');
    return target.generateFor.includes('utils');
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const config = loadConfig(ROOT_DIR, args.config);
    const workspacePackages = resolveWorkspacePackages(config, ROOT_DIR);
    const mode = resolveMode(args, config.defaults.mode);

    const targets = resolveTargetFiles({
        mode,
        packages: workspacePackages,
        packageName: args.packageName,
        changedSince: args.changedSince,
        file: args.file,
        frameworkOverride: args.framework ?? 'auto',
        workspaceRoot: ROOT_DIR,
    });

    console.log(`Resolved ${targets.length} file(s) to process.`);
    if (targets.length === 0) {
        console.log('No matching source files found.');
        return;
    }

    if (args.dryRun) {
        printDryRun(targets, mode);
        return;
    }

    const parserByPackage = new Map<string, ReturnType<typeof createParser>>();

    for (const [index, target] of targets.entries()) {
        if (!parserByPackage.has(target.packageRoot)) {
            parserByPackage.set(target.packageRoot, createParser(target.packageRoot));
        }
        const parser = parserByPackage.get(target.packageRoot)!;
        const sourceFile = parser.project.getSourceFile(target.filePath) ?? parser.project.addSourceFileAtPath(target.filePath);

        console.log(`\n[${index + 1}/${targets.length}] Processing ${target.filePath}`);
        setActiveFramework(target.framework);
        setPathResolutionContext({
            packageRoot: target.packageRoot,
            renderHelperOverride: target.renderHelper,
        });

        if (isTestUtilityFile(target.filePath) || isTestFile(target.filePath)) {
            console.log('  - Test utility/test file detected. Skipping.');
            continue;
        }

        const sourceText = sourceFile.getText();
        const testFilePath = getTestFilePath(target.filePath);

        if (isBarrelFile(target.filePath, sourceText) && target.generateFor.includes('utils')) {
            const barrelTest = generateBarrelTest(sourceFile, testFilePath, target.filePath);
            if (barrelTest) {
                console.log(`  - Barrel file detected. Writing test: ${testFilePath}`);
                writeFile(testFilePath, barrelTest);
                console.log('  - Barrel test file generated/updated.');
            } else {
                console.log('  - No named exports found in barrel. Skipping.');
            }
            continue;
        }

        if (isContextProviderFile(target.filePath, sourceText) && target.generateFor.includes('components')) {
            const contextTest = generateContextTest(sourceFile, parser.checker, testFilePath, target.filePath);
            if (contextTest) {
                console.log(`  - Context provider detected. Writing test: ${testFilePath}`);
                writeFile(testFilePath, contextTest);
                console.log('  - Context test file generated/updated.');
                continue;
            }
        }

        const components = analyzeSourceFile(sourceFile, parser.project, parser.checker);
        if (components.length > 0) {
            if (!target.generateFor.includes('components')) {
                console.log('  - Component generation disabled for this package. Skipping.');
                continue;
            }
            const generatedTest = generateTests(components, {
                pass: 2,
                testFilePath,
                sourceFilePath: target.filePath,
            });
            console.log(`  - Writing component test file: ${testFilePath}`);
            writeFile(testFilePath, generatedTest);
            console.log('  - Component test file generated/updated.');
            continue;
        }

        if (!shouldGenerateNonComponent(target, target.filePath, sourceText)) {
            console.log('  - Non-component generation disabled for this file type. Skipping.');
            continue;
        }

        const fileType = isServiceFile(target.filePath, sourceText) ? 'service' as const : 'utility' as const;
        const utilityTest = generateUtilityTest(sourceFile, parser.checker, testFilePath, target.filePath, fileType);
        if (utilityTest) {
            console.log(`  - Writing ${fileType} test file: ${testFilePath}`);
            writeFile(testFilePath, utilityTest);
            console.log(`  - ${fileType} test file generated/updated.`);
        } else {
            console.log('  - No exported functions found. Skipping.');
        }
    }

    setActiveFramework(null);
    setPathResolutionContext(null);
}

function printDryRun(targets: TargetFile[], mode: GenerationMode): void {
    console.log(`Dry run mode: ${mode}`);
    const byPackage = new Map<string, TargetFile[]>();
    for (const target of targets) {
        if (!byPackage.has(target.packageName)) byPackage.set(target.packageName, []);
        byPackage.get(target.packageName)!.push(target);
    }

    for (const [pkg, files] of byPackage.entries()) {
        const first = files[0];
        console.log(`\nPackage: ${pkg}`);
        console.log(`  Root: ${first.packageRoot}`);
        console.log(`  Framework: ${first.framework}`);
        console.log(`  Render helper: ${first.renderHelper}`);
        console.log(`  Files: ${files.length}`);
    }
}

run().catch((error) => {
    setActiveFramework(null);
    setPathResolutionContext(null);
    console.error(error);
    process.exit(1);
});
