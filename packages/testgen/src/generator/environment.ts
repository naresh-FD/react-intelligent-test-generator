import fs from 'node:fs';
import path from 'node:path';
import { ComponentInfo } from '../analyzer';
import { mockFn, mockGlobalName } from '../utils/framework';
import { SourceImportUsage } from './mockRegistry';

export type EnvironmentRequirementKey =
  | 'matchMedia'
  | 'ResizeObserver'
  | 'IntersectionObserver'
  | 'scrollTo'
  | 'print'
  | 'canvas'
  | 'portal-root'
  | 'fetch'
  | 'crypto';

export interface EnvironmentRequirement {
  key: EnvironmentRequirementKey;
  source: 'component' | 'import' | 'repair';
}

export interface EnvironmentPlan {
  requirements: EnvironmentRequirement[];
  topLevelSnippets: string[];
  beforeEachLines: string[];
  hasCentralSetup: boolean;
}

export interface EnvironmentPlanOptions {
  sourceFilePath: string;
  sourceText: string;
  sourceImports: SourceImportUsage[];
}

export function planEnvironment(
  components: ComponentInfo[],
  options: EnvironmentPlanOptions,
): EnvironmentPlan {
  const requirements = collectRequirements(components, options);
  const hasCentralSetup = detectCentralSetupSupport(options.sourceFilePath);

  return {
    requirements,
    hasCentralSetup,
    topLevelSnippets: hasCentralSetup ? [] : requirements.flatMap((requirement) => buildTopLevelSnippet(requirement.key)),
    beforeEachLines: requirements.flatMap((requirement) => buildBeforeEachLines(requirement.key)),
  };
}

function collectRequirements(
  components: ComponentInfo[],
  options: EnvironmentPlanOptions,
): EnvironmentRequirement[] {
  const required = new Map<EnvironmentRequirementKey, EnvironmentRequirement>();
  const sourceText = options.sourceText;
  const importModules = new Set(options.sourceImports.map((entry) => entry.modulePath));

  const mark = (key: EnvironmentRequirementKey, source: EnvironmentRequirement['source']): void => {
    if (!required.has(key)) {
      required.set(key, { key, source });
    }
  };

  components.forEach((component) => {
    if (component.usesRecharts) {
      mark('matchMedia', 'component');
      mark('ResizeObserver', 'component');
      mark('canvas', 'component');
    }
    if (component.usesPortal) {
      mark('portal-root', 'component');
    }
    if (component.usesRouter || /\bscrollTo\b/.test(sourceText)) {
      mark('scrollTo', 'component');
    }
    if (/\bwindow\.print\b|\bprint\s*\(/.test(sourceText)) {
      mark('print', 'component');
    }
    if (/\bfetch\s*\(/.test(sourceText)) {
      mark('fetch', 'component');
    }
    if (/\bcrypto\b|\brandomUUID\b/.test(sourceText)) {
      mark('crypto', 'component');
    }
  });

  if (/\bmatchMedia\b/.test(sourceText)) {
    mark('matchMedia', 'component');
  }
  if (/\bResizeObserver\b/.test(sourceText)) {
    mark('ResizeObserver', 'component');
  }
  if (/\bIntersectionObserver\b/.test(sourceText)) {
    mark('IntersectionObserver', 'component');
  }
  if (importModules.has('recharts')) {
    mark('matchMedia', 'import');
    mark('ResizeObserver', 'import');
    mark('canvas', 'import');
  }

  return [...required.values()];
}

function detectCentralSetupSupport(sourceFilePath: string): boolean {
  const packageRoot = detectPackageRoot(sourceFilePath);
  if (!packageRoot) return false;

  const candidates = [
    path.join(packageRoot, 'src', 'test-utils', 'setupTests.ts'),
    path.join(packageRoot, 'src', 'setupTests.ts'),
    path.join(packageRoot, 'setupTests.ts'),
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
}

function detectPackageRoot(sourceFilePath: string): string | null {
  const normalized = sourceFilePath.replace(/\\/g, '/');
  const sourceMarkers = ['/src/', '/app/', '/lib/', '/source/'];
  for (const marker of sourceMarkers) {
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) {
      return normalized.slice(0, index);
    }
  }
  return path.dirname(sourceFilePath);
}

function buildTopLevelSnippet(key: EnvironmentRequirementKey): string[] {
  switch (key) {
    case 'matchMedia':
      return [`Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: ${mockGlobalName()}.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: ${mockFn()},
    removeListener: ${mockFn()},
    addEventListener: ${mockFn()},
    removeEventListener: ${mockFn()},
    dispatchEvent: ${mockFn()},
  })),
});`];
    case 'ResizeObserver':
      return [`global.ResizeObserver = ${mockGlobalName()}.fn().mockImplementation(() => ({
  observe: ${mockFn()},
  unobserve: ${mockFn()},
  disconnect: ${mockFn()},
}));`];
    case 'IntersectionObserver':
      return [`global.IntersectionObserver = ${mockGlobalName()}.fn().mockImplementation(() => ({
  observe: ${mockFn()},
  unobserve: ${mockFn()},
  disconnect: ${mockFn()},
}));`];
    case 'scrollTo':
      return [`window.scrollTo = ${mockFn()};`];
    case 'print':
      return [`window.print = ${mockFn()};`];
    case 'canvas':
      return [`HTMLCanvasElement.prototype.getContext = ${mockGlobalName()}.fn().mockReturnValue({
  fillRect: ${mockFn()},
  clearRect: ${mockFn()},
  getImageData: ${mockGlobalName()}.fn(() => ({ data: new Array(4) })),
  putImageData: ${mockFn()},
  createImageData: ${mockGlobalName()}.fn(() => []),
  setTransform: ${mockFn()},
  drawImage: ${mockFn()},
  save: ${mockFn()},
  fillText: ${mockFn()},
  restore: ${mockFn()},
  beginPath: ${mockFn()},
  moveTo: ${mockFn()},
  lineTo: ${mockFn()},
  closePath: ${mockFn()},
  stroke: ${mockFn()},
  translate: ${mockFn()},
  scale: ${mockFn()},
  rotate: ${mockFn()},
  arc: ${mockFn()},
  fill: ${mockFn()},
  measureText: ${mockGlobalName()}.fn(() => ({ width: 0 })),
  transform: ${mockFn()},
  rect: ${mockFn()},
  clip: ${mockFn()},
});`];
    case 'fetch':
      return [`globalThis.fetch = ${mockGlobalName()}.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve(""), headers: new Headers() } as any);`];
    case 'crypto':
      return [`if (!globalThis.crypto?.randomUUID) { (globalThis as any).crypto = { ...globalThis.crypto, randomUUID: ${mockGlobalName()}.fn(() => "00000000-0000-4000-8000-000000000000") }; }`];
    case 'portal-root':
    default:
      return [];
  }
}

function buildBeforeEachLines(key: EnvironmentRequirementKey): string[] {
  switch (key) {
    case 'portal-root':
      return [
        'if (!document.getElementById("portal-root")) {',
        '  const portalRoot = document.createElement("div");',
        '  portalRoot.id = "portal-root";',
        '  document.body.appendChild(portalRoot);',
        '}',
      ];
    default:
      return [];
  }
}
