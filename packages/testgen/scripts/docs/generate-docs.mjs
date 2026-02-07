/**
 * Documentation Generator Script
 * Converts MD and TXT files to Word document and creates PDF with flow diagrams
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  PageBreak,
  ImageRun,
  convertInchesToTwip,
} from "docx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, "..", "..", "docs");

// Color scheme
const colors = {
  primary: "1E40AF", // Blue
  secondary: "059669", // Green
  accent: "7C3AED", // Purple
  warning: "D97706", // Orange
  heading: "111827", // Dark gray
  text: "374151", // Gray
  lightBg: "F3F4F6", // Light gray background
  codeBg: "1F2937", // Dark code background
};

/**
 * Create a styled heading paragraph
 */
function createHeading(text, level = HeadingLevel.HEADING_1) {
  const sizes = {
    [HeadingLevel.TITLE]: 56,
    [HeadingLevel.HEADING_1]: 40,
    [HeadingLevel.HEADING_2]: 32,
    [HeadingLevel.HEADING_3]: 26,
  };

  const colorMap = {
    [HeadingLevel.TITLE]: colors.primary,
    [HeadingLevel.HEADING_1]: colors.primary,
    [HeadingLevel.HEADING_2]: colors.secondary,
    [HeadingLevel.HEADING_3]: colors.accent,
  };

  return new Paragraph({
    heading: level,
    spacing: { before: 400, after: 200 },
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: sizes[level] || 28,
        color: colorMap[level] || colors.heading,
        font: "Segoe UI",
      }),
    ],
  });
}

/**
 * Create a regular paragraph
 */
function createParagraph(text, options = {}) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    children: [
      new TextRun({
        text: text,
        size: 22,
        color: colors.text,
        font: "Segoe UI",
        ...options,
      }),
    ],
  });
}

/**
 * Create a bullet point
 */
function createBullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { before: 60, after: 60 },
    children: [
      new TextRun({
        text: text,
        size: 22,
        color: colors.text,
        font: "Segoe UI",
      }),
    ],
  });
}

/**
 * Create a code block
 */
function createCodeBlock(code) {
  const lines = code.split("\n");
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { before: 0, after: 0 },
        shading: { type: ShadingType.SOLID, color: "F3F4F6" },
        children: [
          new TextRun({
            text: line || " ",
            size: 18,
            font: "Consolas",
            color: colors.codeBg,
          }),
        ],
      })
  );
}

/**
 * Create a styled table
 */
function createTable(headers, rows) {
  const headerCells = headers.map(
    (header) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: colors.primary },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: header,
                bold: true,
                size: 20,
                color: "FFFFFF",
                font: "Segoe UI",
              }),
            ],
          }),
        ],
      })
  );

  const dataRows = rows.map(
    (row, rowIndex) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              shading: {
                type: ShadingType.SOLID,
                color: rowIndex % 2 === 0 ? "FFFFFF" : colors.lightBg,
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      size: 20,
                      color: colors.text,
                      font: "Segoe UI",
                    }),
                  ],
                }),
              ],
            })
        ),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: headerCells }), ...dataRows],
  });
}

/**
 * Create a highlighted box
 */
function createHighlightBox(title, content, bgColor = colors.lightBg) {
  return [
    new Paragraph({
      shading: { type: ShadingType.SOLID, color: bgColor },
      spacing: { before: 200, after: 100 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 6, color: colors.primary },
        left: { style: BorderStyle.SINGLE, size: 6, color: colors.primary },
      },
      children: [
        new TextRun({
          text: `  ${title}`,
          bold: true,
          size: 24,
          color: colors.primary,
          font: "Segoe UI",
        }),
      ],
    }),
    new Paragraph({
      shading: { type: ShadingType.SOLID, color: bgColor },
      spacing: { before: 0, after: 200 },
      children: [
        new TextRun({
          text: `  ${content}`,
          size: 22,
          color: colors.text,
          font: "Segoe UI",
        }),
      ],
    }),
  ];
}

/**
 * Generate the main Word document
 */
