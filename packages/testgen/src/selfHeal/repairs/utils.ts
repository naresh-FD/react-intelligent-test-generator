import { ProviderWrapperDescriptor, RepairPatchOperation } from '../types';

interface WrapperSnippet {
  opening: string;
  closing: string;
}

export function insertStatementAfterImports(content: string, statement: string): string {
  if (content.includes(statement)) {
    return content;
  }

  const importMatches = [...content.matchAll(/^import .*;$/gm)];
  if (importMatches.length === 0) {
    return `${statement}\n${content}`;
  }

  const lastImport = importMatches[importMatches.length - 1];
  const insertIndex = (lastImport.index ?? 0) + lastImport[0].length;
  return `${content.slice(0, insertIndex)}\n${statement}${content.slice(insertIndex)}`;
}

export function insertSetupSnippet(content: string, snippet: string): string {
  if (content.includes(snippet)) {
    return content;
  }

  const importMatches = [...content.matchAll(/^import .*;$/gm)];
  const insertIndex = importMatches.length > 0
    ? (importMatches[importMatches.length - 1].index ?? 0) + importMatches[importMatches.length - 1][0].length
    : 0;
  const prefix = insertIndex === 0 ? '' : '\n';
  return `${content.slice(0, insertIndex)}${prefix}\n${snippet}\n${content.slice(insertIndex)}`;
}

export function wrapFirstRenderArgument(content: string, wrappers: WrapperSnippet[]): string | null {
  const renderIndex = content.indexOf('render(');
  if (renderIndex === -1) {
    return null;
  }

  const argsStart = renderIndex + 'render('.length;
  const argsEnd = findMatchingParen(content, argsStart - 1);
  if (argsEnd === -1) {
    return null;
  }

  const argument = content.slice(argsStart, argsEnd).trim();
  const wrappedArgument = wrappers.reduceRight(
    (inner, wrapper) => `${wrapper.opening}${inner}${wrapper.closing}`,
    argument,
  );

  return `${content.slice(0, argsStart)}${wrappedArgument}${content.slice(argsEnd)}`;
}

export function createWrapperSnippets(providers: ProviderWrapperDescriptor[]): WrapperSnippet[] {
  return providers.map((provider) => {
    const props = provider.wrapperProps ? ` ${provider.wrapperProps}` : '';
    return {
      opening: `<${provider.wrapperName}${props}>`,
      closing: `</${provider.wrapperName}>`,
    };
  });
}

export function normalizeRelativeImportSpecifiers(content: string): string {
  return content.replace(
    /((?:import|export)\s[\s\S]*?\sfrom\s+|jest\.mock\(\s*|vi\.mock\(\s*)(['"])(\.[^'"]+)(\2)/g,
    (match, prefix: string, quote: string, specifier: string, suffix: string) => {
      const normalized = specifier
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/\.\//g, '/')
        .replace(/(^|\/)\.(?=\/)/g, '$1');

      if (normalized === specifier) {
        return match;
      }

      return `${prefix}${quote}${normalized}${suffix}`;
    },
  );
}

export function applyStringReplacements(
  content: string,
  replacements: Array<{ from: string; to: string }>,
): { content: string; applied: boolean; operations: RepairPatchOperation[] } {
  let updatedContent = content;
  const operations: RepairPatchOperation[] = [];

  for (const replacement of replacements) {
    if (!updatedContent.includes(replacement.from)) {
      continue;
    }

    updatedContent = updatedContent.replace(replacement.from, replacement.to);
    operations.push({
      type: 'replace-text',
      description: `Replace ${replacement.from} with a deterministic alternative`,
      before: replacement.from,
      after: replacement.to,
    });
  }

  return {
    content: updatedContent,
    applied: operations.length > 0,
    operations,
  };
}

export function upgradeFirstScreenQueryToFindBy(content: string): string | null {
  const match = content.match(/(screen|within\([^)]*\))\.getBy([A-Z][A-Za-z0-9_]*)\(/);
  if (!match) {
    return null;
  }

  const target = `${match[1]}.getBy${match[2]}(`;
  const replacement = `await ${match[1]}.findBy${match[2]}(`;
  return content.replace(target, replacement);
}

export function ensureAsyncTestCallback(content: string): string {
  if (/\b(it|test)\([^,]+,\s*async\s*\(/.test(content)) {
    return content;
  }

  return content
    .replace(/\b(it|test)\(([^,]+),\s*\(\s*\)\s*=>/, '$1($2, async () =>')
    .replace(/\b(it|test)\(([^,]+),\s*function\s*\(\s*\)/, '$1($2, async function()');
}

function findMatchingParen(content: string, openParenIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let index = openParenIndex; index < content.length; index += 1) {
    const character = content[index];
    const previousCharacter = index > 0 ? content[index - 1] : '';

    if (quote) {
      if (character === quote && previousCharacter !== '\\') {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
