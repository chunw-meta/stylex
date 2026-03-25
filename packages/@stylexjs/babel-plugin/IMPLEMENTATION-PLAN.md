# Complete Implementation & Test Plan: Nested Design Token APIs for StyleX

**APIs**: `stylex.unstable_defineVarsNested`, `stylex.unstable_defineConstsNested`, `stylex.unstable_createThemeNested`
**Date**: 2026-03-25
**Repository**: `/Users/chunw/stylex`
**Babel Plugin**: `packages/@stylexjs/babel-plugin`
**Public API**: `packages/@stylexjs/stylex`

---

## Table of Contents

- [Pre-Implementation: Establish Baseline](#pre-implementation-establish-baseline)
- [Phase 1: Shared Utility — Flatten/Unflatten](#phase-1-shared-utility--flattenunflatten)
- [Phase 2: Shared Transform Wrappers](#phase-2-shared-transform-wrappers)
- [Phase 3: State Manager + Import Detection](#phase-3-state-manager--import-detection)
- [Phase 4: Public API Stubs](#phase-4-public-api-stubs)
- [Phase 5: Visitor Transform Functions](#phase-5-visitor-transform-functions)
- [Phase 6: CallExpression Dispatch](#phase-6-callexpression-dispatch)
- [Phase 7: Type Definitions](#phase-7-type-definitions)
- [Phase 8: Tests](#phase-8-tests)
- [Verification Checklist](#verification-checklist)
- [File Summary](#file-summary)

---

## Pre-Implementation: Establish Baseline

Before writing any code, confirm the existing test suite passes and familiarize yourself with test patterns:

```bash
# Full test suite — this is our regression baseline
cd packages/@stylexjs/babel-plugin && npx jest --no-coverage

# Study the tests we're modeling ours after
npx jest __tests__/transform-stylex-defineVars-test.js --no-coverage
npx jest __tests__/transform-stylex-defineConsts-test.js --no-coverage
npx jest __tests__/transform-stylex-createTheme-test.js --no-coverage
```

**Key pattern**: Tests use a `transform(code, options)` helper that runs the Babel plugin on a source string and returns `{ code, metadata }`. Each test asserts on `code` (transformed JS output) and `metadata` (CSS output array). We follow this pattern exactly.

---

## Phase 1: Shared Utility — Flatten/Unflatten

**New file**: `packages/@stylexjs/babel-plugin/src/shared/stylex-nested-utils.js`

This is the core algorithm. Two functions plus Flow type definitions.

### 1.1 Type Definitions

```js
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import { isCSSType } from './types';

// Recursive type for nested vars config.
// Leaves: string, number, null, CSSType, or conditional object (has 'default' key).
// Namespaces: plain objects without 'default' key.
export type NestedVarsConfigValue =
  | string
  | number
  | $ReadOnly<{ default: NestedVarsConfigValue, [string]: NestedVarsConfigValue }>
  | $ReadOnly<{ +[string]: NestedVarsConfigValue }>;

export type NestedVarsConfig = $ReadOnly<{
  [string]: NestedVarsConfigValue,
}>;

// Consts are simpler — leaves are only string or number (no conditionals).
export type NestedConstsConfigValue =
  | string
  | number
  | $ReadOnly<{ +[string]: NestedConstsConfigValue }>;

export type NestedConstsConfig = $ReadOnly<{
  [string]: NestedConstsConfigValue,
}>;
```

### 1.2 `flattenNestedConfig()`

Recursively walks nested object, building dot-separated keys. Stops at leaf values.

**Leaf detection rule:**
- String or number → leaf (simple CSS value)
- `null` → leaf (schema placeholder for theme interfaces)
- `CSSType` instance (via `isCSSType()`) → leaf (typed CSS value)
- Object **with** `default` key → leaf (conditional @-rule value, e.g. `{ default: 'blue', '@media ...': 'dark' }`)
- Object **without** `default` key → namespace (recurse, extend key path)

```js
const SEPARATOR = '.';

function isLeafValue(value: mixed): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return true;
  }
  if (value == null) {
    return true;
  }
  if (isCSSType(value)) {
    return true;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    // Object WITH 'default' key = conditional @-rule value = leaf
    // Object WITHOUT 'default' key = namespace = NOT a leaf
    return value.default !== undefined;
  }
  return true;
}

export function flattenNestedConfig(
  obj: { +[string]: mixed },
  prefix: string = '',
): { [string]: mixed } {
  const result: { [string]: mixed } = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}${SEPARATOR}${key}` : key;

    if (isLeafValue(value)) {
      result[fullKey] = value;
    } else if (typeof value === 'object' && value != null && !Array.isArray(value)) {
      Object.assign(result, flattenNestedConfig(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}
```

**Example walkthrough:**
```
Input:                                    Output:
{                                         {
  button: {              ← no default       'button.primary.background': '#00FF00',
    primary: {           ← no default       'button.primary.color': {
      background:        ← string leaf         default: 'blue',
        '#00FF00',                             '@media ...': 'lightblue'
      color: {           ← HAS default      },
        default: 'blue',   (leaf!)           'button.secondary.background': '#CCCCCC',
        '@media ...':                       }
          'lightblue',
      },
    },
    secondary: {         ← no default
      background:        ← string leaf
        '#CCCCCC',
    },
  },
}
```

### 1.3 `unflattenObject()`

Rebuilds nested structure from dot-separated keys. Preserves special top-level keys.

```js
const SPECIAL_KEYS = new Set(['__varGroupHash__', '$$css']);

export function unflattenObject(
  flatObj: { +[string]: mixed },
): { [string]: mixed } {
  const result: { [string]: mixed } = {};

  for (const key of Object.keys(flatObj)) {
    // Don't split special keys — keep at top level as-is
    if (SPECIAL_KEYS.has(key) || !key.includes(SEPARATOR)) {
      result[key] = flatObj[key];
      continue;
    }

    const parts = key.split(SEPARATOR);
    let current: { [string]: mixed } = result;

    // Walk/create intermediate namespace objects
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] == null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = (current[part]: any);
    }

    // Set the value at the leaf
    current[parts[parts.length - 1]] = flatObj[key];
  }

  return result;
}
```

**Example walkthrough:**
```
Input:                                    Output:
{                                         {
  'button.primary.bg':                      button: {
       'var(--xHash1)',          ──►          primary: {
  'button.primary.color':                       bg: 'var(--xHash1)',
       'var(--xHash2)',                         color: 'var(--xHash2)',
  'button.secondary.bg':                     },
       'var(--xHash3)',                       secondary: {
  __varGroupHash__: 'xGroupHash',               bg: 'var(--xHash3)',
}                                             },
                                            },
                                            __varGroupHash__: 'xGroupHash',
                                          }
```

### 1.4 Phase 1 Verification

```bash
npx jest __tests__/stylex-nested-utils-test.js --no-coverage
```

---

## Phase 2: Shared Transform Wrappers

Three thin wrapper files. Each follows the same pattern: flatten → delegate to existing flat transform → unflatten JS output. No new CSS logic.

### 2a: `stylex-define-vars-nested.js`

**New file**: `packages/@stylexjs/babel-plugin/src/shared/stylex-define-vars-nested.js`

```js
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type { InjectableStyle, StyleXOptions } from './common-types';

import styleXDefineVars from './stylex-define-vars';
import { flattenNestedConfig, unflattenObject } from './stylex-nested-utils';

export default function styleXDefineVarsNested(
  nestedVariables: { +[string]: mixed },
  options: $ReadOnly<{ ...Partial<StyleXOptions>, exportId: string, ... }>,
): [{ [string]: mixed }, { [string]: InjectableStyle }] {
  // 1. Flatten nested input to dot-separated keys
  const flatVariables = flattenNestedConfig(nestedVariables);

  // 2. Delegate to existing styleXDefineVars (unchanged)
  const [flatResult, injectableStyles] = styleXDefineVars(flatVariables, options);

  // 3. Separate __varGroupHash__ before unflattening
  const { __varGroupHash__, ...flatVarRefs } = flatResult;

  // 4. Unflatten the var() references back to nested structure
  const nestedVarRefs = unflattenObject(flatVarRefs);

  return [
    { ...nestedVarRefs, __varGroupHash__ },
    injectableStyles,  // CSS output — already flat, untouched
  ];
}
```

### 2b: `stylex-define-consts-nested.js`

**New file**: `packages/@stylexjs/babel-plugin/src/shared/stylex-define-consts-nested.js`

```js
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type { InjectableConstStyle, StyleXOptions } from './common-types';

import styleXDefineConsts from './stylex-define-consts';
import { flattenNestedConfig, unflattenObject } from './stylex-nested-utils';

export default function styleXDefineConstsNested(
  nestedConstants: { +[string]: mixed },
  options: $ReadOnly<{ ...Partial<StyleXOptions>, exportId: string, ... }>,
): [{ [string]: mixed }, { [string]: InjectableConstStyle }] {
  // 1. Flatten
  const flatConstants = flattenNestedConfig(nestedConstants);

  // 2. Delegate to existing styleXDefineConsts
  const [flatResult, injectableStyles] = styleXDefineConsts(flatConstants, options);

  // 3. Unflatten (original values preserved, just nested again)
  const nestedResult = unflattenObject(flatResult);

  return [nestedResult, injectableStyles];
}
```

### 2c: `stylex-create-theme-nested.js`

**New file**: `packages/@stylexjs/babel-plugin/src/shared/stylex-create-theme-nested.js`

```js
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type { InjectableStyle, StyleXOptions } from './common-types';

import styleXCreateTheme from './stylex-create-theme';
import { flattenNestedConfig } from './stylex-nested-utils';

export default function styleXCreateThemeNested(
  themeVars: { +__varGroupHash__: string, +[string]: mixed },
  nestedOverrides: { +[string]: mixed },
  options?: StyleXOptions,
): [{ $$css: true, +[string]: string }, { [string]: InjectableStyle }] {
  // 1. Flatten the theme vars (strip __varGroupHash__ before, re-add after)
  const { __varGroupHash__, ...nestedVarRefs } = themeVars;
  const flatVarRefs = flattenNestedConfig(nestedVarRefs);
  const flatThemeVars = { ...flatVarRefs, __varGroupHash__ };

  // 2. Flatten the overrides
  const flatOverrides = flattenNestedConfig(nestedOverrides);

  // 3. Delegate to existing styleXCreateTheme
  // Output is already flat: { $$css: true, [hash]: className }
  // No unflattening needed
  return styleXCreateTheme(flatThemeVars, flatOverrides, options);
}
```

### 2d: Update shared exports

**Modified file**: `packages/@stylexjs/babel-plugin/src/shared/index.js`

Add imports (after existing imports around line 36):
```js
import styleXDefineVarsNested from './stylex-define-vars-nested';
import styleXDefineConstsNested from './stylex-define-consts-nested';
import styleXCreateThemeNested from './stylex-create-theme-nested';
```

Add exports (after existing exports around line 63):
```js
export const defineVarsNested: typeof styleXDefineVarsNested = styleXDefineVarsNested;
export const defineConstsNested: typeof styleXDefineConstsNested = styleXDefineConstsNested;
export const createThemeNested: typeof styleXCreateThemeNested = styleXCreateThemeNested;
```

### 2e: Phase 2 Verification

```bash
# No behavioral changes yet — just verify no regressions
npx jest --no-coverage
```

---

## Phase 3: State Manager + Import Detection

### 3a: State Manager

**Modified file**: `packages/@stylexjs/babel-plugin/src/utils/state-manager.js`

Add three new `Set<string>` fields to the `StateManager` class, after line 185 (after `+stylexEnvImport`):

```js
  +stylexDefineVarsNestedImport: Set<string> = new Set();
  +stylexDefineConstsNestedImport: Set<string> = new Set();
  +stylexCreateThemeNestedImport: Set<string> = new Set();
```

### 3b: Import Detection — `readImportDeclarations`

**Modified file**: `packages/@stylexjs/babel-plugin/src/visitors/imports.js`

In `readImportDeclarations`, after the `createTheme` block (after line 93):

```js
              if (importedName === 'unstable_defineVarsNested') {
                state.stylexDefineVarsNestedImport.add(localName);
              }
              if (importedName === 'unstable_defineConstsNested') {
                state.stylexDefineConstsNestedImport.add(localName);
              }
              if (importedName === 'unstable_createThemeNested') {
                state.stylexCreateThemeNestedImport.add(localName);
              }
```

### 3c: Import Detection — `readRequires`

In `readRequires`, after the `createTheme` block (after line 181):

```js
            if (prop.key.name === 'unstable_defineVarsNested') {
              state.stylexDefineVarsNestedImport.add(value.name);
            }
            if (prop.key.name === 'unstable_defineConstsNested') {
              state.stylexDefineConstsNestedImport.add(value.name);
            }
            if (prop.key.name === 'unstable_createThemeNested') {
              state.stylexCreateThemeNestedImport.add(value.name);
            }
```

### 3d: Phase 3 Verification

```bash
# Import sets exist but nothing triggers them yet — no regressions
npx jest --no-coverage
```

---

## Phase 4: Public API Stubs

**⚠️ Must come before Phase 5.** The Babel plugin's import detection reads from `@stylexjs/stylex` — if the export doesn't exist, named imports won't resolve in the test environment.

**Modified file**: `packages/@stylexjs/stylex/src/stylex.js`

### 4a: Add runtime-throwing exports

After the `defineVars` export (after line 86):

```js
export const unstable_defineVarsNested = function stylexDefineVarsNested(
  _styles: $FlowFixMe,
) {
  throw errorForFn('unstable_defineVarsNested');
};

export const unstable_defineConstsNested = function stylexDefineConstsNested<
  const T: { +[string]: unknown },
>(_styles: T): T {
  throw errorForFn('unstable_defineConstsNested');
};

export const unstable_createThemeNested = (
  _baseTokens: $FlowFixMe,
  _overrides: $FlowFixMe,
) => {
  throw errorForFn('unstable_createThemeNested');
};
```

### 4b: Add to `_legacyMerge` object

After line 341 (after `_legacyMerge.env = env`):

```js
_legacyMerge.unstable_defineVarsNested = unstable_defineVarsNested;
_legacyMerge.unstable_defineConstsNested = unstable_defineConstsNested;
_legacyMerge.unstable_createThemeNested = unstable_createThemeNested;
```

### 4c: Add to `IStyleX` type definition

Around line 315 (inside the `IStyleX` type):

```js
  unstable_defineVarsNested: (...args: $FlowFixMe) => $FlowFixMe,
  unstable_defineConstsNested: (...args: $FlowFixMe) => $FlowFixMe,
  unstable_createThemeNested: (...args: $FlowFixMe) => $FlowFixMe,
```

### 4d: Phase 4 Verification

```bash
npx jest --no-coverage
```

---

## Phase 5: Visitor Transform Functions

Three new visitor files. Each is modeled on its flat counterpart with minimal changes: different import set, different property name, different shared function call, different error messages.

### 5a: `stylex-define-vars-nested.js` visitor

**New file**: `packages/@stylexjs/babel-plugin/src/visitors/stylex-define-vars-nested.js`

**Template**: Copy `src/visitors/stylex-define-vars.js` (212 lines), then make these substitutions:

| Line/Pattern in Original | Change To |
|---|---|
| `state.stylexDefineVarsImport.has(...)` | `state.stylexDefineVarsNestedImport.has(...)` |
| `callee.property.name === 'defineVars'` | `callee.property.name === 'unstable_defineVarsNested'` |
| `import { defineVars as stylexDefineVars, ... } from '../shared'` | `import { defineVarsNested as stylexDefineVarsNested, ... } from '../shared'` |
| `stylexDefineVars(value, { ...state.options, exportId })` | `stylexDefineVarsNested(value, { ...state.options, exportId })` |
| `messages.nonStaticValue('defineVars')` | `messages.nonStaticValue('unstable_defineVarsNested')` |
| `messages.nonStyleObject('defineVars')` | `messages.nonStyleObject('unstable_defineVarsNested')` |
| `messages.cannotGenerateHash('defineVars')` | `messages.cannotGenerateHash('unstable_defineVarsNested')` |
| `messages.unboundCallValue('defineVars')` | `messages.unboundCallValue('unstable_defineVarsNested')` |
| `messages.nonExportNamedDeclaration('defineVars')` | `messages.nonExportNamedDeclaration('unstable_defineVarsNested')` |
| `messages.illegalArgumentLength('defineVars', 1)` | `messages.illegalArgumentLength('unstable_defineVarsNested', 1)` |
| `export default function transformStyleXDefineVars` | `export default function transformStyleXDefineVarsNested` |

Everything else stays identical: static evaluation, keyframes/positionTry/types handling, `convertObjectToAST()`, `registerStyles()`, validation logic.

### 5b: `stylex-define-consts-nested.js` visitor

**New file**: `packages/@stylexjs/babel-plugin/src/visitors/stylex-define-consts-nested.js`

**Template**: Copy `src/visitors/stylex-define-consts.js` (139 lines), then substitute:

| Original | Change To |
|---|---|
| `state.stylexDefineConstsImport` | `state.stylexDefineConstsNestedImport` |
| `callee.property.name === 'defineConsts'` | `callee.property.name === 'unstable_defineConstsNested'` |
| `import { defineConsts as styleXDefineConsts, ... }` | `import { defineConstsNested as styleXDefineConstsNested, ... }` |
| `styleXDefineConsts(value, ...)` | `styleXDefineConstsNested(value, ...)` |
| All error messages: `'defineConsts'` | `'unstable_defineConstsNested'` |
| `export default function transformStyleXDefineConsts` | `export default function transformStyleXDefineConstsNested` |

### 5c: `stylex-create-theme-nested.js` visitor

**New file**: `packages/@stylexjs/babel-plugin/src/visitors/stylex-create-theme-nested.js`

**Template**: Copy `src/visitors/stylex-create-theme.js` (228 lines), then substitute:

| Original | Change To |
|---|---|
| `state.stylexCreateThemeImport` | `state.stylexCreateThemeNestedImport` |
| `callee.property.name === 'createTheme'` | `callee.property.name === 'unstable_createThemeNested'` |
| `import { createTheme as stylexCreateTheme, ... }` | `import { createThemeNested as stylexCreateThemeNested, ... }` |
| `stylexCreateTheme(variables, overrides, state.options)` | `stylexCreateThemeNested(variables, overrides, state.options)` |
| All error messages: `'createTheme'` | `'unstable_createThemeNested'` |
| Validation: `arguments.length !== 2` | Same (2 args required) |
| `export default function transformStyleXCreateTheme` | `export default function transformStyleXCreateThemeNested` |

---

## Phase 6: CallExpression Dispatch

**Modified file**: `packages/@stylexjs/babel-plugin/src/index.js`

### 6a: Add imports at the top (with other visitor imports):

```js
import transformStyleXDefineVarsNested from './visitors/stylex-define-vars-nested';
import transformStyleXDefineConstsNested from './visitors/stylex-define-consts-nested';
import transformStyleXCreateThemeNested from './visitors/stylex-create-theme-nested';
```

### 6b: Add calls in `CallExpression` handler

After line 362 (after `transformStyleXCreate(path, state);`):

```js
          transformStyleXDefineVarsNested(path, state);
          transformStyleXDefineConstsNested(path, state);
          transformStyleXCreateThemeNested(path, state);
```

### 6c: Phase 5-6 Verification

```bash
# All existing tests should still pass
npx jest --no-coverage
```

---

## Phase 7: Type Definitions

For `unstable_*` experimental APIs, `$FlowFixMe` stubs are sufficient. Proper recursive generic types will be added when promoting to stable.

### 7a: Flow types

**Modified file**: `packages/@stylexjs/stylex/src/types/StyleXTypes.js`

```js
export type StyleX$DefineVarsNested = (tokens: $FlowFixMe) => $FlowFixMe;
export type StyleX$DefineConstsNested = <const T: { +[string]: unknown }>(tokens: T) => T;
export type StyleX$CreateThemeNested = (baseTokens: $FlowFixMe, overrides: $FlowFixMe) => $FlowFixMe;
```

### 7b: TypeScript types

**Modified file**: `packages/@stylexjs/stylex/src/types/StyleXTypes.d.ts`

```ts
export type StyleX$DefineVarsNested = (tokens: Record<string, any>) => any;
export type StyleX$DefineConstsNested = <T extends Record<string, unknown>>(tokens: T) => T;
export type StyleX$CreateThemeNested = (baseTokens: any, overrides: Record<string, any>) => any;
```

---

## Phase 8: Tests

### 8a: Unit Tests — Flatten/Unflatten

**New file**: `packages/@stylexjs/babel-plugin/__tests__/stylex-nested-utils-test.js`

```js
import { flattenNestedConfig, unflattenObject } from '../src/shared/stylex-nested-utils';

describe('flattenNestedConfig', () => {

  test('flattens simple nested object', () => {
    expect(flattenNestedConfig({
      button: { primary: { background: '#00FF00' } },
    })).toEqual({
      'button.primary.background': '#00FF00',
    });
  });

  test('stops at conditional values (objects with default key)', () => {
    expect(flattenNestedConfig({
      button: {
        color: {
          default: 'blue',
          '@media (prefers-color-scheme: dark)': 'lightblue',
        },
      },
    })).toEqual({
      'button.color': {
        default: 'blue',
        '@media (prefers-color-scheme: dark)': 'lightblue',
      },
    });
  });

  test('handles mixed depths', () => {
    expect(flattenNestedConfig({
      shallow: 'red',
      deep: { nested: { value: 'blue' } },
    })).toEqual({
      shallow: 'red',
      'deep.nested.value': 'blue',
    });
  });

  test('handles number values as leaves', () => {
    expect(flattenNestedConfig({
      spacing: { sm: 4, md: 8 },
    })).toEqual({
      'spacing.sm': 4,
      'spacing.md': 8,
    });
  });

  test('handles null values as leaves', () => {
    expect(flattenNestedConfig({
      button: { background: null },
    })).toEqual({
      'button.background': null,
    });
  });

  test('handles deeply nested (3+ levels)', () => {
    expect(flattenNestedConfig({
      a: { b: { c: { d: 'value' } } },
    })).toEqual({
      'a.b.c.d': 'value',
    });
  });

  test('handles multiple branches at same level', () => {
    expect(flattenNestedConfig({
      button: {
        primary: { bg: 'red' },
        secondary: { bg: 'blue' },
      },
      input: { fill: 'white' },
    })).toEqual({
      'button.primary.bg': 'red',
      'button.secondary.bg': 'blue',
      'input.fill': 'white',
    });
  });

  test('does NOT flatten into nested conditional objects', () => {
    const conditionalValue = {
      default: 'blue',
      '@media (prefers-color-scheme: dark)': {
        default: 'lightblue',
        '@supports (color: oklch(0 0 0))': 'oklch(0.7 -0.3 -0.4)',
      },
    };
    expect(flattenNestedConfig({
      button: { color: conditionalValue },
    })).toEqual({
      'button.color': conditionalValue,
    });
  });
});

describe('unflattenObject', () => {

  test('unflattens dot-separated keys', () => {
    expect(unflattenObject({
      'button.primary.background': 'var(--xHash)',
    })).toEqual({
      button: { primary: { background: 'var(--xHash)' } },
    });
  });

  test('preserves __varGroupHash__ at top level', () => {
    expect(unflattenObject({
      'button.bg': 'var(--xHash1)',
      __varGroupHash__: 'xGroupHash',
    })).toEqual({
      button: { bg: 'var(--xHash1)' },
      __varGroupHash__: 'xGroupHash',
    });
  });

  test('preserves $$css at top level', () => {
    expect(unflattenObject({
      $$css: true,
      'a.b': 'value',
    })).toEqual({
      $$css: true,
      a: { b: 'value' },
    });
  });

  test('preserves non-dotted keys at top level', () => {
    expect(unflattenObject({
      simple: 'value',
      'nested.key': 'other',
    })).toEqual({
      simple: 'value',
      nested: { key: 'other' },
    });
  });

  test('merges multiple keys into same branch', () => {
    expect(unflattenObject({
      'button.primary.bg': 'var(--x1)',
      'button.primary.color': 'var(--x2)',
      'button.secondary.bg': 'var(--x3)',
    })).toEqual({
      button: {
        primary: { bg: 'var(--x1)', color: 'var(--x2)' },
        secondary: { bg: 'var(--x3)' },
      },
    });
  });

  test('round-trips with flattenNestedConfig', () => {
    const original = {
      button: {
        primary: { background: 'red', color: 'blue' },
        secondary: { background: 'gray' },
      },
    };
    const flat = flattenNestedConfig(original);
    const roundTripped = unflattenObject(flat);
    expect(roundTripped).toEqual(original);
  });

  test('round-trips with conditional values', () => {
    const original = {
      button: {
        color: {
          default: 'blue',
          '@media (prefers-color-scheme: dark)': 'lightblue',
        },
      },
    };
    const flat = flattenNestedConfig(original);
    const roundTripped = unflattenObject(flat);
    expect(roundTripped).toEqual(original);
  });
});
```

### 8b: Transform Tests — `defineVarsNested`

**New file**: `packages/@stylexjs/babel-plugin/__tests__/transform-stylex-defineVarsNested-test.js`

```js
import { transformSync } from '@babel/core';
import stylexPlugin from '../src/index';

function transform(source, opts = {}) {
  const result = transformSync(source, {
    filename: opts.filename ?? '/test/tokens.stylex.js',
    parserOpts: { plugins: ['flow'] },
    plugins: [[stylexPlugin, {
      unstable_moduleResolution: { type: 'haste' },
      ...opts,
    }]],
  });
  return { code: result.code, metadata: result.metadata.stylex };
}

describe('stylex.unstable_defineVarsNested', () => {

  // ── Basic Transform Tests ──

  test('transforms basic nested tokens', () => {
    const { code, metadata } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        button: {
          background: 'red',
          color: 'blue',
        },
      });
    `);

    // JS output: nested object with var() references
    expect(code).toContain('button');
    expect(code).toContain('background');
    expect(code).toContain('color');
    expect(code).toContain('var(--');
    expect(code).toContain('__varGroupHash__');

    // CSS: flat :root declarations with both values
    expect(metadata).toHaveLength(1);
    expect(metadata[0][1].ltr).toMatch(/:root/);
    expect(metadata[0][1].ltr).toContain('red');
    expect(metadata[0][1].ltr).toContain('blue');
  });

  test('transforms deeply nested tokens (3+ levels)', () => {
    const { code, metadata } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        button: {
          primary: {
            background: '#00FF00',
          },
          secondary: {
            background: '#CCCCCC',
          },
        },
      });
    `);

    // JS output preserves full nesting
    expect(code).toContain('button');
    expect(code).toContain('primary');
    expect(code).toContain('secondary');
    expect(code).toContain('background');

    // CSS output has all values
    expect(metadata).toHaveLength(1);
    expect(metadata[0][1].ltr).toContain('#00FF00');
    expect(metadata[0][1].ltr).toContain('#CCCCCC');
  });

  test('handles conditional @media values inside nesting', () => {
    const { code, metadata } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        button: {
          color: {
            default: 'blue',
            '@media (prefers-color-scheme: dark)': 'lightblue',
          },
        },
      });
    `);

    // Should have 2+ CSS rules: default + @media
    expect(metadata.length).toBeGreaterThanOrEqual(2);
    expect(metadata.some(m => m[1].ltr.includes('@media'))).toBe(true);
    expect(metadata.some(m => m[1].ltr.includes('lightblue'))).toBe(true);
  });

  test('mixed flat and nested values', () => {
    const { code } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        flatValue: 'red',
        nested: { deep: 'blue' },
      });
    `);

    expect(code).toContain('flatValue');
    expect(code).toContain('nested');
    expect(code).toContain('deep');
    expect(code).toContain('var(--');
  });

  // ── Import Pattern Tests ──

  test('works with default import (member expression)', () => {
    const { code } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        spacing: { sm: '4px' },
      });
    `);
    expect(code).toContain('var(--');
  });

  test('works with named import', () => {
    const { code } = transform(`
      import { unstable_defineVarsNested } from '@stylexjs/stylex';
      export const tokens = unstable_defineVarsNested({
        spacing: { sm: '4px', lg: '16px' },
      });
    `);

    expect(code).toContain('spacing');
    expect(code).toContain('var(--');
  });

  test('works with renamed named import', () => {
    const { code } = transform(`
      import { unstable_defineVarsNested as defineNested } from '@stylexjs/stylex';
      export const tokens = defineNested({
        spacing: { sm: '4px' },
      });
    `);

    expect(code).toContain('spacing');
    expect(code).toContain('var(--');
  });

  // ── Validation Tests ──

  test('must be a named export', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      const tokens = stylex.unstable_defineVarsNested({
        button: { bg: 'red' },
      });
    `)).toThrow();
  });

  test('must have exactly 1 argument', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({}, {});
    `)).toThrow();
  });

  test('must have an argument', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested();
    `)).toThrow();
  });
});
```

### 8c: Transform Tests — `defineConstsNested`

**New file**: `packages/@stylexjs/babel-plugin/__tests__/transform-stylex-defineConstsNested-test.js`

```js
import { transformSync } from '@babel/core';
import stylexPlugin from '../src/index';