async function generateWordDocument() {
  console.log("📄 Generating Word Document...\n");

  const sections = [];

  // Title Page
  sections.push(
    new Paragraph({ spacing: { before: 2000 } }),
    createHeading("AUTOMATED TEST GENERATION", HeadingLevel.TITLE),
    createHeading("For React 19 Components", HeadingLevel.HEADING_2),
    new Paragraph({ spacing: { before: 400 } }),
    createParagraph("Complete Documentation Guide"),
    new Paragraph({ spacing: { before: 200 } }),
    createParagraph("Version: 1.0 | Last Updated: February 2026"),
    createParagraph("Maintainers: Frontend Platform Team"),
    new Paragraph({
      children: [new PageBreak()],
    })
  );

  // Table of Contents
  sections.push(
    createHeading("Table of Contents", HeadingLevel.HEADING_1),
    createBullet("1. Overview"),
    createBullet("2. Quick Start"),
    createBullet("3. Key Principles"),
    createBullet("4. High-Level Architecture"),
    createBullet("5. Workflow & Flow Diagrams"),
    createBullet("6. Modes of Operation"),
    createBullet("7. Git-Based Safety Mechanism"),
    createBullet("8. Test Generation Rules"),
    createBullet("9. Component Test Strategy"),
    createBullet("10. Utility Test Strategy"),
    createBullet("11. Import Resolution Strategy"),
    createBullet("12. renderWithProviders Role"),
    createBullet("13. Coverage Strategy"),
    createBullet("14. Usage Examples"),
    createBullet("15. Best Practices"),
    createBullet("16. Troubleshooting"),
    createBullet("17. Commands Reference"),
    new Paragraph({
      children: [new PageBreak()],
    })
  );

  // Section 1: Overview
  sections.push(
    createHeading("1. Overview", HeadingLevel.HEADING_1),
    createHeading("What Problem This Solves", HeadingLevel.HEADING_2),
    createParagraph(
      "Modern React applications require comprehensive test coverage, but writing boilerplate test code is time-consuming and error-prone. Teams often face:"
    ),
    createBullet("Inconsistent test structure across components written by different developers"),
    createBullet("Missing tests for new components due to time pressure"),
    createBullet("Delayed testing where tests are written long after the component, leading to gaps"),
    createBullet("Onboarding friction where new developers don't know the team's testing patterns"),

    createHeading("Why Automatic Test Scaffolding Is Needed", HeadingLevel.HEADING_2),
    createParagraph("Manual test creation for every component requires:"),
    createBullet("Creating the correct directory structure (__tests__/)"),
    createBullet("Setting up imports (component, testing utilities, providers)"),
    createBullet("Writing boilerplate render tests"),
    createBullet("Remembering accessibility and interaction patterns"),
    createBullet("Configuring snapshot tests"),
    createParagraph(
      "This repetitive work discourages thorough testing and introduces inconsistency."
    ),

    ...createHighlightBox(
      "Why This Approach Is Safer",
      "Unlike tools that regenerate all tests on every run, this system processes only changed files, never overwrites manual tests, generates scaffolds not assertions, uses deterministic AST parsing, and integrates with Git."
    )
  );

  // Section 2: Quick Start
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("2. Quick Start", HeadingLevel.HEADING_1),

    createHeading("Step 1: Verify Dependencies", HeadingLevel.HEADING_2),
    createParagraph("All required dependencies should already be installed. If not, run:"),
    ...createCodeBlock("npm install"),

    createHeading("Step 2: Start Development", HeadingLevel.HEADING_2),
    ...createCodeBlock("npm start"),
    createParagraph(
      "This runs BOTH the Webpack dev server (http://localhost:3000) and the test generator in watch mode."
    ),

    createHeading("Step 3: Run Tests", HeadingLevel.HEADING_2),
    createTable(
      ["Command", "Description"],
      [
        ["npm test", "Run all tests"],
        ["npm run test:watch", "Run tests in watch mode"],
        ["npm run test:coverage", "Run with coverage report"],
        ["npm run test:coverage:check", "Enforce 80% coverage threshold"],
      ]
    )
  );

  // Section 3: Key Principles
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("3. Key Principles", HeadingLevel.HEADING_1),
    createTable(
      ["Principle", "Description"],
      [
        [
          "Generate tests ONLY for changed files",
          "The system processes only files that appear in Git's unstaged changes",
        ],
        ["Never touch unrelated files", "Files outside the change set are completely ignored"],
        [
          "Manual tests are never overwritten",
          "If a test file exists without the @generated header, it is skipped",
        ],
        [
          "Generated tests are clearly marked",
          "All generated files include @generated AUTO-GENERATED FILE header",
        ],
        [
          "Deterministic, non-AI generation",
          "Output is based purely on AST analysis; no machine learning",
        ],
      ]
    )
  );

  // Section 4: Architecture
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("4. High-Level Architecture", HeadingLevel.HEADING_1),
    createParagraph("The auto-testgen system uses the following component architecture:"),
    createTable(
      ["Component", "Technology", "Purpose"],
      [
        ["Git Integration", "child_process / shell", "Identifies changed files via git diff"],
        ["AST Parser", "@babel/parser", "Parses TypeScript/JSX to extract exports"],
        ["Type Extraction", "ts-morph", "Reads TypeScript interfaces for prop types"],
        ["Formatter", "prettier", "Ensures consistent code style"],
        ["Test Runner", "jest + @testing-library/react", "Executes generated tests"],
      ]
    )
  );

  // Section 5: Workflow & Flow Diagram
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("5. Workflow & Flow Diagrams", HeadingLevel.HEADING_1),

    createHeading("Developer Workflow", HeadingLevel.HEADING_2),
    createBullet("1. Developer modifies a React/TS file (e.g., src/components/Button.tsx)"),
    createBullet("2. File appears in git unstaged changes"),
    createBullet("3. Generator reads only those files (npm run testgen)"),
    createBullet("4. Corresponding test file is created/updated in __tests__/ directory"),
    createBullet("5. Developer reviews and completes TODOs"),
    createBullet("6. Jest enforces coverage thresholds (npm test -- --coverage)"),
    createBullet("7. Commit both source and test files"),

    createHeading("Flow Diagram: Test Generation Process", HeadingLevel.HEADING_2),
    ...createHighlightBox(
      "Process Flow",
      "[Source Change] → [Git Diff Filter] → [Generator Process] → [Test File Output]"
    ),

    createParagraph("Detailed flow:"),
    createBullet("Source files are detected via git diff --name-only"),
    createBullet("Files are filtered to include only .ts, .tsx, .js, .jsx extensions"),
    createBullet("__tests__ directories and node_modules are excluded"),
    createBullet("Babel AST parser extracts exports and component information"),
    createBullet("ts-morph extracts TypeScript prop types"),
    createBullet("Test templates are generated with appropriate sections"),
    createBullet("Prettier formats the output"),
    createBullet("Test file is written to __tests__/ adjacent to source")
  );

  // Section 6: Modes of Operation
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("6. Modes of Operation", HeadingLevel.HEADING_1),

    createHeading("Git-Unstaged Mode (Primary)", HeadingLevel.HEADING_2),
    ...createCodeBlock("npm run test:generate:git"),
    createParagraph(
      "Behavior: Reads git diff --name-only for unstaged changes, processes only modified source files. Recommended for daily development."
    ),

    createHeading("All Mode (Manual / One-Time Only)", HeadingLevel.HEADING_2),
    ...createCodeBlock("npm run test:generate"),
    createParagraph(
      "Behavior: Scans entire src/ directory, processes all eligible source files. Use sparingly for initial setup or major refactors."
    ),

    createHeading("File Mode (Single-File Generation)", HeadingLevel.HEADING_2),
    ...createCodeBlock("npm run test:generate:file src/components/MyComponent.tsx"),
    createParagraph(
      "Behavior: Processes exactly one specified file. Useful for targeted regeneration."
    )
  );

  // Section 7: Git-Based Safety
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("7. Git-Based Safety Mechanism", HeadingLevel.HEADING_1),
    createTable(
      ["File State", "Processed?", "Rationale"],
      [
        ["Unstaged (modified)", "Yes", "Active development; tests should match"],
        ["Staged", "No", "Developer has prepared for commit; don't interfere"],
        ["Committed", "No", "Part of version history; regeneration could cause conflicts"],
        ["Untracked", "Optional", "New files may need initial test scaffolding"],
      ]
    ),

    createHeading("Benefits for Large Repositories", HeadingLevel.HEADING_2),
    createBullet("Performance: Scanning 5 changed files is faster than scanning 500"),
    createBullet("Safety: Reduces blast radius of any generation bugs"),
    createBullet("Predictability: Developers know exactly which files will be affected"),
    createBullet("CI Compatibility: Prevents accidental mass regeneration in pipelines")
  );

  // Section 8: Test Generation Rules
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("8. Test Generation Rules", HeadingLevel.HEADING_1),

    createHeading("Test File Location", HeadingLevel.HEADING_2),
    createTable(
      ["Source File", "Generated Test File"],
      [
        ["src/components/Button.tsx", "src/components/__tests__/Button.test.tsx"],
        ["src/hooks/useAuth.ts", "src/hooks/__tests__/useAuth.test.ts"],
        ["src/utils/formatters.ts", "src/utils/__tests__/formatters.test.ts"],
      ]
    ),

    createHeading("Component vs Utility Detection", HeadingLevel.HEADING_2),
    createParagraph("Component Indicators:"),
    createBullet("Export name starts with uppercase letter (PascalCase)"),
    createBullet("Source contains JSX syntax (<, />, </)"),
    createBullet("Standard function declarations or arrow functions"),

    createParagraph("Utility Indicators:"),
    createBullet("Export name starts with lowercase letter (camelCase)"),
    createBullet("No JSX detected"),
    createBullet("Pure function or constant export"),

    ...createHighlightBox(
      "Known Limitation",
      "Components created with forwardRef are currently not detected by the AST analyzer. For these components, write tests manually or create a wrapper component."
    )
  );

  // Section 9: Component Test Strategy
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("9. Component Test Strategy", HeadingLevel.HEADING_1),
    createParagraph(
      "Generated component tests follow a consistent structure with these sections:"
    ),

    createHeading("Render Tests", HeadingLevel.HEADING_3),
    createParagraph("Purpose: Verifies basic component mounting and DOM presence."),

    createHeading("Snapshot Tests", HeadingLevel.HEADING_3),
    createParagraph("Purpose: Catches unintended UI regressions."),

    createHeading("Props Handling", HeadingLevel.HEADING_3),
    createParagraph("Purpose: Scaffolds prop testing with type-aware placeholders."),

    createHeading("User Interaction Stubs", HeadingLevel.HEADING_3),
    createParagraph("Purpose: Provides interaction testing boilerplate with examples."),

    createHeading("Accessibility Placeholders", HeadingLevel.HEADING_3),
    createParagraph("Purpose: Encourages accessibility testing without failing by default.")
  );

  // Section 14: Usage Examples
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("14. Usage Examples", HeadingLevel.HEADING_1),

    createHeading("Example: ExpenseCard Component", HeadingLevel.HEADING_2),
    createParagraph("Source file: src/components/expense/ExpenseCard.tsx"),

    createHeading("Generated Test Structure:", HeadingLevel.HEADING_3),
    ...createCodeBlock(`describe('ExpenseCard', () => {
  const defaultProps = {
    id: "TODO",
    amount: 0,
    category: "TODO",
    date: undefined /* TODO */,
  };

  describe('Rendering', () => {
    it('renders without crashing', () => {
      renderWithProviders(<ExpenseCard {...defaultProps} />);
    });
  });

  describe('Snapshot', () => {
    it('matches snapshot', () => {
      const { container } = renderWithProviders(<ExpenseCard {...defaultProps} />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});`),

    createHeading("Developer Completion Example:", HeadingLevel.HEADING_3),
    ...createCodeBlock(`// Completed defaultProps
const defaultProps = {
  id: "expense-123",
  amount: 49.99,
  category: "Food & Dining",
  date: new Date('2024-06-15'),
};

// Completed interaction test
it('handles click events', async () => {
  const user = userEvent.setup();
  const handleEdit = jest.fn();

  renderWithProviders(
    <ExpenseCard {...defaultProps} onEdit={handleEdit} />
  );

  await user.click(screen.getByRole('button', { name: /edit/i }));
  expect(handleEdit).toHaveBeenCalledWith('expense-123');
});`)
  );

  // Section 15: Best Practices
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("15. Best Practices", HeadingLevel.HEADING_1),

    createHeading("Use Git-Unstaged Mode for Safety", HeadingLevel.HEADING_2),
    ...createCodeBlock(`# Before committing, generate tests only for your changes
npm run test:generate:git

# Then run tests
npm test`),

    createHeading("Add Proper Selectors", HeadingLevel.HEADING_2),
    createParagraph("Replace TODO placeholders with proper selectors:"),
    ...createCodeBlock(`// BAD - Generated placeholder
const button = screen.getByRole('button');

// GOOD - Use accessible name
const button = screen.getByRole('button', { name: /submit/i });

// GOOD - Or add data-testid for complex elements
const chart = screen.getByTestId('expense-chart');`),

    createHeading("Fill in Required Props", HeadingLevel.HEADING_2),
    ...createCodeBlock(`// Generated (may need adjustment)
const defaultProps = {
  title: 'TODO',
  onSubmit: () => { /* TODO */ },
};

// BETTER - Update with realistic values
const defaultProps = {
  title: 'Create Expense',
  onSubmit: jest.fn(),
};`),

    createHeading("Add Branch Coverage Tests", HeadingLevel.HEADING_2),
    ...createCodeBlock(`// Loading state
it("shows loading spinner when loading", () => {
  renderWithProviders(<ExpenseList isLoading={true} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

// Error state
it("shows error message on error", () => {
  renderWithProviders(<ExpenseList error="Failed to load" />);
  expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
});

// Empty state
it("shows empty state when no data", () => {
  renderWithProviders(<ExpenseList expenses={[]} />);
  expect(screen.getByText(/no expenses/i)).toBeInTheDocument();
});`)
  );

  // Section 16: Troubleshooting
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("16. Troubleshooting", HeadingLevel.HEADING_1),

    createHeading('"Cannot find module" in generated tests', HeadingLevel.HEADING_2),
    createParagraph("Cause: Import path issues or path aliases not configured."),
    createParagraph(
      "Fix: The generator computes relative imports automatically. If using path aliases, ensure Jest is configured:"
    ),
    ...createCodeBlock(`// jest.config.js
moduleNameMapper: {
  "^@/(.*)$": "<rootDir>/src/$1",
  "^@components/(.*)$": "<rootDir>/src/components/$1",
}`),

    createHeading("Tests fail because Router/Providers missing", HeadingLevel.HEADING_2),
    createParagraph("Cause: Component expects context that isn't provided."),
    createParagraph(
      "Fix: The renderWithProviders utility already wraps with MemoryRouter and all app providers."
    ),
    ...createCodeBlock(
      'renderWithProviders(<ExpensePage />, { initialRoute: "/expenses/123" });'
    ),

    createHeading("Generated tests fail for async components", HeadingLevel.HEADING_2),
    createParagraph("Cause: Component shows loading state initially before data loads."),
    createParagraph("Fix: Use findByRole instead of getByRole for async elements:"),
    ...createCodeBlock(`// Instead of:
expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();

// Use:
expect(await screen.findByRole('button', { name: /submit/i })).toBeInTheDocument();`)
  );

  // Section 17: Commands Reference
  sections.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    createHeading("17. Commands Reference", HeadingLevel.HEADING_1),

    createTable(
      ["Task", "Command"],
      [
        ["Start development", "npm start"],
        ["Generate tests for changed files", "npm run test:generate:git"],
        ["Generate tests for all files", "npm run test:generate"],
        ["Generate test for single file", "npm run test:generate:file <path>"],
        ["Run all tests", "npm test"],
        ["Run with coverage", "npm run test:coverage"],
        ["Enforce 80% coverage", "npm run test:coverage:check"],
      ]
    ),

    new Paragraph({ spacing: { before: 400 } }),
    ...createHighlightBox(
      "Remember",
      "Generated tests get you to 60% coverage. Human intent gets you to 100% confidence."
    )
  );

  // Create the document
  const doc = new Document({
    title: "Automated Test Generation Guide",
    description: "Complete documentation for React 19 automated test generation system",
    creator: "Frontend Platform Team",
    sections: [
      {
        properties: {},
        children: sections,
      },
    ],
  });

  // Write to file
  const outputPath = path.join(docsDir, "Automated-Test-Generation-Complete-Guide.docx");
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  console.log(`✅ Word document created: ${outputPath}\n`);
  return outputPath;
}

