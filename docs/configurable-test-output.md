# Configurable Test File Output Location

Control where generated test files are placed relative to your source files.

---

## Quick Start

Add a `testOutput` field to your `react-testgen.config.json`:

```jsonc
{
  "version": 1,
  "defaults": {
    "testOutput": {
      "strategy": "colocated"   // test files next to components
    }
  },
  "packages": [
    { "name": "my-app", "root": "." }
  ]
}
```

Then run `npm run testgen` as usual.

---

## Strategies

### 1. Colocated

Test file sits **next to** the source file. No subdirectory.

```jsonc
"testOutput": {
  "strategy": "colocated"
}
```

**Result:**

```
src/
  components/
    Button.tsx
    Button.test.tsx          <-- same folder
  hooks/
    useAuth.ts
    useAuth.test.ts          <-- same folder
```

---

### 2. Subfolder (Default)

Test file goes into a **subdirectory** next to the source file.

```jsonc
"testOutput": {
  "strategy": "subfolder",
  "directory": "__tests__"     // folder name (default: "__tests__")
}
```

**Result:**

```
src/
  components/
    Button.tsx
    __tests__/
      Button.test.tsx        <-- inside subfolder
```

You can use any folder name:

```jsonc
"testOutput": {
  "strategy": "subfolder",
  "directory": "specs"
}
```

```
src/
  components/
    Button.tsx
    specs/
      Button.test.tsx        <-- custom folder name
```

This is the **default strategy** when no `testOutput` is configured.

---

### 3. Mirror

Test files are placed in a **separate root directory** that mirrors your source tree structure.

```jsonc
"testOutput": {
  "strategy": "mirror",
  "directory": "tests",        // root folder for all tests (default: "tests")
  "srcRoot": "src"             // source folder to mirror (default: "src")
}
```

**Result:**

```
src/                           <-- source tree
  components/
    Button.tsx
    Header.tsx
  hooks/
    useAuth.ts
  utils/
    format.ts

tests/                         <-- mirrors src/ structure
  components/
    Button.test.tsx
    Header.test.tsx
  hooks/
    useAuth.test.ts
  utils/
    format.test.ts
```

---

## Suffix Configuration

Change the test file suffix from `.test` to `.spec`:

```jsonc
"testOutput": {
  "strategy": "colocated",
  "suffix": ".spec"
}
```

**Result:**

```
src/
  components/
    Button.tsx
    Button.spec.tsx            <-- .spec instead of .test
```

Works with any strategy. Default is `".test"`.

| Suffix    | Example Output       |
|-----------|----------------------|
| `".test"` | `Button.test.tsx`    |
| `".spec"` | `Button.spec.tsx`    |

---

## All Options

| Option      | Type     | Values                                       | Default        | Description                              |
|-------------|----------|----------------------------------------------|----------------|------------------------------------------|
| `strategy`  | string   | `"colocated"` \| `"subfolder"` \| `"mirror"` | `"subfolder"`  | Where to place test files                |
| `directory`  | string   | Any valid folder name                        | `"__tests__"` (subfolder), `"tests"` (mirror) | Folder name for subfolder/mirror   |
| `srcRoot`   | string   | Source directory name                        | `"src"`        | Source root to strip (mirror only)       |
| `suffix`    | string   | `".test"` \| `".spec"`                       | `".test"`      | File suffix before extension             |

---

## Per-Package Overrides (Monorepo)

In a monorepo, each package can use a different strategy:

```jsonc
{
  "version": 1,
  "defaults": {
    "testOutput": { "strategy": "subfolder" }
  },
  "packages": [
    {
      "name": "ui",
      "root": "packages/ui",
      "testOutput": {
        "strategy": "colocated",
        "suffix": ".spec"
      }
    },
    {
      "name": "core",
      "root": "packages/core",
      "testOutput": {
        "strategy": "mirror",
        "directory": "tests"
      }
    },
    {
      "name": "utils",
      "root": "packages/utils"
      // inherits defaults: subfolder + __tests__ + .test
    }
  ]
}
```

**Result:**

```
packages/
  ui/
    src/components/
      Button.tsx
      Button.spec.tsx          <-- colocated + .spec

  core/
    src/components/
      Header.tsx
    tests/components/
      Header.test.tsx          <-- mirror

  utils/
    src/helpers/
      format.ts
      __tests__/
        format.test.ts         <-- subfolder (inherited default)
```

---

## Examples

### Example 1: Colocated with .spec suffix

```jsonc
{
  "version": 1,
  "defaults": {
    "include": ["src/**/*.{ts,tsx}"],
    "exclude": ["**/*.spec.*", "**/dist/**"],
    "framework": "auto",
    "renderHelper": "auto",
    "generateFor": ["components", "hooks", "utils"],
    "mode": "git-unstaged",
    "testOutput": {
      "strategy": "colocated",
      "suffix": ".spec"
    }
  },
  "packages": [
    { "name": "default", "root": "." }
  ]
}
```

### Example 2: Custom subfolder name

```jsonc
{
  "version": 1,
  "defaults": {
    "include": ["src/**/*.{ts,tsx}"],
    "exclude": ["**/test/**", "**/*.test.*", "**/dist/**"],
    "framework": "auto",
    "renderHelper": "auto",
    "generateFor": ["components", "hooks", "utils"],
    "mode": "git-unstaged",
    "testOutput": {
      "strategy": "subfolder",
      "directory": "test"
    }
  },
  "packages": [
    { "name": "default", "root": "." }
  ]
}
```

### Example 3: Mirror with custom root

```jsonc
{
  "version": 1,
  "defaults": {
    "include": ["src/**/*.{ts,tsx}"],
    "exclude": ["**/dist/**"],
    "framework": "jest",
    "renderHelper": "auto",
    "generateFor": ["components", "hooks", "utils"],
    "mode": "all",
    "testOutput": {
      "strategy": "mirror",
      "directory": "test-suite",
      "srcRoot": "src"
    }
  },
  "packages": [
    { "name": "default", "root": "." }
  ]
}
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No `testOutput` in config | Defaults to `subfolder` + `__tests__` + `.test` (original behavior) |
| No `react-testgen.config.json` at all | Same defaults, zero breakage |
| Mirror: source file outside `srcRoot` | Falls back to subfolder with a console warning |
| Changing strategy mid-project | Old test files remain on disk; clean up manually |
| Per-package override missing `testOutput` | Inherits from `defaults.testOutput` |

---

## How It Works Internally

```
react-testgen.config.json          -- You configure testOutput here
        |
        v
workspace/config.ts                -- loadConfig() reads JSON
        |                             resolveTestOutput() fills defaults
        v
cli.ts  -->  run()                 -- Resolves config, threads testOutput
        |                             to all generation functions
        v
utils/path.ts                      -- getTestFilePath() computes output path
        |                             based on strategy + directory + suffix
        v
scaffold.ts                        -- Generates jest.config.cjs with matching
                                      testMatch and collectCoverageFrom patterns
```

---

## Migration Guide

### From `__tests__/` subfolder to colocated

1. Update `react-testgen.config.json`:
   ```jsonc
   "testOutput": { "strategy": "colocated" }
   ```

2. Run `npm run testgen` -- new tests will be colocated.

3. Delete old `__tests__/` folders manually (the tool does not delete old files).

### From `.test` to `.spec`

1. Update config:
   ```jsonc
   "testOutput": { "strategy": "colocated", "suffix": ".spec" }
   ```

2. Update `exclude` to match:
   ```jsonc
   "exclude": ["**/*.spec.*", "**/dist/**"]
   ```

3. Run `npm run testgen`.

4. Delete old `.test.*` files manually.