function transform(source, opts = {}) {
  const result = transformSync(source, {
    filename: opts.filename ?? '/test/tokens.stylex.js',
    parserOpts: { plugins: ['flow'] },
    plugins: [[stylexPlugin, {
      unstable_moduleResolution: { type: 'haste' },
      ...opts,
    }]],
  });
  return { code: result.code, metadata: result.metadata.stylex };
}

describe('stylex.unstable_defineConstsNested', () => {

  // ── Basic Transform Tests ──

  test('transforms nested consts and preserves original values', () => {
    const { code, metadata } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineConstsNested({
        spacing: { sm: '4px', md: '8px', lg: '16px' },
      });
    `);

    // JS output: nested object with original values (NOT var() references)
    expect(code).toContain('spacing');
    expect(code).toContain('"4px"');
    expect(code).toContain('"8px"');
    expect(code).toContain('"16px"');

    // CSS: empty (consts don't emit CSS variables)
    metadata.forEach(([, style]) => {
      expect(style.ltr).toBe('');
    });
  });

  test('handles deeply nested constants', () => {
    const { code } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineConstsNested({
        colors: {
          slate: { 100: '#f1f5f9', 800: '#1e293b' },
          brand: { primary: '#3b82f6' },
        },
      });
    `);

    expect(code).toContain('colors');
    expect(code).toContain('slate');
    expect(code).toContain('brand');
    expect(code).toContain('"#f1f5f9"');
    expect(code).toContain('"#1e293b"');
    expect(code).toContain('"#3b82f6"');
  });

  test('handles number values', () => {
    const { code } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineConstsNested({
        breakpoints: { mobile: 480, tablet: 768 },
      });
    `);

    expect(code).toContain('480');
    expect(code).toContain('768');
  });

  test('handles mixed string and number values', () => {
    const { code } = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineConstsNested({
        spacing: { sm: '4px', md: 8 },
      });
    `);

    expect(code).toContain('"4px"');
    expect(code).toContain('8');
  });

  // ── Import Pattern Tests ──

  test('works with named import', () => {
    const { code } = transform(`
      import { unstable_defineConstsNested } from '@stylexjs/stylex';
      export const tokens = unstable_defineConstsNested({
        radii: { sm: '0.25rem', xl: '1rem' },
      });
    `);

    expect(code).toContain('radii');
    expect(code).toContain('"0.25rem"');
    expect(code).toContain('"1rem"');
  });

  // ── Validation Tests ──

  test('must be a named export', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      const tokens = stylex.unstable_defineConstsNested({
        spacing: { sm: '4px' },
      });
    `)).toThrow();
  });

  test('must have exactly 1 argument', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineConstsNested({}, {});
    `)).toThrow();
  });
});
```

### 8d: Transform Tests — `createThemeNested`

**New file**: `packages/@stylexjs/babel-plugin/__tests__/transform-stylex-createThemeNested-test.js`

Note: `createTheme` tests are more complex because the first argument must be a `defineVarsNested` result. Follow the pattern in `transform-stylex-createTheme-test.js` which uses cross-file module resolution or inline compiled output.

```js
import { transformSync } from '@babel/core';
import stylexPlugin from '../src/index';

