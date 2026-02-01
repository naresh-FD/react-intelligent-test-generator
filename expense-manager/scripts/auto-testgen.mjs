#!/usr/bin/env node
/**
 * Auto Test Generator - Generates Jest + React Testing Library tests
 *
 * Usage:
 *   node scripts/auto-testgen.mjs watch [--coverage]       - Watch mode (only process add/change events)
 *   node scripts/auto-testgen.mjs all [--coverage]         - Process all source files
 *   node scripts/auto-testgen.mjs file <path> [--coverage] - Process a single file
 *   node scripts/auto-testgen.mjs git-unstaged [--coverage] - Process only git unstaged files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');

// Header to identify generated tests
const GENERATED_HEADER = '/** @generated AUTO-GENERATED FILE - safe to overwrite */';

// Lazy load dependencies to avoid errors if not installed
let babelParser;
let babelTraverse;
let Project;
let chokidar;
let prettier;

async function loadDependencies() {
  try {
    const parserModule = await import('@babel/parser');
    babelParser = parserModule.default || parserModule;

    const traverseModule = await import('@babel/traverse');
    babelTraverse = traverseModule.default || traverseModule;

    const tsMorphModule = await import('ts-morph');
    Project = tsMorphModule.Project;

    const chokidarModule = await import('chokidar');
    chokidar = chokidarModule.default || chokidarModule;
  } catch (err) {
    console.error('Missing required dependencies. Please install:');
    console.error('  npm install --save-dev @babel/parser @babel/traverse ts-morph chokidar');
    process.exit(1);
  }

  try {
    const prettierModule = await import('prettier');
    prettier = prettierModule.default || prettierModule;
  } catch {
    prettier = null;
    console.warn('Prettier not found. Output will not be formatted.');
  }
}

// TypeScript project for type extraction
let tsProject = null;

function getTsProject() {
  if (!tsProject) {
    const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      tsProject = new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: true,
      });
    } else {
      tsProject = new Project({
        compilerOptions: {
          jsx: 2, // React
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      });
    }
  }
  return tsProject;
}

/**
 * Compute relative import path from test file to source file (without extension)
 */
function relativeImport(fromFile, toFile) {
  const fromDir = path.dirname(fromFile);
  let relativePath = path.relative(fromDir, toFile);

  // Convert backslashes to forward slashes (Windows compatibility)
  relativePath = relativePath.replace(/\\/g, '/');

  // Remove file extension
  relativePath = relativePath.replace(/\.(tsx?|jsx?)$/, '');

  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
    relativePath = './' + relativePath;
  }

  return relativePath;
}

/**
 * Get the test file path for a source file
 */
function getTestFilePath(sourceFilePath) {
  const dir = path.dirname(sourceFilePath);
  const ext = path.extname(sourceFilePath);
  const baseName = path.basename(sourceFilePath, ext);

  // Determine test extension (keep tsx for tsx/jsx, ts for ts/js)
  const testExt = ['.tsx', '.jsx'].includes(ext) ? '.tsx' : '.ts';

  return path.join(dir, '__tests__', `${baseName}.test${testExt}`);
}

/**
 * Check if a test file is manually written (not auto-generated)
 */
function isManualTest(testFilePath) {
  if (!fs.existsSync(testFilePath)) {
    return false;
  }

  const content = fs.readFileSync(testFilePath, 'utf-8');
  return !content.includes(GENERATED_HEADER);
}

/**
 * Parse source file with Babel and extract exports
 */