/**
 * Generate HTML for PDF (with flow diagram and highlighted headings)
 */
function generatePDFHtml() {
  console.log("📊 Generating HTML for PDF with Flow Diagram...\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automated Test Generation - Flow Diagram & Usage Examples</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px;
      background: #fff;
    }

    /* Title Styles */
    .title-page {
      text-align: center;
      padding: 100px 0;
      border-bottom: 3px solid #1E40AF;
      margin-bottom: 40px;
    }

    .title-page h1 {
      font-size: 2.5em;
      color: #1E40AF;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .title-page h2 {
      font-size: 1.5em;
      color: #059669;
      margin-bottom: 30px;
    }

    .title-page .meta {
      color: #666;
      font-size: 0.9em;
    }

    /* Headings */
    h1 {
      color: #1E40AF;
      font-size: 2em;
      margin: 40px 0 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1E40AF;
      background: linear-gradient(90deg, #EBF5FF 0%, transparent 100%);
      padding: 15px;
      border-radius: 5px 5px 0 0;
    }

    h2 {
      color: #059669;
      font-size: 1.5em;
      margin: 30px 0 15px;
      padding-left: 15px;
      border-left: 4px solid #059669;
      background: linear-gradient(90deg, #ECFDF5 0%, transparent 100%);
      padding: 10px 15px;
    }

    h3 {
      color: #7C3AED;
      font-size: 1.2em;
      margin: 20px 0 10px;
      padding-left: 10px;
      border-left: 3px solid #7C3AED;
    }

    /* Paragraphs */
    p {
      margin: 15px 0;
      text-align: justify;
    }

    /* Lists */
    ul, ol {
      margin: 15px 0 15px 30px;
    }

    li {
      margin: 8px 0;
    }

    /* Code blocks */
    pre {
      background: #1F2937;
      color: #E5E7EB;
      padding: 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 20px 0;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      border-left: 4px solid #3B82F6;
    }

    code {
      background: #F3F4F6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      color: #DC2626;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    th {
      background: #1E40AF;
      color: white;
      padding: 15px;
      text-align: left;
      font-weight: 600;
    }

    td {
      padding: 12px 15px;
      border-bottom: 1px solid #E5E7EB;
    }

    tr:nth-child(even) {
      background: #F9FAFB;
    }

    tr:hover {
      background: #EBF5FF;
    }

    /* Flow Diagram */
    .flow-diagram {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px;
      border-radius: 15px;
      margin: 30px 0;
      color: white;
    }

    .flow-diagram h3 {
      color: white;
      text-align: center;
      margin-bottom: 30px;
      border: none;
      font-size: 1.5em;
    }

    .flow-steps {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .flow-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
    }

    .flow-box {
      background: rgba(255,255,255,0.95);
      color: #333;
      padding: 15px 25px;
      border-radius: 10px;
      font-weight: 600;
      text-align: center;
      min-width: 150px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    }

    .flow-box.primary {
      background: #1E40AF;
      color: white;
    }

    .flow-box.success {
      background: #059669;
      color: white;
    }

    .flow-box.warning {
      background: #D97706;
      color: white;
    }

    .flow-arrow {
      font-size: 2em;
      color: white;
    }

    /* Highlight boxes */
    .highlight-box {
      background: linear-gradient(135deg, #EBF5FF 0%, #DBEAFE 100%);
      border-left: 5px solid #1E40AF;
      padding: 20px;
      margin: 20px 0;
      border-radius: 0 10px 10px 0;
    }

    .highlight-box.warning {
      background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
      border-left-color: #D97706;
    }

    .highlight-box.success {
      background: linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%);
      border-left-color: #059669;
    }

    .highlight-box h4 {
      color: #1E40AF;
      margin-bottom: 10px;
    }

    .highlight-box.warning h4 {
      color: #D97706;
    }

    .highlight-box.success h4 {
      color: #059669;
    }

    /* Page breaks for printing */
    .page-break {
      page-break-after: always;
    }

    /* Architecture Diagram */
    .architecture {
      background: #F3F4F6;
      padding: 30px;
      border-radius: 15px;
      margin: 30px 0;
      font-family: 'Consolas', monospace;
    }

    .arch-layer {
      background: white;
      padding: 15px;
      margin: 10px 0;
      border-radius: 8px;
      border: 2px solid #E5E7EB;
      display: flex;
      justify-content: space-around;
      flex-wrap: wrap;
      gap: 10px;
    }

    .arch-box {
      background: linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%);
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      text-align: center;
      min-width: 120px;
    }

    /* Print styles */
    @media print {
      body {
        padding: 20px;
      }

      .flow-diagram {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      h1, h2, h3 {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .highlight-box {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>

<!-- Title Page -->
<div class="title-page">
  <h1>Automated Test Generation</h1>
  <h2>Flow Diagrams & Usage Examples</h2>
  <p class="meta">For React 19 Components with Jest & React Testing Library</p>
  <p class="meta">Version 1.0 | February 2026</p>
</div>

<!-- Section 1: System Overview Flow -->
<h1>1. System Architecture Overview</h1>

<div class="architecture">
  <h3 style="text-align: center; margin-bottom: 20px; color: #1E40AF;">auto-testgen.mjs Architecture</h3>

  <div class="arch-layer">
    <div class="arch-box">Git Integration</div>
    <span>→</span>
    <div class="arch-box">Babel Parser</div>
    <span>→</span>
    <div class="arch-box">ts-morph Types</div>
  </div>

  <div style="text-align: center; padding: 10px;">↓</div>

  <div class="arch-layer">
    <div class="arch-box" style="width: 80%;">Test Template Generator<br><small>Component detection • Export enumeration • Props extraction</small></div>
  </div>

  <div style="text-align: center; padding: 10px;">↓</div>

  <div class="arch-layer">
    <div class="arch-box">Prettier Formatting</div>
    <span>→</span>
    <div class="arch-box">File Write (atomic)</div>
    <span>→</span>
    <div class="arch-box">Jest Execution</div>
  </div>
</div>

<!-- Section 2: Main Flow Diagram -->
<h1>2. Test Generation Flow</h1>

<div class="flow-diagram">
  <h3>Developer Workflow Flow</h3>

  <div class="flow-steps">
    <div class="flow-row">
      <div class="flow-box primary">1. Developer Edits<br>React Component</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box">2. File Shows in<br>Git Unstaged</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box primary">3. Generator<br>Detects Changes</div>
    </div>

    <div style="text-align: center; padding: 10px;">
      <span class="flow-arrow">↓</span>
    </div>

    <div class="flow-row">
      <div class="flow-box success">4. AST Parses<br>Exports & Props</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box">5. Test Template<br>Generated</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box success">6. Written to<br>__tests__/ folder</div>
    </div>

    <div style="text-align: center; padding: 10px;">
      <span class="flow-arrow">↓</span>
    </div>

    <div class="flow-row">
      <div class="flow-box warning">7. Developer<br>Fills TODOs</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box">8. Jest Runs<br>with Coverage</div>
      <span class="flow-arrow">→</span>
      <div class="flow-box success">9. Commit Both<br>Files Together</div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<!-- Section 3: Decision Flow -->
<h1>3. File Processing Decision Flow</h1>

<div class="flow-diagram">
  <h3>Should This File Be Processed?</h3>

  <div class="flow-steps">
    <div class="flow-row">
      <div class="flow-box primary">Source File<br>Changed</div>
    </div>

    <div style="text-align: center; padding: 10px;">
      <span class="flow-arrow">↓</span>
    </div>

    <div class="flow-row">
      <div class="flow-box">Is it .ts, .tsx,<br>.js, .jsx?</div>
    </div>

    <div class="flow-row" style="margin-top: 10px;">
      <div style="color: white;">Yes ↓</div>
      <div style="width: 100px;"></div>
      <div class="flow-box warning" style="opacity: 0.7;">No → Skip</div>
    </div>

    <div class="flow-row">
      <div class="flow-box">Is it in __tests__<br>or node_modules?</div>
    </div>

    <div class="flow-row" style="margin-top: 10px;">
      <div style="color: white;">No ↓</div>
      <div style="width: 100px;"></div>
      <div class="flow-box warning" style="opacity: 0.7;">Yes → Skip</div>
    </div>

    <div class="flow-row">
      <div class="flow-box">Does test exist<br>WITHOUT @generated?</div>
    </div>

    <div class="flow-row" style="margin-top: 10px;">
      <div style="color: white;">No ↓</div>
      <div style="width: 100px;"></div>
      <div class="flow-box warning" style="opacity: 0.7;">Yes → Skip<br>(Manual Test)</div>
    </div>

    <div class="flow-row">
      <div class="flow-box success">✓ Generate/Update<br>Test File</div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<!-- Section 4: Usage Examples -->
<h1>4. Usage Examples</h1>

<h2>Example 1: Daily Development Workflow</h2>

<pre><code># Step 1: Start development with auto test generation
npm start

# Step 2: Edit your component
# File: src/components/Button.tsx is modified

# Step 3: Test is auto-generated at:
# src/components/__tests__/Button.test.tsx

# Step 4: Run tests to verify
npm test

# Step 5: Before commit, check coverage
npm run test:coverage:check
</code></pre>

<h2>Example 2: Git-Unstaged Mode (Before PR)</h2>

<pre><code># Only generate tests for your changes (safest option)
npm run test:generate:git

# Review the generated tests
# Fill in TODO placeholders with real values

# Run all tests
npm test

# Ensure coverage meets threshold
npm run test:coverage:check

# Commit your changes
git add .
git commit -m "feat: add new component with tests"
</code></pre>

<h2>Example 3: Single File Generation</h2>

<pre><code># Generate test for a specific component
npm run test:generate:file src/components/ExpenseCard.tsx

# This creates:
# src/components/__tests__/ExpenseCard.test.tsx
</code></pre>

<div class="page-break"></div>

<!-- Section 5: Generated Test Example -->
<h1>5. Generated Test Structure</h1>

<h2>Before: Source Component</h2>

<pre><code>// src/components/expense/ExpenseCard.tsx

export interface ExpenseCardProps {
  id: string;
  amount: number;
  category: string;
  date: Date;
  description?: string;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ExpenseCard({ id, amount, category, date, ... }: ExpenseCardProps) {
  return (
    &lt;Card className="expense-card"&gt;
      &lt;Badge&gt;{category}&lt;/Badge&gt;
      &lt;span&gt;{formatCurrency(amount)}&lt;/span&gt;
      {/* ... */}
    &lt;/Card&gt;
  );
}
</code></pre>

<h2>After: Generated Test</h2>

<pre><code>/** @generated AUTO-GENERATED FILE - safe to overwrite */
import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { ExpenseCard } from '../ExpenseCard';

describe('ExpenseCard', () => {
  const defaultProps = {
    id: "TODO",
    amount: 0,
    category: "TODO",
    date: undefined /* TODO */,
  };

  describe('Rendering', () => {
    it('renders without crashing', () => {
      renderWithProviders(&lt;ExpenseCard {...defaultProps} /&gt;);
    });

    it('renders with default props', () => {
      const { container } = renderWithProviders(&lt;ExpenseCard {...defaultProps} /&gt;);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Snapshot', () => {
    it('matches snapshot', () => {
      const { container } = renderWithProviders(&lt;ExpenseCard {...defaultProps} /&gt;);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ... Props, User Interactions, Accessibility sections
});
</code></pre>

<div class="page-break"></div>

<!-- Section 6: Completing TODOs -->
<h1>6. Completing the Generated Tests</h1>

<h2>Step 1: Fill in defaultProps</h2>

<pre><code>// Before (generated)
const defaultProps = {
  id: "TODO",
  amount: 0,
  category: "TODO",
  date: undefined /* TODO */,
};

// After (completed by developer)
const defaultProps = {
  id: "expense-123",
  amount: 49.99,
  category: "Food & Dining",
  date: new Date('2024-06-15'),
};
</code></pre>

<h2>Step 2: Add Interaction Tests</h2>

<pre><code>it('handles edit button click', async () => {
  const user = userEvent.setup();
  const handleEdit = jest.fn();

  renderWithProviders(
    &lt;ExpenseCard {...defaultProps} onEdit={handleEdit} /&gt;
  );

  await user.click(screen.getByRole('button', { name: /edit/i }));
  expect(handleEdit).toHaveBeenCalledWith('expense-123');
});

it('handles delete button click', async () => {
  const user = userEvent.setup();
  const handleDelete = jest.fn();

  renderWithProviders(
    &lt;ExpenseCard {...defaultProps} onDelete={handleDelete} /&gt;
  );

  await user.click(screen.getByRole('button', { name: /delete/i }));
  expect(handleDelete).toHaveBeenCalledWith('expense-123');
});
</code></pre>

<h2>Step 3: Add Branch Coverage</h2>

<pre><code>it('renders without description when not provided', () => {
  renderWithProviders(&lt;ExpenseCard {...defaultProps} /&gt;);
  expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
});

it('renders description when provided', () => {
  renderWithProviders(
    &lt;ExpenseCard {...defaultProps} description="Lunch meeting" /&gt;
  );
  expect(screen.getByText('Lunch meeting')).toBeInTheDocument();
});

it('hides edit button when onEdit not provided', () => {
  renderWithProviders(&lt;ExpenseCard {...defaultProps} /&gt;);
  expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
});
</code></pre>

<div class="page-break"></div>

<!-- Section 7: Commands Reference -->
<h1>7. Commands Quick Reference</h1>

<table>
  <tr>
    <th>Task</th>
    <th>Command</th>
  </tr>
  <tr>
    <td>Start development with auto test generation</td>
    <td><code>npm start</code></td>
  </tr>
  <tr>
    <td>Start without test generation</td>
    <td><code>npm run start:no-testgen</code></td>
  </tr>
  <tr>
    <td>Generate tests for git unstaged files (recommended)</td>
    <td><code>npm run test:generate:git</code></td>
  </tr>
  <tr>
    <td>Generate tests for all files</td>
    <td><code>npm run test:generate</code></td>
  </tr>
  <tr>
    <td>Generate test for single file</td>
    <td><code>npm run test:generate:file &lt;path&gt;</code></td>
  </tr>
  <tr>
    <td>Run all tests</td>
    <td><code>npm test</code></td>
  </tr>
  <tr>
    <td>Run tests in watch mode</td>
    <td><code>npm run test:watch</code></td>
  </tr>
  <tr>
    <td>Run with coverage report</td>
    <td><code>npm run test:coverage</code></td>
  </tr>
  <tr>
    <td>Enforce 80% coverage threshold</td>
    <td><code>npm run test:coverage:check</code></td>
  </tr>
</table>

<div class="highlight-box success">
  <h4>Key Takeaway</h4>
  <p><strong>Generated tests get you to 60% coverage. Human intent gets you to 100% confidence.</strong></p>
  <p>The generator removes initial friction by creating test scaffolding, but the quality of your test suite ultimately depends on the assertions and edge cases that developers add.</p>
</div>

<div class="highlight-box warning">
  <h4>Known Limitation</h4>
  <p>Components created with <code>forwardRef</code> are not automatically detected by the AST analyzer. For these components, you'll need to write tests manually.</p>
</div>

<div class="highlight-box">
  <h4>Generated File Marker</h4>
  <p>Tests with this header will be regenerated:</p>
  <pre style="background: #1F2937; color: #E5E7EB; padding: 10px; margin-top: 10px; border-radius: 5px;">/** @generated AUTO-GENERATED FILE - safe to overwrite */</pre>
  <p>Remove the header to protect manual edits from being overwritten.</p>
</div>

</body>
</html>`;

  const outputPath = path.join(docsDir, "Test-Generation-Flow-Diagram-Usage-Examples.html");
  fs.writeFileSync(outputPath, html);

  console.log(`✅ HTML file created (print to PDF): ${outputPath}\n`);
  console.log(
    '📌 To convert to PDF: Open the HTML file in a browser and use "Print to PDF" (Ctrl+P)\n'
  );
  return outputPath;
}

/**
 * Main execution
 */
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  DOCUMENTATION GENERATOR");
  console.log("  Converting MD/TXT to Word & Creating PDF with Flow Diagrams");
  console.log("=".repeat(60) + "\n");

  try {
    // Ensure docs directory exists
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Generate Word document
    const wordPath = await generateWordDocument();

    // Generate HTML for PDF
    const htmlPath = generatePDFHtml();

    console.log("=".repeat(60));
    console.log("  GENERATION COMPLETE!");
    console.log("=".repeat(60));
    console.log("\nOutput files:");
    console.log(`  📄 Word: ${wordPath}`);
    console.log(`  📊 HTML/PDF: ${htmlPath}`);
    console.log("\nTo create PDF:");
    console.log("  1. Open the HTML file in your browser");
    console.log('  2. Press Ctrl+P (or Cmd+P on Mac)');
    console.log('  3. Select "Save as PDF" as the destination');
    console.log('  4. Enable "Background graphics" in options');
    console.log("  5. Save the PDF\n");
  } catch (error) {
    console.error("Error generating documentation:", error);
    process.exit(1);
  }
}

main();
