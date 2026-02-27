import fs from 'node:fs';
import path from 'node:path';

import { execSync } from 'child_process';
import { isTestFile } from '../utils/path';
import { listFilesRecursive } from '../fs';
import { ROOT_DIR, detectSrcDir } from '../config';
import { detectFrameworkForFile, TestFramework } from '../utils/framework';
import { GenerationMode, TestgenConfig, TestgenPackageConfig } from './config';

export interface ResolvedPackage {
  name: string;
  root: string;
  include: string[];
  exclude: string[];
  framework: 'auto' | TestFramework;
  renderHelper: string | 'auto';
  generateFor: Array<'components' | 'hooks' | 'utils'>;
  mode: GenerationMode;
}

export interface TargetFile {
  filePath: string;
  packageName: string;
  packageRoot: string;
  framework: TestFramework;
  renderHelper: string | 'auto';
  generateFor: Array<'components' | 'hooks' | 'utils'>;
}

export interface ResolveTargetFilesOptions {
  mode: GenerationMode;
  workspaceRoot?: string;
  packages: ResolvedPackage[];
  packageName?: string;
  changedSince?: string;
  file?: string;
  frameworkOverride?: 'auto' | TestFramework;
}

export function resolveWorkspacePackages(
  config: TestgenConfig,
  rootDir: string = ROOT_DIR
): ResolvedPackage[] {
  return config.packages.map((pkg) => resolvePackage(pkg, config.defaults, rootDir));
}

export function resolveTargetFiles(options: ResolveTargetFilesOptions): TargetFile[] {
  const workspaceRoot = options.workspaceRoot ?? ROOT_DIR;
  const selectedPackages = filterSelectedPackages(options.packages, options.packageName);

  let candidateFiles: string[] = [];
  if (options.mode === 'file') {
    if (!options.file) {
      throw new Error('Mode "file" requires --file <path>.');
    }
    candidateFiles = [resolveAbsolutePath(workspaceRoot, options.file)];
  } else if (options.mode === 'all') {
    candidateFiles = selectedPackages.flatMap((pkg) => scanPackageFiles(pkg));
  } else if (options.mode === 'changed-since') {
    if (!options.changedSince) {
      throw new Error('Mode "changed-since" requires --changed-since <git-ref>.');
    }
    candidateFiles = getGitChangedFiles(workspaceRoot, `${options.changedSince}...HEAD`);
  } else {
    candidateFiles = getGitChangedFiles(workspaceRoot, null);
  }

  const deduped = Array.from(new Set(candidateFiles.map((f) => normalizePath(f))));
  const resolved: TargetFile[] = [];

  for (const filePath of deduped) {
    if (!isEligibleSource(filePath)) continue;
    const pkg = selectedPackages.find((p) => isFileInPackage(filePath, p.root));
    if (!pkg) continue;
    if (!matchesPackageGlobs(filePath, pkg)) continue;

    const framework =
      options.frameworkOverride && options.frameworkOverride !== 'auto'
        ? options.frameworkOverride
        : pkg.framework === 'auto'
          ? detectFrameworkForFile(filePath, pkg.root)
          : pkg.framework;

    resolved.push({
      filePath,
      packageName: pkg.name,
      packageRoot: pkg.root,
      framework,
      renderHelper: pkg.renderHelper,
      generateFor: pkg.generateFor,
    });
  }

  return resolved;
}

function resolvePackage(
  pkg: TestgenPackageConfig,
  defaults: TestgenConfig['defaults'],
  rootDir: string
): ResolvedPackage {
  const packageRoot = resolveAbsolutePath(rootDir, pkg.root);
  if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
    throw new Error(`Configured package root does not exist: ${pkg.root}`);
  }

  return {
    name: pkg.name,
    root: packageRoot,
    include: pkg.include ?? defaults.include,
    exclude: pkg.exclude ?? defaults.exclude,
    framework: pkg.framework ?? defaults.framework,
    renderHelper: resolveRenderHelperPath(pkg.renderHelper ?? defaults.renderHelper, packageRoot),
    generateFor: pkg.generateFor ?? defaults.generateFor,
    mode: pkg.mode ?? defaults.mode,
  };
}

function filterSelectedPackages(
  packages: ResolvedPackage[],
  packageName?: string
): ResolvedPackage[] {
  if (!packageName) return packages;
  const selected = packages.filter((p) => p.name === packageName);
  if (selected.length === 0) {
    throw new Error(`Unknown package "${packageName}".`);
  }
  return selected;
}

function scanPackageFiles(pkg: ResolvedPackage): string[] {
  const srcDir = detectSrcDir(pkg.root);
  const scanRoot = fs.existsSync(srcDir) ? srcDir : pkg.root;
  if (!fs.existsSync(scanRoot)) return [];
  const files = listFilesRecursive(scanRoot);
  return files.filter((filePath) => matchesPackageGlobs(filePath, pkg));
}

function matchesPackageGlobs(filePath: string, pkg: ResolvedPackage): boolean {
  const relativePath = toRelativePosix(pkg.root, filePath);
  const includeMatch =
    pkg.include.length === 0 || pkg.include.some((pattern) => matchGlob(relativePath, pattern));
  if (!includeMatch) return false;
  return !pkg.exclude.some((pattern) => matchGlob(relativePath, pattern));
}

function getGitChangedFiles(workspaceRoot: string, range: string | null): string[] {
  try {
    const command = range
      ? `git diff --name-only --diff-filter=ACMTU ${range}`
      : 'git diff --name-only --diff-filter=ACMTU';
    const output = execSync(command, {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => resolveAbsolutePath(workspaceRoot, line))
      .filter((filePath) => fs.existsSync(filePath));
  } catch {
    return [];
  }
}

function resolveRenderHelperPath(
  renderHelper: string | 'auto',
  packageRoot: string
): string | 'auto' {
  if (renderHelper === 'auto') return 'auto';
  return resolveAbsolutePath(packageRoot, renderHelper);
}

function resolveAbsolutePath(root: string, target: string): string {
  const resolved = path.isAbsolute(target) ? target : path.join(root, target);
  return normalizePath(resolved);
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath);
}

function isEligibleSource(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  if (isTestFile(filePath)) return false;
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function isFileInPackage(filePath: string, packageRoot: string): boolean {
  const normalizedFile = normalizePath(filePath).toLowerCase();
  const normalizedRoot = normalizePath(packageRoot).toLowerCase();
  return (
    normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function toRelativePosix(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function matchGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const regex = globToRegex(normalizedPattern);
  return regex.test(relativePath);
}

function globToRegex(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];

    if (char === '*' && next === '*') {
      out += '.*';
      i++;
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const options = pattern
          .slice(i + 1, close)
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .map((item) => escapeRegex(item));
        out += `(${options.join('|')})`;
        i = close;
        continue;
      }
    }

    out += escapeRegex(char);
  }
  out += '$';
  return new RegExp(out);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
