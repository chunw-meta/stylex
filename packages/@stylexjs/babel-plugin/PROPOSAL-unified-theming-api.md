# Proposal: Unified Nested Theming API for StyleX

**Authors**: Chun Wang
**Status**: Draft / Exploratory
**Date**: 2026-03-24

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Landscape Analysis](#landscape-analysis)
4. [Proposed API Design](#proposed-api-design)
5. [Comparison of Approaches](#comparison-of-approaches)
6. [Interaction with Existing Explorations](#interaction-with-existing-explorations)
7. [Implementation Strategy](#implementation-strategy)
8. [Open Questions & Future Work](#open-questions--future-work)

---

## 1. Executive Summary

This proposal introduces three experimental nested APIs for StyleX — `unstable_defineVarsNested`, `unstable_defineConstsNested`, and `unstable_createThemeNested` — and situates them within the broader vision for a **unified, improved theming API**. These APIs address a concrete, immediate pain point: design systems with hierarchical token structures (e.g., `button.primary.background.default`) cannot be naturally expressed with today's flat `defineVars` / `defineConsts` APIs.

Rather than being an isolated feature, the nested APIs serve as a **foundational building block** for a richer theming story that draws inspiration from:

- **comet-theme-infra**: Meta's internal theming layer with helpers like `t.lightDark()`, platform-aware tokens, and theme interface/implementation separation
- **Tailwind CSS v4 `@theme`/`@theme inline`**: CSS-native token definition with selective CSS variable emission vs. build-time inlining
- **`@nest/styx` `token()` exploration**: Standardized token mapping for AI-native authoring, compiling to StyleX at build time

The nested APIs validate the direction of a unified theming API by proving that:
1. Nested token structures can be compiled efficiently through existing flat transforms
2. The JS output preserves nested access patterns for developer ergonomics
3. The CSS output remains flat and optimized (no performance penalty)
4. The approach is composable with existing StyleX features (`@media` conditionals, `CSSType`, `keyframes`)

---

## 2. Problem Statement

### 2.1 The Nesting Problem

Modern design systems organize tokens in multi-level hierarchies:

```
$designSystem
  └── component
       └── button
            └── primary
                 ├── background
                 │    ├── default: '#00FF00'
                 │    └── hovered: '#0000FF'
                 └── borderRadius
                      └── default: '8px'
```

Today, engineers must choose between poor options:

| Approach | Problem |
|----------|---------|
| Long camelCase keys: `buttonPrimaryBackgroundDefault` | Awkward Intellisense/autocomplete; no grouping |
| Many top-level files: `buttonColors.js`, `buttonBorderRadius.js` | ~(components × properties) definitions; poor discoverability |
| Flat `defineConsts` with prefixed keys | Verbose imports; no nested access |

### 2.2 The Broader Theming Problem

Beyond nesting, StyleX's theming story has several gaps identified across Meta's internal teams:

**From the MCDS RFC ([CSS Variable Scoping](https://docs.google.com/document/d/1CL5rdzEtlL5ukqJWOO46fwJikfDYtz5BqoPXa-nWMic)):**
- Color tokens lack clear naming conventions (semantic vs. literal)
- Dark/light implementations diverge per component, defeating CSS variable purpose
- Untyped CSS variables (`var(--dolly-text-white)`) fail silently on typos
- Friction when adding/updating tokens discourages proper usage

**From comet-theme-infra adoption:**
- Theme interface/implementation separation requires manual boilerplate
- `t.lightDark()` and `platforms()` are Meta-specific, not upstream in StyleX
- Flat object limitation (no `primaryBorder: { color: ..., width: ... }`)
- React Portal context loss for themed components

**From AI-readiness benchmarks ([Feb 2026 Benchmark](https://docs.google.com/document/d/1WBVjbkJ2rDYCKPVBVvgwuw9YBUxFkpKj-sB3UtKF8X0)):**
- StyleX scores **62%** vs. Tailwind **74%** on AI code generation
- Gap stems from training data availability, not API complexity
- Context files improve StyleX scores from **32% → 92%**
- Standardized token naming (like Tailwind's `bg-slate-800`) improves LLM predictability

### 2.3 Why Nested APIs Are the Right Starting Point

The nested API is the **minimum viable improvement** that:
1. Solves a concrete, frequently-requested feature (hierarchical tokens)
2. Requires zero breaking changes (new `unstable_*` exports)
3. Composes cleanly with existing APIs (conditionals, types, keyframes)
4. Lays groundwork for richer theming features (standardized token paths, theme merging)
5. Improves AI discoverability (nested paths like `tokens.button.primary.background` are self-documenting)

### 2.4 Community Evidence

The following community reports demonstrate concrete demand for nested token APIs and document pain points with the current flat structure:

| Source | Date | Issue | Relevance |
|--------|------|-------|-----------|
| [GitHub PR #1303: Nested `defineConsts` support](https://github.com/facebook/stylex/pull/1303) | Oct 2025 | External contributor `@j-malt` submitted a **working implementation** of nested `defineConsts` with fixture tests, benchmarks, and docs. Their design system uses three-tiered tokens like `$designSystem-component-button-primary-background-default`. Closed after maintainer discussion that explicitly agreed on the `unstable_*` API path (see below). | **Direct origin of this proposal.** The maintainer-agreed resolution is exactly what we're implementing. |
| [Official docs: defining-variables](https://stylexjs.com/docs/learn/theming/defining-variables) | Current | `"❌ The variables cannot be nested within another object"` — explicitly documented limitation | The limitation this proposal removes |
| [Workplace: Nested CSS Variables](https://fb.workplace.com/groups/stylexsupport/permalink/2858470277643671/) | Sept 2024 | Engineers can't compose/merge variables dynamically; `defineVars` requires static named exports. Workaround (`BaseTheme` with `VARIABLES` config) described as "old fashioned." Quote: *"This separate export implies that we can't really have some function that does a 'merge' of our params and then pass to `defineVars()`"* | Direct motivation for `defineVarsNested` |
| [Workplace: createTheme override bug](https://fb.workplace.com/groups/stylexsupport/permalink/3377892175701476/) | Jan 2026 | CSS specificity collision `(0,1,0)` between `defineVars` and `createTheme` classnames causes theme overrides to silently fail. Instagram colors worked on Workbench but were ignored on DimSum. | Reveals fragility of flat theme overrides at scale |
| [Workplace: Merge/Patch style support](https://fb.workplace.com/groups/stylexsupport/permalink/2458668030957233/) | March 2023 | *"As a component's needs for theming grows, the syntax for allowing such thing gets worse."* Request for helpers to merge styles; current per-namespace xStyle props create linear boilerplate. | Flat structures don't compose at scale |
| [GitHub #1356](https://github.com/facebook/stylex/issues/1356), ref. in [2026 blog post](https://stylexjs.com/blog/a-new-year-2026) | Jan 2026 | *"Big plans for 2026: better ergonomics, new feature work, and developer tooling"* | Nested APIs deliver directly on this public roadmap |
| StyleX Tracker (internal) | Ongoing | *"CSS ordering is a huge pain point with developers, with weekly support requests"* — 20+ support posts linked | Flat variable structures contribute to ordering complexity |
| [Modernization] StyleX APIs doc (internal) | 2025 | `defineVars` causes **browser OOM (Out of Memory) crashes** at scale. DSP sets many variables to `null` then applies values via `createTheme`. | Motivates `defineConstsNested` for static tokens that shouldn't become CSS variables |
| StyleX Tracker (internal) | Ongoing | Theme inheritance marked **P0 backlog**; `defineConsts` internally marked **P0** (*"Long requested feature"*) | Validates urgency; nested APIs enable natural theme inheritance (spread parent, override subtree) |
| [Comet Theme Infra](https://fb.workplace.com/groups/25646021618425219/permalink/1436157158021928/) | Dec 2023 | Theme Inheritance + Constants Support added via `babel-plugin-transform-dsp-macros` | Demonstrates demand for structured theme composition that flat APIs can't naturally express |

#### PR #1303: The Maintainer Discussion That Defined This Proposal

The [GitHub PR #1303](https://github.com/facebook/stylex/pull/1303) discussion is the most important piece of community evidence because the **maintainers explicitly agreed on the approach** this proposal implements:

**nmn (maintainer)** raised the concern that extending only `defineConsts` for nesting while `defineVars` cannot support it would make the APIs diverge:

> *"defineConsts is implemented almost like a special-case of defineVars. While, yes, it is possible to extend defineConsts to support this API, it feels wrong to have the two APIs diverge."*

**mellyeliu (maintainer)** agreed that nesting must be consistent across all theming APIs:

> *"If we allow nested objects for defineConsts, then we might need to rethink and rewrite defineVars and createTheme. Allowing nesting for one API but not the others may get confusing."*

The maintainers suggested `stylex.env` as an alternative, but the PR author identified two critical problems:

1. **Organizational friction**: *"We maintain a central Babel config that's shared across every package and is located pretty deep in our infra. Having design tokens located there feels awkward for design engineers who typically do not work in that part of our infrastructure."*

2. **Cache invalidation**: *"Design tokens are pretty high-churn, and having them in `stylex.env` would likely end up invalidating our build cache very frequently."*

The PR was closed with this **agreed resolution** — which is exactly what this proposal implements:

> 1. Close this PR, and keep defineConsts/defineVars as flat objects for now.
> 2. **Ship a set of unstable variants of defineVars/defineConsts/createTheme that allow for nesting.**
> 3. Eventually consider shipping a breaking change to defineVars & defineConsts to allow them to support nesting and kill off the unstable APIs.

---

## 3. Landscape Analysis

### 3.1 comet-theme-infra (Meta Internal)

**What it provides on top of raw StyleX:**

| Feature | Raw StyleX | comet-theme-infra |
|---------|------------|-------------------|
| Dark mode | Manual `@media` queries | `t.lightDark(light, dark)` helper |
| Cross-platform | Not supported | `platforms().web().ios().android()` builder |
| Type validation | Basic Flow types | Semantic types (`t.Color`, `t.Spacing`, `t.CornerRadius`) |
| Theme inheritance | Manual object spreading | Structured SoT + override pattern |
| Display modes | Manual setup | Auto/Light/Dark triplet export pattern |
| React integration | DIY | Theme Provider component |

**Architecture pattern:**
```
Theme Interface (null values + type annotations)
    → Theme SoT (actual values + helpers)
        → Theme Exports (auto/light/dark via createTheme)
            → Theme Provider (React Context wrapper)
```

**Key insight for our proposal**: comet-theme-infra demonstrates that real-world theming needs **layers of abstraction** above `defineVars`/`createTheme`. The nested API provides one such layer (token structure), but helpers like `lightDark()` and typed token annotations remain valuable and could be composed with nested tokens.

**Limitation addressed by nested APIs**: comet-theme-infra's `.alias()` workaround for nested grouping (`primaryBorderColor: t.Color.create(null).alias('primaryBorder.color')`) would be replaced by native nesting support.

### 3.2 Tailwind CSS v4 `@theme` / `@theme inline`

**How `@theme` works:**
```css
@theme {
  --color-slate-800: #1e293b;
  --radius-xl: 1rem;
  --spacing-4: 1rem;
}
```
- Variables become **both** CSS custom properties AND sources for utility class generation
- Namespace prefix determines utility type: `--color-*` → `bg-*`, `text-*`, `border-*`

**`@theme inline` — the critical innovation:**
```css
@theme inline {
  --radius-xl: 1rem;  /* NOT emitted as CSS variable */
}
/* Output: .rounded-xl { border-radius: 1rem; } — literal value */
```

| Aspect | `@theme` (default) | `@theme inline` |
|--------|--------------------|-----------------|
| Output | `var(--token-name)` | Literal value |
| Runtime theming | ✅ Yes | ❌ No |
| CSS size | Larger (var references) | Smaller |
| Performance | Extra var resolution | Direct value |

**Key insight for our proposal**: The `@theme` vs `@theme inline` distinction maps directly to StyleX's `defineVars` (CSS variables, runtime-themeable) vs `defineConsts` (compile-time constants, no CSS vars). **Nested variants of both are needed** because some tokens need runtime theming (colors that change with dark mode) while others are truly static (spacing scales, border radii).

**Token namespace mapping**: Tailwind's `--color-slate-800` → `bg-slate-800` pattern is analogous to what the `token("colors.slate.800")` exploration achieves. The nested API enables this naturally: `tokens.colors.slate[800]` accesses a specific token via dot notation.

### 3.3 `@nest/styx` Token Mapping Exploration

**From the [Designing StyleX for AI-Readiness](https://fb.workplace.com/groups/stylexfyi/permalink/2191547484947524/) post:**

```js
import { create, props, token } from "@nest/styx";

const styles = create({
  card: {
    padding: 6,
    backgroundColor: token("colors.slate.800"),
    borderRadius: token("radii.xl"),
    textStyle: token("textStyles.base"),
    fontFamily: token("fontFamilies.sans"),
    boxShadow: token("shadows.md"),
    color: token("colors.slate.100"),
  },
});
```

**Key characteristics:**
- `token()` takes a **dot-separated string path** to a pre-defined token
- Tokens are **resolved at build time** — no CSS variables emitted for `@theme inline` equivalents
- **Standardized naming** enables LLMs to generate code without project-specific context
- This is a **layer above StyleX**, not built into StyleX itself

**Relationship to nested APIs**: The `token("colors.slate.800")` string-based lookup and nested `tokens.colors.slate[800]` object access are **two syntaxes for the same underlying capability**. The nested API provides the foundational data structure; `token()` provides an alternative access pattern optimized for LLM generation.

### 3.4 `stylex.env` — Existing Token Mapping

StyleX already has a compile-time constant resolution mechanism via `stylex.env`:

```js
// babel.config.js
env: {
  tokens: {
    colors: { primary: 'blue', secondary: 'green' },
    spacing: { small: '4px', medium: '8px' },
  },
}

// Usage:
const styles = stylex.create({
  card: { color: stylex.env.tokens.colors.primary }
});
```

`stylex.env` resolves **before** StyleX compilation, making it similar to `@theme inline`. However, `stylex.env` values are per-project configuration (babel plugin options), not portable between packages. The nested `defineConsts` API provides a **package-exportable** version of this pattern.

### 3.5 XDS `defineTheme` (System-Level Theming)

XDS ([github.com/facebookexperimental/xds](https://github.com/facebookexperimental/xds)) takes a fundamentally different approach from StyleX. Rather than providing low-level primitives, `defineTheme()` bundles tokens, component overrides, dark mode, and typography into a single declaration:

```js
const ocean = defineTheme({
  name: 'ocean',
  tokens: {
    '--color-accent': ['#0077B6', '#48CAE4'],  // [light, dark] → CSS light-dark()
    '--radius-3': '16px',
  },
  components: {
    button: {
      base: { fontWeight: '600' },
      'variant:secondary': { backgroundColor: 'rgba(0,0,0,0.06)' },
    },
    card: { base: { borderWidth: '2px' } },
  },
});
```

Under the hood, XDS uses `stylex.defineVars` + `stylex.createTheme`. The nested APIs produce **identical CSS output**, making them **fully compatible** — XDS could adopt them for new theme definitions immediately after release.

**Key architectural ideas from XDS:**

| XDS Feature | Description | Relevance to Nested APIs |
|-------------|-------------|--------------------------|
| **`[light, dark]` tuples** | `['#0077B6', '#48CAE4']` compiles to CSS `light-dark()` — browser handles mode switching | Future enhancement: support tuple syntax inside `defineVarsNested`. Bridgeable today via `lightDark()` helper |
| **Three-tier token architecture** | Primitives → Semantics → Components, each tier references the one above | Maps directly: `defineConstsNested` (primitives) → `defineVarsNested` (semantics) → `createThemeNested` (overrides) |
| **CSS `@scope` containment** | `@scope([data-xds-theme]) to ([data-xds-theme])` prevents theme bleed | Works on same CSS variables — compatible regardless of flat/nested definition |
| **CSS `@layer` ordering** | `@layer xds.reset, xds.typography, xds.base, xds.theme` | StyleX already has `useLayers` support; nested APIs don't affect layer behavior |
| **~80 semantic tokens** | Intentionally minimal (vs. Ant Design's 500+) | Nested structure improves discoverability, reducing need for many tokens |
| **No React Context** | Themes compile to pure CSS — RSC compatible, no Portal issues | Nested APIs produce same CSS; don't change the runtime theming model |

**XDS's three-tier architecture expressed with nested APIs:**
```js
// Tier 1: Primitives — static, no CSS vars
const primitives = stylex.unstable_defineConstsNested({
  blue: { 500: '#0077B6', 600: '#005F99' },
  gray: { 100: '#F1F5F9', 900: '#0F172A' },
});

// Tier 2: Semantics — themeable, CSS vars
export const tokens = stylex.unstable_defineVarsNested({
  color: {
    action: { primary: primitives.blue[500] },
    background: { default: primitives.gray[100] },
    text: { primary: primitives.gray[900] },
  },
});

// Tier 3: Component overrides
export const cardTheme = stylex.unstable_createThemeNested(tokens, {
  color: { background: { default: '#FFFFFF' } },
});
```

**Key insight for our proposal**: XDS validates that a **three-tier token architecture** is the right design for production systems. The nested APIs make this architecture expressible natively in StyleX without requiring XDS's full opinionated system. The one ergonomic gap — `[light, dark]` tuple syntax for dark mode — is solvable with a helper function today and could become a native StyleX feature later.

---

## 4. Proposed API Design

### 4.1 Core APIs

#### `stylex.unstable_defineVarsNested(nestedObj)`

Creates CSS custom properties from a nested token object. Leaf values become CSS variables; namespace objects become nested access paths.

```js
// tokens.stylex.js
export const tokens = stylex.unstable_defineVarsNested({
  button: {
    primary: {
      background: '#00FF00',
      color: {
        default: 'blue',
        '@media (prefers-color-scheme: dark)': 'lightblue',
      },
    },
    secondary: {
      background: '#CCCCCC',
    },
  },
  input: {
    fill: '#FFFFFF',
    border: '#000000',
  },
});

// JS Output:
// tokens.button.primary.background → "var(--xHash1)"
// tokens.button.primary.color → "var(--xHash2)"
// tokens.button.secondary.background → "var(--xHash3)"
// tokens.input.fill → "var(--xHash4)"
// tokens.input.border → "var(--xHash5)"
// tokens.__varGroupHash__ → "xGroupHash"

// CSS Output:
// :root, .xGroupHash{--xHash1:#00FF00;--xHash2:blue;--xHash3:#CCCCCC;--xHash4:#FFFFFF;--xHash5:#000000;}
// @media (prefers-color-scheme: dark){:root, .xGroupHash{--xHash2:lightblue;}}
```

**Leaf detection rule**: A value is a leaf if it's:
- A string or number (simple value)
- A `CSSType` instance (e.g., `stylex.types.color(...)`)
- An object **with a `default` key** (conditional @-rule value)

An object **without a `default` key** is treated as a namespace and recursively flattened.

#### `stylex.unstable_defineConstsNested(nestedObj)`

Creates compile-time constants from a nested object. **No CSS variables emitted.** Values are inlined at build time.

```js
// tokens.stylex.js
export const tokens = stylex.unstable_defineConstsNested({
  colors: {
    slate: { 800: '#1e293b', 100: '#f1f5f9' },
    brand: { primary: '#3b82f6' },
  },
  radii: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '1rem' },
  spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
});

// JS Output: same nested object with original values
// tokens.colors.slate[800] → '#1e293b'
// tokens.radii.xl → '1rem'

// CSS Output: none (compile-time constants)
```

This is the **`@theme inline` equivalent** — tokens that don't need runtime theming are inlined, producing smaller CSS.

#### `stylex.unstable_createThemeNested(varsObj, overridesObj)`

Creates a theme override for a nested var group.

```js
import { tokens } from './tokens.stylex.js';

const darkTheme = stylex.unstable_createThemeNested(tokens, {
  button: {
    primary: {
      background: '#004400',
      color: 'white',
    },
  },
  input: {
    fill: '#1a1a1a',
    border: '#444444',
  },
});

// Output: { [varGroupHash]: "overrideClass varGroupHash", $$css: true }
// CSS: .overrideClass, .overrideClass:root{--xHash1:#004400;--xHash2:white;--xHash4:#1a1a1a;--xHash5:#444444;}
```

### 4.2 How It Composes with Existing Features

**With conditional @-rules:**
```js
stylex.unstable_defineVarsNested({
  button: {
    primary: {
      background: {
        default: '#00FF00',
        '@media (prefers-color-scheme: dark)': '#004400',
        '@supports (color: oklch(0 0 0))': 'oklch(0.8 0.2 145)',
      },
    },
  },
});
```

**With `stylex.types.*` (CSSType):**
```js
stylex.unstable_defineVarsNested({
  button: {
    primary: {
      background: stylex.types.color({
        default: '#00FF00',
        '@media (prefers-color-scheme: dark)': '#004400',
      }),
    },
  },
});
```

**With `keyframes`:**
```js
stylex.unstable_defineVarsNested({
  animation: {
    fadeIn: stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } }),
    slideIn: stylex.keyframes({ from: { transform: 'translateY(10px)' }, to: { transform: 'translateY(0)' } }),
  },
});
```

**With `stylex.env` (for project-level configuration):**
```js
// Babel config provides project-specific overrides
const tokens = stylex.unstable_defineVarsNested({
  brand: {
    primary: stylex.env.brandColor ?? '#3b82f6',
    secondary: stylex.env.secondaryColor ?? '#64748b',
  },
});
```

---

## 5. Comparison of Approaches

### 5.1 Feature Matrix

| Feature | Flat `defineVars` | Nested `defineVarsNested` | `defineConsts` (flat) | Nested `defineConstsNested` | `@nest/styx` `token()` | Tailwind `@theme` | `stylex.env` |
|---------|-------------------|--------------------------|----------------------|----------------------------|------------------------|-------------------|-------------|
| Hierarchical access | ❌ | ✅ | ❌ | ✅ | ✅ (string paths) | ✅ (CSS var names) | ✅ |
| CSS variables emitted | ✅ | ✅ | ❌ | ❌ | Configurable | `@theme` yes, `inline` no | ❌ |
| Runtime themeable | ✅ | ✅ | ❌ | ❌ | Configurable | `@theme` yes, `inline` no | ❌ |
| Package-exportable | ✅ | ✅ | ✅ | ✅ | ❌ (layer above) | N/A | ❌ (config only) |
| Type-safe | ✅ (Flow/TS) | ✅ (Flow/TS) | ✅ | ✅ | ❌ (strings) | ❌ | ❌ |
| AI-friendly | Medium | High (self-documenting paths) | Medium | High | Very high (standardized) | Very high | Medium |
| Conditional (@media) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ (`@theme dark`) | ❌ |

### 5.2 When to Use What

| Scenario | Recommended API |
|----------|----------------|
| Runtime-themeable tokens (colors, dark mode) | `unstable_defineVarsNested` |
| Static design tokens (spacing, radii, typography) | `unstable_defineConstsNested` |
| Overriding a nested theme (brand customization) | `unstable_createThemeNested` |
| Standardized LLM-friendly token access | `token()` built on `defineConstsNested` |
| Project-level compile-time config | `stylex.env` |
| Per-component CSS variable scoping | `defineVars` (flat, single component) |

### 5.3 Nested APIs vs. `token()` String Paths

These are **complementary, not competing** approaches:

```js
// Nested API — type-safe, IDE-friendly, package-exportable
import { tokens } from './design-system.stylex.js';
backgroundColor: tokens.colors.slate[800],

// token() — LLM-friendly, standardized, string-based
backgroundColor: token("colors.slate.800"),
```

The nested API provides the **underlying data structure**. A `token()` helper can be built on top that looks up values from a nested `defineConstsNested` result by string path. This means `token()` doesn't need its own compiler transform — it can be a simple compile-time function that indexes into the nested object.

---

## 6. Interaction with Existing Explorations

### 6.1 Relationship to "Designing StyleX for AI-Readiness"

The three pillars from the [AI-Readiness post](https://fb.workplace.com/groups/stylexfyi/permalink/2191547484947524/):

| Pillar | How Nested APIs Interact |
|--------|--------------------------|
| **Tailwind-to-StyleX plugin** | Nested tokens provide the target structure for Tailwind theme migration. `--color-slate-800` naturally maps to `tokens.colors.slate[800]` |
| **Utility styles (atoms)** | Atoms can reference nested tokens: `style.backgroundColor(tokens.colors.brand.primary)` |
| **Token-first abstraction (`@nest/styx`)** | `token("colors.slate.800")` can be implemented as a thin wrapper over `defineConstsNested` output, removing the need for a separate compiler transform |

### 6.2 Relationship to comet-theme-infra

| comet-theme-infra Pattern | How Nested APIs Help |
|---------------------------|---------------------|
| Theme Interface (null values) | `defineVarsNested({ button: { primary: { background: null } } })` — defines the schema |
| Theme SoT (actual values) | `createThemeNested(vars, { button: { primary: { background: '#00FF00' } } })` — fills in values |
| `t.lightDark()` helper | Composes naturally: `background: { default: light, '@media (prefers-color-scheme: dark)': dark }` within nested structure |
| `.alias('primaryBorder.color')` workaround | **Eliminated** — native nesting replaces the alias pattern |
| Auto/Light/Dark triplet | Each mode becomes a `createThemeNested` call with nested overrides |

### 6.3 Relationship to MCDS CSS Variable Scoping RFC

The [MCDS RFC](https://docs.google.com/document/d/1CL5rdzEtlL5ukqJWOO46fwJikfDYtz5BqoPXa-nWMic) proposes replacing `var(--dolly-text-primary)` strings with typed `mcdsColorVars.textPrimary`. Nested APIs extend this:

```js
// Before: untyped, flat, string-based
color: 'var(--dolly-text-primary)',

// After (flat defineVars): typed, flat
color: mcdsColorVars.textPrimary,

// After (nested defineVarsNested): typed, hierarchical, self-documenting
color: mcdsVars.text.primary,
```

The hierarchical structure makes the token taxonomy **explicit and navigable**, addressing the RFC's concern about "unclear naming conventions" and "friction when adding/updating tokens."

### 6.4 Relationship to AI Benchmarking

From the [Feb 2026 Benchmark](https://docs.google.com/document/d/1WBVjbkJ2rDYCKPVBVvgwuw9YBUxFkpKj-sB3UtKF8X0):
- StyleX scores 62% vs Tailwind 74% on AI generation
- Context files improve StyleX from 32% → 92%

Nested APIs improve AI-friendliness by:
1. **Self-documenting paths**: `tokens.colors.brand.primary` is more discoverable than `tokenColorBrandPrimary`
2. **Structural autocomplete**: LLMs can explore token trees via IDE-style completion
3. **Standardizable naming**: Nested structure enables a canonical token taxonomy (like Tailwind's `--color-*`, `--radius-*` namespace convention)
4. **Smaller context needed**: Instead of listing all flat tokens, provide the nested structure once

### 6.5 Relationship to XDS `defineTheme`

XDS's `defineTheme` is a **system-level abstraction** that bundles tokens, component overrides, dark mode, and typography into one call. Under the hood, it uses `stylex.defineVars` + `stylex.createTheme`. The nested APIs produce **identical CSS output**, making them **fully drop-in compatible**.

**What XDS gains from nested APIs:**

| XDS Component | Change Needed | Breaking? |
|---|---|---|
| Token definitions | Switch from flat CSS var name strings to `defineVarsNested` | No — CSS output is identical |
| `defineTheme()` function | Accept nested `VarGroup` for `tokens` field (additive) | No |
| Theme overrides | Use `createThemeNested` for nested tokens | No — output is the same |
| Component `@scope` CSS | No change — scoping works on same CSS variables | N/A |
| `@layer` ordering | No change — layers don't care how variables were defined | N/A |
| Theme provider | No change — applies className from createTheme/createThemeNested | N/A |

**XDS's three-tier architecture maps directly:**
- **Primitives** (raw values, private) → `unstable_defineConstsNested` (no CSS vars, smaller output)
- **Semantics** (design intent, public) → `unstable_defineVarsNested` (CSS vars, themeable)
- **Components** (per-component overrides) → `unstable_createThemeNested`

**One ergonomic gap — `[light, dark]` tuples:**

XDS uses `['#0077B6', '#48CAE4']` arrays that compile to CSS `light-dark()`. Our nested APIs use the more verbose `{ default: '...', '@media (prefers-color-scheme: dark)': '...' }` syntax. Bridgeable today via a `lightDark()` helper function; could become native StyleX syntax later.

**Key insight**: The nested APIs sit between StyleX's raw primitives and XDS's full opinionated system. They add structure to the primitives without imposing XDS's design decisions — but XDS can adopt them immediately to express its three-tier architecture natively.

---

## 7. Implementation Strategy

### 7.1 Technical Approach

The core insight: **nested APIs are thin wrappers around existing flat transforms**.

```
User Input (nested) → Flatten → Existing Transform → Unflatten JS Output
                                                   → CSS Output (already flat)
```

**Flatten algorithm:**
```js
flattenNestedConfig({ button: { primary: { background: '#00FF00' } } })
// → { 'button.primary.background': '#00FF00' }
```

**Leaf detection**: Object with `default` key → conditional value (pass through). Object without `default` key → namespace (recurse and flatten).

**Unflatten algorithm:**
```js
unflattenObject({ 'button.primary.background': 'var(--xHash)' })
// → { button: { primary: { background: 'var(--xHash)' } } }
```

### 7.2 File Changes

**New files (7):**
| File | Purpose |
|------|---------|
| `shared/stylex-nested-utils.js` | `flattenNestedConfig()`, `unflattenObject()`, types |
| `shared/stylex-define-vars-nested.js` | Flatten → `styleXDefineVars` → unflatten |
| `shared/stylex-define-consts-nested.js` | Flatten → `styleXDefineConsts` → unflatten |
| `shared/stylex-create-theme-nested.js` | Flatten both args → `styleXCreateTheme` |
| `visitors/stylex-define-vars-nested.js` | Babel visitor (modeled on `stylex-define-vars.js`) |
| `visitors/stylex-define-consts-nested.js` | Babel visitor (modeled on `stylex-define-consts.js`) |
| `visitors/stylex-create-theme-nested.js` | Babel visitor (modeled on `stylex-create-theme.js`) |

**Modified files (7):**
| File | Change |
|------|--------|
| `shared/index.js` | Export new shared functions |
| `utils/state-manager.js` | Add 3 new `Set<string>` import tracking fields |
| `visitors/imports.js` | Detect `unstable_defineVarsNested` etc. in imports/requires |
| `index.js` | Route new API calls to visitors |
| `stylex/src/stylex.js` | Public API stubs + `_legacyMerge` + `IStyleX` type |
| `stylex/src/types/StyleXTypes.js` | Flow type definitions |
| `stylex/src/types/StyleXTypes.d.ts` | TypeScript type definitions |

### 7.3 Rollout Strategy

1. **Phase 1 (this proposal)**: Ship `unstable_*` APIs behind the `unstable_` prefix. No breaking changes. Teams can opt-in.
2. **Phase 2**: Gather feedback from early adopters (MCDS, comet-theme-infra consumers). Validate AI benchmark improvements.
3. **Phase 3**: If validated, promote to stable APIs (`defineVarsNested` → potentially merge into `defineVars` with nested detection).
4. **Phase 4**: Build `token()` helper on top of `defineConstsNested` for the `@nest/styx` use case.

---

## 8. Open Questions & Future Work

### 8.1 Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Key separator in CSS var names | `.` (dot) → `_` (underscore) in CSS | Use `.` internally, `_` in CSS names (existing sanitization handles this) |
| Should `default` be disallowed as a namespace key? | Yes (conflict with conditional detection) / No (use alternate detection) | Yes — `default` as namespace key would be ambiguous |
| Should nested APIs support partial theme overrides? | Full override (all leaves required) / Partial (only override what you need) | Partial — `createThemeNested` should allow overriding specific branches |
| Should `defineConstsNested` support conditional values? | Yes (with `@media` objects) / No (truly static only) | No — constants are static by definition. Use `defineVarsNested` for conditionals |

### 8.2 Future Directions

**Short-term (builds on nested APIs):**
- `token()` helper function that indexes into `defineConstsNested` output by string path
- `lightDark()` / `darkMode()` helper that generates `{ default: light, '@media (prefers-color-scheme: dark)': dark }` within nested structures
- Typed token annotations (analogous to comet-theme-infra's `t.Color`, `t.Spacing`)

**Medium-term (unified theming layer):**
- Theme merging/composition: deep-merge two nested theme objects
- Theme inheritance: define a base theme and extend it (spread + override specific branches)
- Selective variable emission: per-branch `inline: true` to mix CSS vars and inlined values in one definition

**Long-term (AI-native theming):**
- Canonical token taxonomy: standardized naming like Tailwind (`colors.*`, `spacing.*`, `radii.*`)
- Auto-generated documentation from nested token structures
- IDE/LLM autocomplete over token paths (leveraging TypeScript inference on nested types)
- Benchmark improvements: measure AI generation quality with nested vs. flat token definitions

---

## Appendix A: Detailed Comparison with Tailwind @theme

| Tailwind v4 | StyleX Equivalent | Notes |
|-------------|-------------------|-------|
| `@theme { --color-primary: blue; }` | `defineVarsNested({ colors: { primary: 'blue' } })` | Both emit CSS variables |
| `@theme inline { --radius-xl: 1rem; }` | `defineConstsNested({ radii: { xl: '1rem' } })` | Both inline values, no CSS vars |
| `@theme dark { --color-bg: #111; }` | `createThemeNested(tokens, { colors: { bg: '#111' } })` | Both create theme overrides |
| `bg-primary` utility class | `styles.card { backgroundColor: tokens.colors.primary }` | Tailwind has utility classes; StyleX has explicit property access |
| `--color-slate-800` namespace | `tokens.colors.slate[800]` nested path | Same hierarchy, different syntax |

## Appendix B: Detailed Comparison with comet-theme-infra

| comet-theme-infra Pattern | Nested API Equivalent |
|---------------------------|-----------------------|
| `t.lightDark(light, dark)` | `{ default: light, '@media (prefers-color-scheme: dark)': dark }` inside nested object |
| `t.Color.create(null).alias('border.color')` | `defineVarsNested({ border: { color: null } })` — native nesting |
| Theme interface file (null values) | `defineVarsNested({ button: { bg: null } })` — null leaves define schema |
| Theme SoT file (actual values) | `createThemeNested(vars, { button: { bg: '#FFF' } })` — fills in values |
| `CDSThemes = { auto, light, dark }` | Three `createThemeNested` calls with nested overrides |

## Appendix C: How token() Could Be Built on Nested APIs

```js
// Design system definition (package-exportable)
export const designTokens = stylex.unstable_defineConstsNested({
  colors: {
    slate: { 100: '#f1f5f9', 800: '#1e293b' },
    brand: { primary: '#3b82f6' },
  },
  radii: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '1rem' },
  shadows: { sm: '0 1px 2px rgba(0,0,0,0.05)', md: '0 4px 6px rgba(0,0,0,0.1)' },
});

// token() as a thin compile-time helper (could be a babel macro):
function token(path) {
  return path.split('.').reduce((obj, key) => obj[key], designTokens);
}

// Usage — both syntaxes resolve to the same value at build time:
const styles = stylex.create({
  card: {
    backgroundColor: designTokens.colors.slate[800],       // Object access
    borderRadius: token("radii.xl"),                         // String path
    color: designTokens.colors.slate[100],                   // Object access
  },
});
```

This demonstrates that `token()` does not need a separate compiler transform — it's a **userland utility** that indexes into the nested const output. The Babel plugin resolves `designTokens.colors.slate[800]` statically during compilation.

## Appendix D: Detailed Comparison with XDS `defineTheme`

| XDS `defineTheme` Pattern | Nested API Equivalent | Notes |
|---------------------------|-----------------------|-------|
| `tokens: { '--color-accent': ['#0077B6', '#48CAE4'] }` | `color: { accent: { default: '#0077B6', '@media (...)': '#48CAE4' } }` | XDS tuple syntax is more concise; future: native tuple support |
| `tokens: { '--radius-3': '16px' }` | `radii: { 3: '16px' }` | Same concept, nested structure adds hierarchy |
| Primitives tier (raw values, private) | `unstable_defineConstsNested` (no CSS vars, smaller output) | Both avoid emitting CSS variables for static values |
| Semantics tier (design intent, public) | `unstable_defineVarsNested` (CSS vars, themeable) | Both emit CSS custom properties |
| Component tier (per-component overrides) | `unstable_createThemeNested` | Both generate override classNames |
| `components: { button: { base: {...} } }` | Not built-in (handled separately via `stylex.create`) | XDS bundles component styles; StyleX keeps them separate |
| CSS `@scope` containment | Compatible — works on same CSS variables | Nested APIs don't affect scoping behavior |
| CSS `@layer` ordering | Compatible — StyleX already has `useLayers` | Nested APIs don't affect layer behavior |
| `light-dark()` CSS function | Not yet native — `lightDark()` helper bridges the gap | Future enhancement candidate |
| `color-scheme` property toggle | Same — works with both flat and nested CSS vars | Browser-level, independent of token definition method |
| No React Context needed (RSC compatible) | Same CSS output — doesn't change runtime model | Nested APIs are compile-time only |
| `[data-xds-theme]` attribute | Same — `createThemeNested` output applies as className | Theme application mechanism is unchanged |

**XDS adoption path:**
1. **Immediate**: XDS can use `defineVarsNested` for token schema definitions — CSS output is identical
2. **Short-term**: `defineTheme()` accepts nested `VarGroup` for `tokens` field (additive change)
3. **Medium-term**: XDS's three-tier architecture (Primitives → Semantics → Components) expressed natively via `defineConstsNested` → `defineVarsNested` → `createThemeNested`
4. **Long-term**: If StyleX adds `[light, dark]` tuple syntax, XDS can simplify its `light-dark()` compilation step
