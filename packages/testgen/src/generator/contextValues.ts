/**
 * Context Value Factory — generates deterministic mock values for React Context
 * shapes used by components. Three-tier resolution:
 *
 * Tier 1: Parse createContext() default value from the context source file
 * Tier 2: Extract TypeScript interface/type and generate mocks per property
 * Tier 3: Use consumed keys from ContextUsage as a fallback
 */
import { Node, Project, SourceFile, SyntaxKind, TypeChecker } from 'ts-morph';
import { ContextUsage } from '../analyzer';
import { mockFn } from '../utils/framework';

export interface ContextMockValue {
  /** The context object name to import (e.g., "AuthContext") */
  importName: string;
  /** Import path for the context */
  importPath: string;
  /** The full variable declaration for the mock (e.g., "const mockAuthValue = {...}") */
  mockDeclaration: string;
  /** The variable name holding the mock (e.g., "mockAuthValue") */
  mockVarName: string;
}

/**
 * Generate a deterministic mock value for a context usage.
 */
export function generateContextMockValue(
  context: ContextUsage,
  project: Project,
  checker: TypeChecker
): ContextMockValue | null {
  const contextName = context.contextName;
  const importPath = context.importPath ?? context.hookImportPath;
  if (!importPath) return null;

  const mockVarName = buildMockVarName(contextName);

  // Tier 1: Try to parse createContext() default value
  const contextSourceFile = resolveContextSourceFile(importPath, project);
  if (contextSourceFile) {
    const tier1 = extractCreateContextDefault(contextSourceFile, contextName, checker);
    if (tier1 && Object.keys(tier1).length > 0) {
      const declaration = buildMockDeclaration(mockVarName, tier1);
      return { importName: contextName, importPath, mockDeclaration: declaration, mockVarName };
    }

    // Tier 2: Extract from TypeScript type parameter
    const tier2 = extractContextTypeShape(contextSourceFile, contextName, checker);
    if (tier2 && Object.keys(tier2).length > 0) {
      const declaration = buildMockDeclaration(mockVarName, tier2);
      return { importName: contextName, importPath, mockDeclaration: declaration, mockVarName };
    }
  }

  // Tier 3: Fallback to consumed keys
  if (context.consumedKeys.length > 0) {
    const tier3 = generateMockFromConsumedKeys(context.consumedKeys);
    const declaration = buildMockDeclaration(mockVarName, tier3);
    return { importName: contextName, importPath, mockDeclaration: declaration, mockVarName };
  }

  // If no information is available, generate a minimal mock object
  const declaration = `const ${mockVarName} = {} as any;`;
  return { importName: contextName, importPath, mockDeclaration: declaration, mockVarName };
}

// ---------------------------------------------------------------------------
// Tier 1: Parse createContext() default value
// ---------------------------------------------------------------------------

function extractCreateContextDefault(
  sourceFile: SourceFile,
  contextName: string,
  _checker: TypeChecker
): Record<string, string> | null {
  // Find: const XxxContext = createContext(...) or React.createContext(...)
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const exprText = call.getExpression().getText();
    if (exprText !== 'createContext' && exprText !== 'React.createContext') continue;

    // Check if this createContext is assigned to the right variable
    const parent = call.getParent();
    if (!parent || !Node.isVariableDeclaration(parent)) continue;
    const varName = parent.getName();
    if (contextName && varName !== contextName) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const defaultArg = args[0];
    // Skip undefined, null, {} defaults
    const defaultText = defaultArg.getText().trim();
    if (defaultText === 'undefined' || defaultText === 'null' || defaultText === '{}') continue;

    // If the default is an object literal, extract its shape
    if (Node.isObjectLiteralExpression(defaultArg)) {
      return extractObjectLiteralShape(defaultArg);
    }
  }

  return null;
}

function extractObjectLiteralShape(objLiteral: Node): Record<string, string> {
  const shape: Record<string, string> = {};
  if (!Node.isObjectLiteralExpression(objLiteral)) return shape;

  for (const prop of objLiteral.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      const init = prop.getInitializer();
      if (init) {
        shape[name] = init.getText();
      }
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      shape[name] = mockValueForKeyName(name);
    }
  }

  return shape;
}

// ---------------------------------------------------------------------------
// Tier 2: Extract from TypeScript type parameter
// ---------------------------------------------------------------------------