function extractExports(sourceCode, filePath) {
  const ext = path.extname(filePath);
  const isTypeScript = ['.ts', '.tsx'].includes(ext);
  const isJsx = ['.tsx', '.jsx'].includes(ext);

  const ast = babelParser.parse(sourceCode, {
    sourceType: 'module',
    plugins: [
      isJsx ? 'jsx' : null,
      isTypeScript ? 'typescript' : null,
      'decorators-legacy',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'dynamicImport',
      'optionalChaining',
      'nullishCoalescingOperator',
    ].filter(Boolean),
  });

  const exports = {
    defaultExport: null,
    namedExports: [],
  };

  // Track which identifiers are types/interfaces
  const typeIdentifiers = new Set();

  // First pass: collect type/interface declarations
  babelTraverse.default(ast, {
    TSTypeAliasDeclaration(nodePath) {
      if (nodePath.node.id?.name) {
        typeIdentifiers.add(nodePath.node.id.name);
      }
    },
    TSInterfaceDeclaration(nodePath) {
      if (nodePath.node.id?.name) {
        typeIdentifiers.add(nodePath.node.id.name);
      }
    },
  });

  // Second pass: extract exports
  babelTraverse.default(ast, {
    ExportDefaultDeclaration(nodePath) {
      const decl = nodePath.node.declaration;

      if (decl.type === 'Identifier') {
        exports.defaultExport = { name: decl.name, type: 'identifier' };
      } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ArrowFunctionExpression') {
        const name = decl.id?.name || 'default';
        exports.defaultExport = { name, type: 'function', isComponent: isLikelyComponent(name, decl, sourceCode) };
      } else if (decl.type === 'ClassDeclaration') {
        const name = decl.id?.name || 'default';
        exports.defaultExport = { name, type: 'class', isComponent: isLikelyComponent(name, decl, sourceCode) };
      } else if (decl.type === 'CallExpression') {
        // e.g., export default forwardRef(...)
        exports.defaultExport = { name: 'default', type: 'component', isComponent: true };
      } else {
        exports.defaultExport = { name: 'default', type: 'unknown' };
      }
    },

    ExportNamedDeclaration(nodePath) {
      const node = nodePath.node;

      // Handle: export { A, B, C }
      if (node.specifiers && node.specifiers.length > 0) {
        for (const spec of node.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            const exportedName = spec.exported?.name || spec.local?.name;
            if (exportedName && !isTypeExport(exportedName, typeIdentifiers)) {
              exports.namedExports.push({
                name: exportedName,
                type: 'specifier',
                isComponent: isLikelyComponentByName(exportedName),
              });
            }
          }
        }
        return;
      }

      // Handle: export const/let/var
      if (node.declaration) {
        const decl = node.declaration;

        // export type ... / export interface ... (skip)
        if (decl.type === 'TSTypeAliasDeclaration' || decl.type === 'TSInterfaceDeclaration') {
          return;
        }

        if (decl.type === 'VariableDeclaration') {
          for (const varDecl of decl.declarations) {
            if (varDecl.id?.type === 'Identifier') {
              const name = varDecl.id.name;
              if (!isTypeExport(name, typeIdentifiers)) {
                const init = varDecl.init;
                const isFunc = init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression';
                const isComp = isLikelyComponent(name, init, sourceCode);
                exports.namedExports.push({
                  name,
                  type: isFunc ? 'function' : 'variable',
                  isComponent: isComp,
                });
              }
            }
          }
        } else if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
          const name = decl.id.name;
          if (!isTypeExport(name, typeIdentifiers)) {
            exports.namedExports.push({
              name,
              type: 'function',
              isComponent: isLikelyComponent(name, decl, sourceCode),
            });
          }
        } else if (decl.type === 'ClassDeclaration' && decl.id?.name) {
          const name = decl.id.name;
          if (!isTypeExport(name, typeIdentifiers)) {
            exports.namedExports.push({
              name,
              type: 'class',
              isComponent: isLikelyComponent(name, decl, sourceCode),
            });
          }
        }
      }
    },
  });

  return exports;
}

/**
 * Check if an export name is a type export (interfaces, types, Props, Context suffixes)
 */
function isTypeExport(name, typeIdentifiers) {
  if (typeIdentifiers.has(name)) return true;

  // Filter out common type export patterns
  const typePatterns = [
    /Props$/,
    /Context$/,
    /Type$/,
    /Interface$/,
    /^I[A-Z]/, // IUser, IConfig, etc.
  ];

  return typePatterns.some(pattern => pattern.test(name));
}

/**
 * Check if an identifier is likely a React component by name convention
 */
function isLikelyComponentByName(name) {
  // Components typically start with uppercase letter
  return /^[A-Z]/.test(name);
}

/**
 * Check if a declaration is likely a React component
 */