function transform(source, opts = {}) {
  const result = transformSync(source, {
    filename: opts.filename ?? '/test/theme.js',
    parserOpts: { plugins: ['flow'] },
    plugins: [[stylexPlugin, {
      unstable_moduleResolution: {
        type: 'commonJS',
        rootDir: '/test',
      },
      ...opts,
    }]],
  });
  return { code: result.code, metadata: result.metadata.stylex };
}

describe('stylex.unstable_createThemeNested', () => {

  // ── Prerequisite Test ──

  test('defineVarsNested produces valid output for createThemeNested input', () => {
    const varsResult = transform(`
      import stylex from '@stylexjs/stylex';
      export const tokens = stylex.unstable_defineVarsNested({
        button: { background: 'red', color: 'blue' },
      });
    `, { filename: '/test/tokens.stylex.js' });

    expect(varsResult.code).toContain('var(--');
    expect(varsResult.code).toContain('__varGroupHash__');
  });

  // ── Validation Tests ──

  test('must have exactly 2 arguments', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      export const theme = stylex.unstable_createThemeNested({});
    `)).toThrow();
  });

  test('must be assigned to a variable', () => {
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      stylex.unstable_createThemeNested({}, {});
    `)).toThrow();
  });

  test('first arg must have __varGroupHash__', () => {
    expect(() => transform(`
      import { unstable_createThemeNested } from '@stylexjs/stylex';
      export const theme = unstable_createThemeNested({}, {});
    `)).toThrow();
  });

  // ── Import Pattern Tests ──

  test('works with default import (member expression)', () => {
    // Validates that the API is recognized — throws because
    // first arg lacks __varGroupHash__, not because import failed
    expect(() => transform(`
      import stylex from '@stylexjs/stylex';
      export const theme = stylex.unstable_createThemeNested({}, {});
    `)).toThrow('defineVars');
  });

  test('works with named import', () => {
    expect(() => transform(`
      import { unstable_createThemeNested } from '@stylexjs/stylex';
      export const theme = unstable_createThemeNested({}, {});
    `)).toThrow('defineVars');
  });
});
```

---

## Verification Checklist

### After each phase — run regression check:

```bash
cd packages/@stylexjs/babel-plugin && npx jest --no-coverage
```

### Phase-by-phase verification table:

| Phase | What to Verify | Command |
|-------|---------------|---------|
| 1 | `flattenNestedConfig` produces correct flat keys | `npx jest __tests__/stylex-nested-utils-test.js` |
| 1 | Conditional values (`{default: ...}`) are NOT flattened | Included in utils test |
| 1 | Round-trip: `unflatten(flatten(obj)) === obj` | Included in utils test |
| 2 | No regressions (shared wrappers exist but not called yet) | `npx jest --no-coverage` |
| 3 | No regressions (import sets exist but nothing triggers them) | `npx jest --no-coverage` |
| 4 | No regressions (public stubs exist, throw at runtime) | `npx jest --no-coverage` |
| 5-6 | Full transform pipeline works end-to-end | `npx jest __tests__/transform-stylex-defineVarsNested-test.js` |
| 5-6 | Named imports detected | Included in transform tests |
| 5-6 | Member expression detected (`stylex.unstable_*`) | Included in transform tests |
| 5-6 | Validation: must be named export | Included in transform tests |
| 5-6 | Validation: correct argument count | Included in transform tests |
| 7 | Types compile (can be deferred) | `flow check` / `tsc --noEmit` |
| 8 | All new tests pass | See below |
| All | Complete regression — no existing test broken | `npx jest --no-coverage` |

### Run all new tests:

```bash
# Unit tests
npx jest __tests__/stylex-nested-utils-test.js --no-coverage