function extractContextTypeShape(
  sourceFile: SourceFile,
  contextName: string,
  checker: TypeChecker
): Record<string, string> | null {
  // Find: createContext<TypeParam>(...) or createContext<TypeParam | undefined>(...)
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const exprText = call.getExpression().getText();
    if (exprText !== 'createContext' && exprText !== 'React.createContext') continue;

    // Check if this is the right context
    const parent = call.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      if (contextName && parent.getName() !== contextName) continue;
    }

    // Get the type arguments: createContext<AuthContextType>(...)
    const typeArgs = call.getTypeArguments();
    if (typeArgs.length === 0) continue;

    const typeNode = typeArgs[0];
    const type = checker.getTypeAtLocation(typeNode);

    // Strip | undefined from union types
    const properties = type.getProperties();
    if (properties.length === 0) {
      // Check if it's a union type containing an object type
      if (type.isUnion()) {
        for (const unionType of type.getUnionTypes()) {
          const unionProps = unionType.getProperties();
          if (unionProps.length > 0) {
            return extractPropertiesAsShape(unionProps, typeNode, checker);
          }
        }
      }
      continue;
    }

    return extractPropertiesAsShape(properties, typeNode, checker);
  }

  return null;
}

function extractPropertiesAsShape(
  properties: ReturnType<ReturnType<TypeChecker['getTypeAtLocation']>['getProperties']>,
  locationNode: Node,
  checker: TypeChecker
): Record<string, string> {
  const shape: Record<string, string> = {};

  for (const prop of properties) {
    const name = prop.getName();
    const declarations = prop.getDeclarations();
    const declaration = declarations.length > 0 ? declarations[0] : null;
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? locationNode);
    const typeText = checker.getTypeText(propType, declaration ?? locationNode);

    shape[name] = mockValueForTypeAndName(name, typeText);
  }

  return shape;
}

// ---------------------------------------------------------------------------
// Tier 3: Consumed-keys fallback
// ---------------------------------------------------------------------------

function generateMockFromConsumedKeys(keys: string[]): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const key of keys) {
    shape[key] = mockValueForKeyName(key);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Mock value generation (reuses patterns from mocks.ts)
// ---------------------------------------------------------------------------

/**
 * Generate a mock value for a property given its name and TS type text.
 * This is the core heuristic engine — same patterns as mockValueForProp in mocks.ts
 * but decoupled from the PropInfo interface.
 */
function mockValueForTypeAndName(name: string, typeText: string): string {
  const type = typeText.toLowerCase();

  // Callback/handler patterns
  if (
    /^(on|handle|set|update|change|toggle|add|remove|delete|clear|fetch|load|save|login|logout|register|create|edit|submit|dispatch|notify|reset)[A-Z]/.test(name) ||
    /^render$/i.test(name)
  ) {
    return mockFn();
  }

  // Function types
  if (typeText.includes('=>') || type.includes('function')) return mockFn();

  // Dispatch functions (React useReducer pattern)
  if (/dispatch/i.test(name) || /^React\.Dispatch/.test(typeText)) return mockFn();

  // Boolean-named values
  if (
    /^(is|has|show|can|should|was|did|will|needs)[A-Z_]/.test(name) ||
    /^(loading|pending|fetching|submitting|processing|busy|disabled|readonly|active|open|visible|checked|selected|expanded|hidden|authenticated|error|failed|invalid|locked|enabled|ready|connected|initialized|mounted|dirty|pristine|touched|untouched|valid)$/i.test(name)
  ) {
    if (type === 'boolean' || type === 'true' || type === 'false') return 'false';
    if (!typeText.includes('=>')) return 'false';
  }

  // Boolean type
  if (type === 'boolean') return 'false';

  // Null/undefined in union
  if (type.includes('null') && !typeText.includes('=>')) return 'null';

  // Array types
  if (type.includes('[]') || /^array</i.test(type) || /^readonly\s/.test(type)) return '[]';

  // String types
  if (type === 'string' || type.includes('string')) return mockStringByName(name);

  // Number types
  if (type === 'number') return mockNumberByName(name);

  // Date type
  if (typeText.trim() === 'Date') return 'new Date("2024-01-01")';

  // Object/Record types
  if (type.includes('{') || type.includes('object') || /^record</.test(type)) return '{}';

  // Enum/union literal types
  if (typeText.includes('|') && !typeText.includes('=>')) {
    const quotedMatch = typeText.match(/'([^']+)'/);
    if (quotedMatch) return `'${quotedMatch[1]}'`;
    const doubleQuotedMatch = typeText.match(/"([^"]+)"/);
    if (doubleQuotedMatch) return `"${doubleQuotedMatch[1]}"`;
  }

  // Name-based fallback for unresolved types
  return mockValueForKeyName(name);
}

/**
 * Generate a mock value based only on the key name (no type info).
 * Used for Tier 3 (consumed-keys fallback) and shorthand property assignments.
 */