function isLikelyComponent(name, declaration, sourceCode) {
  // Check if name starts with uppercase (React convention)
  if (!isLikelyComponentByName(name)) return false;

  // Check if source contains JSX
  if (sourceCode.includes('<') && (sourceCode.includes('/>') || sourceCode.includes('</'))) {
    return true;
  }

  // Check if it uses forwardRef, memo, etc.
  if (sourceCode.includes('forwardRef') || sourceCode.includes('memo(') || sourceCode.includes('React.memo')) {
    return true;
  }

  return false;
}

/**
 * Extract required props from a component using ts-morph
 */
function extractRequiredProps(sourceFilePath, componentName) {
  try {
    const project = getTsProject();
    const sourceFile = project.addSourceFileAtPath(sourceFilePath);

    // Look for Props interface or type
    const propsInterface = sourceFile.getInterface(`${componentName}Props`)
      || sourceFile.getTypeAlias(`${componentName}Props`);

    if (propsInterface) {
      const properties = propsInterface.getProperties?.() || [];
      const requiredProps = [];

      for (const prop of properties) {
        if (!prop.hasQuestionToken?.()) {
          const name = prop.getName();
          const type = prop.getType().getText();
          requiredProps.push({ name, type });
        }
      }

      return requiredProps;
    }

    // Try to find the component and infer props from parameters
    const functionDecl = sourceFile.getFunction(componentName);
    if (functionDecl) {
      const params = functionDecl.getParameters();
      if (params.length > 0) {
        const propsParam = params[0];
        const propsType = propsParam.getType();
        const properties = propsType.getProperties();
        const requiredProps = [];

        for (const prop of properties) {
          const declarations = prop.getDeclarations();
          const isOptional = declarations.some(d => d.hasQuestionToken?.());
          if (!isOptional) {
            requiredProps.push({
              name: prop.getName(),
              type: prop.getValueDeclaration()?.getType()?.getText() || 'unknown',
            });
          }
        }

        return requiredProps;
      }
    }

    return [];
  } catch (err) {
    // Type extraction failed, return empty
    return [];
  }
}

/**
 * Generate a placeholder value for a TypeScript type
 */
function getPlaceholderForType(typeName) {
  const type = typeName.toLowerCase();

  if (type === 'string') return '"TODO"';
  if (type === 'number') return '0';
  if (type === 'boolean') return 'false';
  if (type.includes('[]') || type.includes('array')) return '[]';
  if (type.includes('function') || type.includes('=>')) return '() => { /* TODO */ }';
  if (type === 'reactnode') return 'null';

  return 'undefined /* TODO */';
}

/**
 * Generate test content for a component
 */