# Transform tests
npx jest __tests__/transform-stylex-defineVarsNested-test.js --no-coverage
npx jest __tests__/transform-stylex-defineConstsNested-test.js --no-coverage
npx jest __tests__/transform-stylex-createThemeNested-test.js --no-coverage

# Full suite (existing + new)
npx jest --no-coverage
```

### Manual integration test:

After all phases pass, exercise the full flow with real files:

```bash
mkdir -p /tmp/stylex-nested-test

# File 1: Define nested tokens
cat > /tmp/stylex-nested-test/tokens.stylex.js << 'EOF'
import stylex from '@stylexjs/stylex';
export const tokens = stylex.unstable_defineVarsNested({
  button: {
    primary: {
      background: {
        default: '#00FF00',
        '@media (prefers-color-scheme: dark)': '#004400',
      },
      color: 'white',
    },
  },
});
EOF

# File 2: Create theme override
cat > /tmp/stylex-nested-test/theme.js << 'EOF'
import stylex from '@stylexjs/stylex';
import { tokens } from './tokens.stylex.js';
export const darkTheme = stylex.unstable_createThemeNested(tokens, {
  button: {
    primary: {
      background: 'darkgreen',
      color: '#f0f0f0',
    },
  },
});
EOF

# File 3: Use tokens in a component
cat > /tmp/stylex-nested-test/component.js << 'EOF'
import stylex from '@stylexjs/stylex';
import { tokens } from './tokens.stylex.js';
const styles = stylex.create({
  button: {
    backgroundColor: tokens.button.primary.background,
    color: tokens.button.primary.color,
  },
});
EOF
```

Verify:
1. `tokens.stylex.js` → nested JS output with `var()` references + flat `:root` CSS
2. `theme.js` → override className + override CSS
3. `component.js` → uses `var()` references correctly in `stylex.create`

---

## Recommended Implementation Order

```
Phase 1  → run utils tests                    → ✅
Phase 2  → run full suite (no regressions)    → ✅
Phase 3  → run full suite (no regressions)    → ✅
Phase 4  → run full suite (no regressions)    → ✅  ← must come before Phase 5
Phase 5  → create visitor files               → ✅
Phase 6  → wire up dispatch                   → ✅
         → run new transform tests            → ✅