function mockValueForKeyName(name: string): string {
  // Function-like names
  if (
    /^(on|handle|set|update|change|toggle|add|remove|delete|clear|fetch|load|save|login|logout|register|create|edit|submit|dispatch|notify|reset)[A-Z]/.test(name)
  ) {
    return mockFn();
  }

  // Boolean-like names
  if (
    /^(is|has|show|can|should|was|did|will|needs)[A-Z_]/.test(name) ||
    /^(loading|pending|fetching|submitting|processing|busy|disabled|readonly|active|open|visible|checked|selected|expanded|hidden|authenticated|error|failed|invalid|locked|enabled|ready|connected|initialized)$/i.test(name)
  ) {
    return 'false';
  }

  // Null-like names (often nullable domain objects)
  if (/^(user|currentUser|profile|session|token|account)$/i.test(name)) return 'null';

  // Error-like
  if (/^error$/i.test(name) || /^errorMessage$/i.test(name)) return 'null';

  // ID/identifier
  if (/id$/i.test(name)) return '"test-id"';
  if (/name$/i.test(name)) return '"Test Name"';
  if (/email$/i.test(name)) return '"test@example.com"';
  if (/title$/i.test(name)) return '"Test Title"';
  if (/description$/i.test(name) || /message$/i.test(name) || /text$/i.test(name)) return '"Test text"';
  if (/url$/i.test(name) || /link$/i.test(name) || /href$/i.test(name)) return '"https://example.com"';
  if (/color$/i.test(name)) return '"#000000"';
  if (/^theme$/i.test(name)) return '"light"';
  if (/^locale$/i.test(name) || /^language$/i.test(name)) return '"en"';

  // Numeric names
  if (/count$/i.test(name) || /total$/i.test(name) || /index$/i.test(name)) return '0';
  if (/amount$/i.test(name) || /price$/i.test(name) || /value$/i.test(name)) return '0';

  // Array-like names
  if (/^(items|data|list|rows|results|records|entries|expenses|budgets|categories|transactions|notifications|messages|users)$/i.test(name)) {
    return '[]';
  }

  // Fallback: function if name starts with action verb, otherwise empty object
  if (/^(get|set|post|put|patch|delete|fetch|load|save|send|emit|trigger|fire)[A-Z]/.test(name)) {
    return mockFn();
  }

  return '{}';
}

function mockStringByName(name: string): string {
  if (/title/i.test(name)) return '"Test Title"';
  if (/name/i.test(name)) return '"Test Name"';
  if (/email/i.test(name)) return '"test@example.com"';
  if (/url/i.test(name) || /link/i.test(name) || /href/i.test(name)) return '"https://example.com"';
  if (/description/i.test(name) || /message/i.test(name)) return '"Test description"';
  if (/label/i.test(name)) return '"Test Label"';
  if (/color/i.test(name)) return '"#000000"';
  if (/theme/i.test(name)) return '"light"';
  if (/locale/i.test(name) || /language/i.test(name)) return '"en"';
  if (/id$/i.test(name)) return '"test-id"';
  if (/token/i.test(name)) return '"test-token"';
  return '"test-value"';
}

function mockNumberByName(name: string): string {
  if (/count/i.test(name) || /total/i.test(name) || /index/i.test(name)) return '0';
  if (/amount/i.test(name) || /price/i.test(name) || /value/i.test(name)) return '100';
  if (/page/i.test(name)) return '1';
  if (/size/i.test(name) || /limit/i.test(name)) return '10';
  return '0';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a variable name for the mock: AuthContext -> mockAuthValue */
function buildMockVarName(contextName: string): string {
  const base = contextName.replace(/Context$/, '');
  return `mock${base}Value`;
}

/** Build the full const declaration from a shape record */
function buildMockDeclaration(varName: string, shape: Record<string, string>): string {
  const entries = Object.entries(shape)
    .map(([key, value]) => `  ${safePropKey(key)}: ${value}`)
    .join(',\n');
  return `const ${varName} = {\n${entries},\n};`;
}

/** Safely quote object keys that are not valid identifiers */
function safePropKey(key: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return key;
  return `'${key}'`;
}

/** Try to resolve the source file for a context import */
function resolveContextSourceFile(
  importPath: string,
  project: Project
): SourceFile | null {
  // Only follow local imports
  if (
    !importPath.startsWith('.') &&
    !importPath.startsWith('@/') &&
    !importPath.startsWith('~/')
  ) {
    return null;
  }

  // Search all source files in the project for a matching path
  const allFiles = project.getSourceFiles();
  const normalizedImport = importPath.replace(/^[@~]\//, '').replace(/\\/g, '/');

  for (const sf of allFiles) {
    const filePath = sf.getFilePath().replace(/\\/g, '/');
    // Match by suffix: the import path should be the tail of the file path
    const withoutExt = filePath.replace(/\.(tsx?|jsx?)$/, '');
    if (withoutExt.endsWith(normalizedImport) || withoutExt.endsWith(`/${normalizedImport}`)) {
      return sf;
    }
    // Also check the full path including extension
    if (filePath.endsWith(normalizedImport) || filePath.endsWith(`/${normalizedImport}`)) {
      return sf;
    }
  }

  return null;
}