function generateComponentTest(sourceFilePath, testFilePath, exports) {
  const moduleName = path.basename(sourceFilePath, path.extname(sourceFilePath));
  const moduleImport = relativeImport(testFilePath, sourceFilePath);

  // Calculate renderWithProviders import path
  const renderWithProvidersPath = path.join(SRC_DIR, 'test-utils', 'renderWithProviders');
  const renderWithProvidersImport = relativeImport(testFilePath, renderWithProvidersPath);

  // Collect all component exports
  const componentExports = [];
  if (exports.defaultExport?.isComponent) {
    componentExports.push({ ...exports.defaultExport, isDefault: true });
  }
  for (const exp of exports.namedExports) {
    if (exp.isComponent) {
      componentExports.push({ ...exp, isDefault: false });
    }
  }

  // If no component exports, fall back to utility test generation
  if (componentExports.length === 0) {
    return generateUtilityTest(sourceFilePath, testFilePath, exports);
  }

  // Build imports
  const importNames = [];
  let hasDefault = false;

  for (const comp of componentExports) {
    if (comp.isDefault) {
      hasDefault = true;
    } else {
      importNames.push(comp.name);
    }
  }

  let importStatement;
  if (hasDefault && importNames.length > 0) {
    const defaultName = exports.defaultExport?.name || moduleName;
    importStatement = `import ${defaultName}, { ${importNames.join(', ')} } from "${moduleImport}";`;
  } else if (hasDefault) {
    const defaultName = exports.defaultExport?.name || moduleName;
    importStatement = `import ${defaultName} from "${moduleImport}";`;
  } else {
    importStatement = `import { ${importNames.join(', ')} } from "${moduleImport}";`;
  }

  // Generate test code
  let testCode = `${GENERATED_HEADER}
import * as React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "${renderWithProvidersImport}";
${importStatement}

`;

  for (const comp of componentExports) {
    const compName = comp.isDefault
      ? (exports.defaultExport?.name || moduleName)
      : comp.name;

    // Try to extract required props
    const requiredProps = extractRequiredProps(sourceFilePath, compName);

    let propsCode = '';
    if (requiredProps.length > 0) {
      const propEntries = requiredProps.map(p => `    ${p.name}: ${getPlaceholderForType(p.type)},`);
      propsCode = `  const defaultProps = {\n${propEntries.join('\n')}\n  };\n\n`;
    } else {
      propsCode = `  // TODO: Add required props\n  const defaultProps = {};\n\n`;
    }

    testCode += `describe("${compName}", () => {
${propsCode}  // ============ Rendering ============
  describe("Rendering", () => {
    it("renders without crashing", () => {
      renderWithProviders(<${compName} {...defaultProps} />);
    });

    it("renders with default props", () => {
      const { container } = renderWithProviders(<${compName} {...defaultProps} />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  // ============ Snapshot ============
  describe("Snapshot", () => {
    it("matches snapshot", () => {
      const { container } = renderWithProviders(<${compName} {...defaultProps} />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ============ Props ============
  describe("Props", () => {
    it("applies custom className", () => {
      // TODO: Implement if component accepts className prop
      expect(true).toBe(true);
    });

    it("handles optional props correctly", () => {
      // TODO: Test optional prop combinations
      expect(true).toBe(true);
    });
  });

  // ============ User Interactions ============
  describe("User Interactions", () => {
    it("handles click events", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${compName} {...defaultProps} />);

      // TODO: Add click interaction tests
      // Example:
      // const button = screen.getByRole("button");
      // await user.click(button);
      // expect(mockHandler).toHaveBeenCalled();
    });

    it("handles input changes", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${compName} {...defaultProps} />);

      // TODO: Add input interaction tests
      // Example:
      // const input = screen.getByRole("textbox");
      // await user.type(input, "test");
      // expect(input).toHaveValue("test");
    });
  });

  // ============ Accessibility ============
  describe("Accessibility", () => {
    it("has no accessibility violations", async () => {
      // TODO: Add axe-core tests if available
      // const { container } = renderWithProviders(<${compName} {...defaultProps} />);
      // const results = await axe(container);
      // expect(results).toHaveNoViolations();
      expect(true).toBe(true);
    });

    it("has proper ARIA attributes", () => {
      renderWithProviders(<${compName} {...defaultProps} />);

      // TODO: Check for proper ARIA labels
      // Example:
      // expect(screen.getByRole("button")).toHaveAttribute("aria-label");
    });

    it("is keyboard navigable", async () => {
      const user = userEvent.setup();
      renderWithProviders(<${compName} {...defaultProps} />);

      // TODO: Test keyboard navigation
      // Example:
      // await user.tab();
      // expect(screen.getByRole("button")).toHaveFocus();
    });
  });
});

`;
  }

  return testCode.trim() + '\n';
}

/**
 * Generate test content for utility functions
 */