Phase 7  → types (can be deferred)            → ✅
Phase 8  → comprehensive test suite           → ✅
         → run full suite (all pass)          → ✅
```

**Critical ordering**: Phase 4 (public stubs) **must** come before Phase 5 (visitors) because the Babel plugin's import detection reads from `@stylexjs/stylex` — the export needs to exist for named imports to resolve in the test environment.

---

## File Summary

### New Files (11):

| File | Phase | Purpose |
|------|-------|---------|
| `src/shared/stylex-nested-utils.js` | 1 | `flattenNestedConfig()`, `unflattenObject()`, types |
| `src/shared/stylex-define-vars-nested.js` | 2 | Flatten → `styleXDefineVars` → unflatten |
| `src/shared/stylex-define-consts-nested.js` | 2 | Flatten → `styleXDefineConsts` → unflatten |
| `src/shared/stylex-create-theme-nested.js` | 2 | Flatten both args → `styleXCreateTheme` |
| `src/visitors/stylex-define-vars-nested.js` | 5 | Babel visitor (modeled on `stylex-define-vars.js`) |
| `src/visitors/stylex-define-consts-nested.js` | 5 | Babel visitor (modeled on `stylex-define-consts.js`) |
| `src/visitors/stylex-create-theme-nested.js` | 5 | Babel visitor (modeled on `stylex-create-theme.js`) |
| `__tests__/stylex-nested-utils-test.js` | 8 | Unit tests for flatten/unflatten |
| `__tests__/transform-stylex-defineVarsNested-test.js` | 8 | Transform + validation tests |
| `__tests__/transform-stylex-defineConstsNested-test.js` | 8 | Transform + validation tests |
| `__tests__/transform-stylex-createThemeNested-test.js` | 8 | Transform + validation tests |

### Modified Files (7):

| File | Phase | Change |
|------|-------|--------|
| `src/shared/index.js` | 2 | Import + export 3 new shared functions |
| `src/utils/state-manager.js` | 3 | Add 3 new `Set<string>` import tracking fields |
| `src/visitors/imports.js` | 3 | Detect 3 new API names in `readImportDeclarations` + `readRequires` |
| `src/index.js` | 6 | Import 3 new visitors + add to `CallExpression` dispatch |
| `packages/@stylexjs/stylex/src/stylex.js` | 4 | Public stubs + `_legacyMerge` + `IStyleX` type |
| `packages/@stylexjs/stylex/src/types/StyleXTypes.js` | 7 | Flow type aliases |
| `packages/@stylexjs/stylex/src/types/StyleXTypes.d.ts` | 7 | TypeScript type aliases |

### Reference Files (patterns to follow, read-only):

| File | Why |
|------|-----|
| `src/visitors/stylex-define-vars.js` | Template for `defineVarsNested` visitor |
| `src/visitors/stylex-define-consts.js` | Template for `defineConstsNested` visitor |
| `src/visitors/stylex-create-theme.js` | Template for `createThemeNested` visitor |
| `src/shared/stylex-define-vars.js` | Flat transform we delegate to |
| `src/shared/stylex-define-consts.js` | Flat transform we delegate to |
| `src/shared/stylex-create-theme.js` | Flat transform we delegate to |
| `src/utils/js-to-ast.js` | `convertObjectToAST` — already handles nested objects |
| `__tests__/transform-stylex-defineVars-test.js` | Test pattern template |
| `__tests__/transform-stylex-defineConsts-test.js` | Test pattern template |
| `__tests__/transform-stylex-createTheme-test.js` | Test pattern template |