function generateUtilityTest(sourceFilePath, testFilePath, exports) {
  const moduleName = path.basename(sourceFilePath, path.extname(sourceFilePath));
  const moduleImport = relativeImport(testFilePath, sourceFilePath);

  // Collect all exports that are not components
  const utilExports = [];
  if (exports.defaultExport && !exports.defaultExport.isComponent) {
    utilExports.push({ ...exports.defaultExport, isDefault: true });
  }
  for (const exp of exports.namedExports) {
    if (!exp.isComponent) {
      utilExports.push({ ...exp, isDefault: false });
    }
  }

  if (utilExports.length === 0) {
    return null; // Nothing to test
  }

  // Build import statement
  const namedExports = utilExports.filter(e => !e.isDefault).map(e => e.name);
  const defaultExport = utilExports.find(e => e.isDefault);

  let importStatement;
  if (defaultExport && namedExports.length > 0) {
    importStatement = `import ${defaultExport.name}, { ${namedExports.join(', ')} } from "${moduleImport}";`;
  } else if (defaultExport) {
    importStatement = `import ${defaultExport.name} from "${moduleImport}";`;
  } else if (namedExports.length > 0) {
    importStatement = `import { ${namedExports.join(', ')} } from "${moduleImport}";`;
  } else {
    importStatement = `import * as ${moduleName} from "${moduleImport}";`;
  }

  let testCode = `${GENERATED_HEADER}
${importStatement}

describe("${moduleName}", () => {
`;

  for (const exp of utilExports) {
    const expName = exp.name || 'default';
    const isFunction = exp.type === 'function';

    testCode += `  describe("${expName}", () => {
    it("is defined", () => {
      expect(${expName}).toBeDefined();
    });

`;

    if (isFunction) {
      testCode += `    it("handles valid input", () => {
      // TODO: Add test for valid input
      // Example:
      // const result = ${expName}(validInput);
      // expect(result).toEqual(expectedOutput);
    });

    it("handles edge cases", () => {
      // TODO: Add edge case tests
    });

    it("handles invalid input", () => {
      // TODO: Add invalid input tests
      // Example:
      // expect(() => ${expName}(invalidInput)).toThrow();
    });
`;
    } else {
      testCode += `    it("has expected value", () => {
      // TODO: Verify the value
      // expect(${expName}).toEqual(expectedValue);
    });
`;
    }

    testCode += `  });

`;
  }

  testCode += `});
`;

  return testCode;
}

/**
 * Format code with Prettier if available
 */
async function formatWithPrettier(code, filePath) {
  if (!prettier) return code;

  try {
    // Try to load project's prettier config
    const options = await prettier.resolveConfig(filePath);
    return await prettier.format(code, {
      ...options,
      filepath: filePath,
      parser: 'typescript',
    });
  } catch (err) {
    console.warn(`Prettier formatting failed for ${filePath}: ${err.message}`);
    return code;
  }
}

/**
 * Process a single source file
 */
async function processFile(sourceFilePath) {
  const absolutePath = path.isAbsolute(sourceFilePath)
    ? sourceFilePath
    : path.resolve(process.cwd(), sourceFilePath);

  // Skip non-source files
  const ext = path.extname(absolutePath);
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    return { skipped: true, reason: 'not a source file' };
  }

  // Skip files in __tests__ directories
  if (absolutePath.includes('__tests__')) {
    return { skipped: true, reason: 'test file' };
  }

  // Skip test files
  if (absolutePath.includes('.test.') || absolutePath.includes('.spec.')) {
    return { skipped: true, reason: 'test file' };
  }

  // Skip index files (typically just re-exports)
  const baseName = path.basename(absolutePath, ext);
  if (baseName === 'index') {
    return { skipped: true, reason: 'index file' };
  }

  const testFilePath = getTestFilePath(absolutePath);

  // Check if manual test exists
  if (isManualTest(testFilePath)) {
    console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} - manual test exists`);
    return { skipped: true, reason: 'manual test exists' };
  }

  // Read source file
  let sourceCode;
  try {
    sourceCode = fs.readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    console.error(`❌ Failed to read ${absolutePath}: ${err.message}`);
    return { error: err.message };
  }

  // Extract exports
  let exports;
  try {
    exports = extractExports(sourceCode, absolutePath);
  } catch (err) {
    console.error(`❌ Failed to parse ${absolutePath}: ${err.message}`);
    return { error: err.message };
  }

  // Skip if no exports
  if (!exports.defaultExport && exports.namedExports.length === 0) {
    console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} - no exports found`);
    return { skipped: true, reason: 'no exports' };
  }

  // Check if this is a component file or utility file
  const hasComponentExports = exports.defaultExport?.isComponent ||
    exports.namedExports.some(e => e.isComponent);

  // Generate test content
  let testContent;
  if (hasComponentExports) {
    testContent = generateComponentTest(absolutePath, testFilePath, exports);
  } else {
    testContent = generateUtilityTest(absolutePath, testFilePath, exports);
  }

  if (!testContent) {
    console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} - no testable exports`);
    return { skipped: true, reason: 'no testable exports' };
  }

  // Format with Prettier
  testContent = await formatWithPrettier(testContent, testFilePath);

  // Check if content differs from existing
  if (fs.existsSync(testFilePath)) {
    const existingContent = fs.readFileSync(testFilePath, 'utf-8');
    if (existingContent === testContent) {
      console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} - no changes`);
      return { skipped: true, reason: 'no changes' };
    }
  }

  // Ensure __tests__ directory exists
  const testDir = path.dirname(testFilePath);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Write test file
  fs.writeFileSync(testFilePath, testContent, 'utf-8');
  console.log(`✅ Generated ${path.relative(ROOT_DIR, testFilePath)}`);

  return { success: true, testFilePath };
}

/**
 * Process all source files
 */
async function processAll() {
  console.log('🔍 Scanning all source files...\n');

  const files = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip ignored directories
      if (entry.isDirectory()) {
        if (['__tests__', 'node_modules', 'dist', 'reports', 'public'].includes(entry.name)) {
          continue;
        }
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  scanDir(SRC_DIR);

  console.log(`Found ${files.length} source files\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const result = await processFile(file);
    if (result.success) processed++;
    else if (result.skipped) skipped++;
    else if (result.error) errors++;
  }

  console.log(`\n📊 Summary: ${processed} generated, ${skipped} skipped, ${errors} errors`);
}

/**
 * Watch mode - only process add/change events
 */
async function watchMode(runCoverage = false) {
  console.log('👀 Starting watch mode...\n');
  console.log('   Watching: src/**/*.{js,jsx,ts,tsx}');
  console.log('   Ignoring: __tests__/**, node_modules/**, dist/**, reports/**, public/**');
  if (runCoverage) {
    console.log('   Coverage: enabled (will run tests after each change)');
  }
  console.log('');

  const watcher = chokidar.watch('src/**/*.{js,jsx,ts,tsx}', {
    cwd: ROOT_DIR,
    ignored: [
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/reports/**',
      '**/public/**',
    ],
    persistent: true,
    ignoreInitial: true, // CRITICAL: Do not process existing files on startup
  });

  watcher.on('add', async (filePath) => {
    console.log(`\n📄 File added: ${filePath}`);
    const result = await processFile(path.join(ROOT_DIR, filePath));
    if (result.success && runCoverage) {
      const testPattern = path.relative(ROOT_DIR, result.testFilePath).replace(/\\/g, '/');
      await runJest(testPattern, { coverage: true });
    }
  });

  watcher.on('change', async (filePath) => {
    console.log(`\n✏️  File changed: ${filePath}`);
    const result = await processFile(path.join(ROOT_DIR, filePath));
    if (result.success && runCoverage) {
      const testPattern = path.relative(ROOT_DIR, result.testFilePath).replace(/\\/g, '/');
      await runJest(testPattern, { coverage: true });
    }
  });

  watcher.on('error', (error) => {
    console.error(`❌ Watcher error: ${error.message}`);
  });

  watcher.on('ready', () => {
    console.log('✅ Watcher ready. Waiting for file changes...\n');
    console.log('Press Ctrl+C to stop.\n');
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watcher...');
    watcher.close();
    process.exit(0);
  });
}

/**
 * Run Jest tests with optional coverage
 */
function runJest(testPattern, options = {}) {
  const { coverage = false, watch = false } = options;

  return new Promise((resolve, reject) => {
    const args = [];

    if (testPattern) {
      args.push('--testPathPattern', testPattern);
    }

    if (coverage) {
      args.push('--coverage');
      if (testPattern) {
        // Only collect coverage for the specific file being tested
        args.push('--collectCoverageFrom', testPattern.replace('__tests__/', '').replace('.test.tsx', '.tsx').replace('.test.ts', '.ts'));
      }
    }

    if (watch) {
      args.push('--watch');
    }

    console.log(`\n🧪 Running Jest${coverage ? ' with coverage' : ''}...`);
    console.log(`   jest ${args.join(' ')}\n`);

    const isWindows = process.platform === 'win32';
    const jestBin = isWindows ? 'npx.cmd' : 'npx';
    const jestArgs = isWindows ? ['jest', ...args] : ['jest', ...args];

    const jest = spawn(jestBin, jestArgs, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: isWindows,
    });

    jest.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Don't reject on test failures, just log
        console.log(`\n⚠️  Jest exited with code ${code}`);
        resolve();
      }
    });

    jest.on('error', (err) => {
      console.error(`❌ Failed to run Jest: ${err.message}`);
      resolve(); // Don't fail the whole process
    });
  });
}

/**
 * Process only git unstaged files
 */
async function processGitUnstaged() {
  console.log('🔍 Finding git unstaged changes...\n');

  try {
    // Get unstaged changes (modified files not yet staged)
    const diffOutput = execSync('git diff --name-only', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    }).trim();

    // Also get untracked files
    const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    }).trim();

    // Combine both outputs
    const allChanges = [diffOutput, untrackedOutput]
      .filter(Boolean)
      .join('\n');

    if (!allChanges) {
      console.log('No unstaged changes found.\n');
      return { processed: 0, skipped: 0, errors: 0 };
    }

    // Filter to source files in src/
    const files = allChanges
      .split('\n')
      .filter(Boolean)
      .filter((file) => {
        // Must be in src/ directory
        if (!file.startsWith('src/')) return false;

        // Must be a source file
        const ext = path.extname(file);
        if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return false;

        // Skip test files and __tests__ directories
        if (file.includes('__tests__')) return false;
        if (file.includes('.test.') || file.includes('.spec.')) return false;

        // Skip node_modules, dist, build, coverage
        if (file.includes('node_modules')) return false;
        if (file.includes('/dist/')) return false;
        if (file.includes('/build/')) return false;
        if (file.includes('/coverage/')) return false;

        return true;
      })
      .map((file) => path.join(ROOT_DIR, file));

    if (files.length === 0) {
      console.log('No source files in unstaged changes.\n');
      return { processed: 0, skipped: 0, errors: 0 };
    }

    console.log(`Found ${files.length} unstaged source file(s):\n`);
    files.forEach((f) => console.log(`  - ${path.relative(ROOT_DIR, f)}`));
    console.log('');

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      const result = await processFile(file);
      if (result.success) processed++;
      else if (result.skipped) skipped++;
      else if (result.error) errors++;
    }

    console.log(`\n📊 Summary: ${processed} generated, ${skipped} skipped, ${errors} errors`);
    return { processed, skipped, errors };
  } catch (err) {
    console.error(`❌ Git command failed: ${err.message}`);
    console.error('Make sure you are in a git repository.');
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const hasCoverage = args.includes('--coverage');

  // Load dependencies
  await loadDependencies();

  switch (command) {
    case 'watch':
      await watchMode(hasCoverage);
      break;

    case 'all':
      await processAll();
      if (hasCoverage) {
        await runJest(null, { coverage: true });
      }
      break;

    case 'file':
      if (!args[1] || args[1] === '--coverage') {
        console.error('❌ Please provide a file path: node scripts/auto-testgen.mjs file <path> [--coverage]');
        process.exit(1);
      }
      const result = await processFile(args[1]);
      if (result.success && hasCoverage) {
        const testPattern = path.relative(ROOT_DIR, result.testFilePath).replace(/\\/g, '/');
        await runJest(testPattern, { coverage: true });
      }
      break;

    case 'git-unstaged':
      const gitResult = await processGitUnstaged();
      if (hasCoverage && gitResult.processed > 0) {
        await runJest(null, { coverage: true });
      }
      break;

    default:
      console.log(`
Auto Test Generator - Generates Jest + React Testing Library tests

Usage:
  node scripts/auto-testgen.mjs watch [--coverage]        - Watch mode (run tests after each change)
  node scripts/auto-testgen.mjs all [--coverage]          - Process all source files
  node scripts/auto-testgen.mjs file <path> [--coverage]  - Process a single file
  node scripts/auto-testgen.mjs git-unstaged [--coverage] - Process only git unstaged files

Options:
  --coverage   Run Jest with coverage after generating tests

Commands:
  watch        Only react to file add/change events (ignoreInitial: true)
  all          Scan and process all source files in src/
  file         Process a specific file path
  git-unstaged Process only files with unstaged git changes (safest for large repos)
`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
