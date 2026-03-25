# Nesting Design Tokens in StyleX: What, Why, and Where This Goes

**TL;DR**: We're adding `unstable_defineVarsNested`, `unstable_defineConstsNested`, and `unstable_createThemeNested` to StyleX. They let you define design tokens as nested objects instead of flat key-value pairs. Under the hood, the compiler flattens them into the same CSS it already generates — zero performance cost. This isn't just about ergonomics; it's the foundation for a better theming story across the board, from comet-theme-infra to the `token()` exploration to AI-generated code.

---

## The problem, in plain English

If you work on a design system, your tokens probably look something like this in Figma:

```
Button
  └── Primary
       ├── Background → default: green, hovered: blue
       └── Border Radius → 8px
  └── Secondary
       └── Background → gray
Input
  └── Fill → white
  └── Border → black
```

Now try expressing that in StyleX today. Your options aren't great:

**Option A: Smash it all into one flat object.** You end up with keys like `buttonPrimaryBackgroundDefault`. Autocomplete becomes useless — you start typing `button` and get 47 suggestions. People inevitably typo the key names. LLMs hallucinate them constantly.

**Option B: Split into many files.** `buttonColors.js`, `buttonBorderRadius.js`, `inputColors.js`... You need roughly (number of components) × (number of properties) separate `defineConsts` calls. Nobody can find anything. Import statements are a mile long.

Neither option feels right. You just want to write this:

```js
export const tokens = stylex.unstable_defineVarsNested({
  button: {
    primary: {
      background: {
        default: '#00FF00',
        hovered: '#0000FF',
      },
      borderRadius: '8px',
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
```

And then use it like `tokens.button.primary.background.default` with full type safety and autocomplete.

That's what this proposal gives you.

---

## This isn't a theoretical problem

Real engineers have been hitting these walls. Here's a sample of what we've seen across the StyleX community:

**An external contributor literally built this and submitted a PR.** ([GitHub PR #1303](https://github.com/facebook/stylex/pull/1303), Oct 2025) — `@j-malt` submitted a working implementation of nested `defineConsts` support. Their design system uses three-tiered tokens like `$designSystem-component-button-primary-background-default` and needed nested objects. The PR had fixture tests, benchmark results, and documentation changes. It was closed after a productive discussion where the **maintainers explicitly agreed on the path forward**:

> **nmn (maintainer)**: *"defineConsts is implemented almost like a special-case of defineVars. While, yes, it is possible to extend defineConsts to support this API, it feels wrong to have the two APIs diverge."*
>
> **mellyeliu (maintainer)**: *"If we allow nested objects for defineConsts, then we might need to rethink and rewrite defineVars and createTheme. Allowing nesting for one API but not the others may get confusing."*

The maintainers suggested `stylex.env` as an alternative, but the PR author pushed back with two strong arguments: (1) design tokens shouldn't live in a Babel config that's "located pretty deep in our infra" away from design engineers, and (2) tokens are high-churn, so putting them in `stylex.env` would frequently invalidate the entire build cache.

The agreed resolution was exactly what this proposal implements:
1. Keep defineConsts/defineVars flat for now
2. **Ship unstable variants (`unstable_defineVarsNested`, `unstable_defineConstsNested`, `unstable_createThemeNested`) that allow nesting**
3. Eventually consider a breaking change to make nesting native in the base APIs

**The official docs literally say "Not Allowed."** From the [defining variables](https://stylexjs.com/docs/learn/theming/defining-variables) page:

```tsx
// ❌ - The variables cannot be nested within another object
export const colors = {
  foregrounds: stylex.defineVars({ /* ... */ }),
  backgrounds: stylex.defineVars({ /* ... */ }),
};
```

That's the documented limitation this proposal removes.

**"How do I nest CSS variables?"** ([Workplace, Sept 2024](https://fb.workplace.com/groups/stylexsupport/permalink/2858470277643671/)) — Engineers trying to pass variables through component trees and override them at different levels. The workaround? A "BaseTheme wrapper with VARIABLES config" described as **"a bit more old fashioned."** The core frustration: `defineVars` requires named exports in `.stylex.js` files, so you can't dynamically compose variable sets. One engineer put it plainly:

> *"This separate export implies that we can't really have some function that does a 'merge' of our params and then pass to `defineVars()`"*

**"`createTheme` doesn't correctly override `defineVars`"** ([Workplace, Jan 2026](https://fb.workplace.com/groups/stylexsupport/permalink/3377892175701476/)) — The MCDS team found that `defineVars` and `createTheme` classnames can have identical CSS specificity `(0,1,0)`, causing theme overrides to **silently fail** depending on load order. Instagram colors worked on Workbench but were ignored on DimSum. This reveals the fragility of flat theme overrides — specificity issues are harder to debug when you have many unstructured variables.

**"As a component's needs for theming grows, the syntax gets worse"** ([Workplace, March 2023](https://fb.workplace.com/groups/stylexsupport/permalink/2458668030957233/)) — A request for style merging helpers. The current approach of passing individual `xStyle` props per element creates boilerplate that scales linearly with theming complexity. Nested structures would let you pass a single themed token tree instead of N separate props.

**"CSS ordering is a huge pain point"** (StyleX Tracker, internal) — Cited as generating **weekly support requests**. 20+ support posts linked. Flat variable structures contribute to ordering complexity because there's no hierarchy to reason about.

**`defineVars` causing browser OOM at scale** ([Modernization] StyleX APIs doc, internal) — Emitting CSS variables for tokens that never change (spacing, radii) wastes memory and has caused **Out of Memory crashes**. DSP has had to set many variables to `null` then apply values via `createTheme`. This is exactly why we need `defineConstsNested` alongside `defineVarsNested` — static tokens should be inlined, not turned into CSS variables.

**Theme inheritance was marked P0** (StyleX Tracker, internal) — DSP marked theme inheritance and `defineConsts` support as P0 backlog items. Flat structures make inheritance hard because you can't naturally express "inherit everything from parent, override this branch." Nested APIs make this trivial: spread the parent, override a subtree.

**"Big plans for 2026"** ([GitHub #1356](https://github.com/facebook/stylex/issues/1356), referenced in [blog post](https://stylexjs.com/blog/a-new-year-2026)) — The StyleX team's public roadmap calls out "better ergonomics, new feature work, and developer tooling." The nested APIs deliver directly on the first two.

---

## How it works (the short version)

The compiler sees your nested object, flattens it into dot-separated keys (`button.primary.background` → `'#00FF00'`), passes those into the *existing* `styleXDefineVars` transform, then unflattens the JS output back into a nested object with `var(--hash)` references at the leaves.

The CSS output is exactly what `defineVars` already produces — flat `:root` declarations. No new runtime. No extra CSS. Just a nicer way to organize the input.

The trick is distinguishing "this is a namespace object, keep flattening" from "this is an actual value, stop here." The rule is simple:

- **String or number?** That's a leaf value. Stop.
- **Object with a `default` key?** That's a conditional value (like `{ default: 'blue', '@media (prefers-color-scheme: dark)': 'lightblue' }`). Stop.
- **Object without a `default` key?** That's a namespace. Keep recursing.

This means `@media` queries and conditional values compose naturally inside nested structures — you don't lose any existing functionality.

---

## Wait, why three APIs?

Same reason we have both `defineVars` and `defineConsts` today.

**Some tokens change at runtime** — colors that flip for dark mode, brand colors that get overridden per-tenant. These need CSS variables so `createTheme` can override them. → `unstable_defineVarsNested`

**Some tokens are truly static** — spacing scales (`4px`, `8px`, `16px`), border radii (`0.25rem`, `0.5rem`), font sizes. They never change. Emitting CSS variables for these is wasted bytes. → `unstable_defineConstsNested`

**And you need to be able to override the first kind.** → `unstable_createThemeNested`

This maps almost 1:1 to what Tailwind v4 does:
- `@theme { ... }` = CSS variables, runtime-changeable = our `defineVarsNested`
- `@theme inline { ... }` = no CSS variables, values baked in = our `defineConstsNested`

Tailwind figured out this split matters. We already have it. We just need nested versions of both.

---

## What we learned from looking around

### comet-theme-infra (what Meta uses today)

comet-theme-infra sits on top of StyleX and adds really useful stuff: `t.lightDark(light, dark)` for dark mode, `platforms().web().ios()` for cross-platform tokens, semantic types like `t.Color` and `t.Spacing`.

But it has a limitation that keeps coming up: **everything has to be flat.** If you want to group related tokens, you use this awkward `.alias()` workaround:

```js
primaryBorderColor: t.Color.create(null).alias('primaryBorder.color'),
```

With nested APIs, this becomes natural:

```js
border: {
  color: null,  // defines the schema slot
}
```

The nested API doesn't replace comet-theme-infra — it removes one of its biggest friction points.

### Tailwind v4's `@theme`

Tailwind v4 moved from JavaScript config files to CSS-native `@theme` blocks. The key insight we're borrowing:

Tokens are organized by **namespace**. `--color-slate-800` tells Tailwind "this is a color, generate `bg-slate-800`, `text-slate-800`." The prefix IS the taxonomy.

Our nested APIs express the same thing through object structure: `tokens.colors.slate[800]`. Same hierarchy, different syntax. The difference is that ours gives you TypeScript inference and IDE autocomplete for free — you don't have to memorize hyphenated CSS variable names.

#### A quick aside: "nesting" means two different things

If you Google "Tailwind nesting" you'll find that Tailwind v4 supports **CSS rule nesting** — the native browser spec where you nest selectors inside selectors:

```css
.card {
  background: white;
  & .title { font-size: 1.5rem; }
  &:hover { background: gray; }
  @media (min-width: 768px) { padding: 2rem; }
}
```

That's selector nesting. It's a CSS language feature, and Tailwind gets it for free because its v4 engine processes modern CSS directly.

What we're talking about is **token nesting** — organizing design tokens in a hierarchical object structure. And here, Tailwind's `@theme` is actually **flat**. The hierarchy is encoded in the variable name, not in the structure:

```css
@theme {
  /* Flat! The hierarchy is in the name. */
  --color-slate-100: #f1f5f9;
  --color-slate-800: #1e293b;
  --color-brand-primary: #3b82f6;
  --radius-xl: 1rem;
}

/* You CANNOT write this in Tailwind: */
@theme {
  --color: {
    slate: {
      100: #f1f5f9;
      800: #1e293b;
    }
  }
}
/* ❌ Not valid */
```

Tailwind relies on you (and LLMs) knowing the naming convention. If you type `--color-slatee-800` (double "e"), there's no error — it just silently creates a new, unused token.

Our nested APIs make the hierarchy **explicit in the structure**:

```js
const tokens = stylex.unstable_defineVarsNested({
  colors: {
    slate: {
      100: '#f1f5f9',
      800: '#1e293b',
    },
  },
  radii: {
    xl: '1rem',
  },
});
```

When you type `tokens.colors.` your editor shows `slate` and `brand`. When you type `tokens.colors.slate.` it shows `100` and `800`. Try to access `tokens.colors.slatee` and TypeScript yells at you. That's a real difference — convention-based hierarchy (Tailwind) vs. structure-based hierarchy (our proposal).

| Kind of Nesting | Tailwind v4 | StyleX (proposed) |
|---|---|---|
| **CSS selector nesting** (`& .child {}`) | ✅ Native CSS spec | N/A (StyleX generates atomic classes) |
| **Token/theme nesting** (hierarchical object) | ❌ Flat `--name-name-name` naming convention | ✅ Real nested objects with type safety |

### XDS's `defineTheme` (the system-level approach)

In XDS `defineTheme()` bundles *everything* about a theme into one call — tokens, component overrides, dark mode:

```js
const ocean = defineTheme({
  name: 'ocean',
  tokens: {
    '--color-accent': ['#0077B6', '#48CAE4'],  // [light, dark] tuple
    '--radius-3': '16px',
  },
  components: {
    button: {
      base: { fontWeight: '600' },
      'variant:secondary': { backgroundColor: 'rgba(0,0,0,0.06)' },
    },
  },
});
```

Under the hood, XDS still uses `stylex.defineVars` + `stylex.createTheme`, but it layers a lot on top.

**The `[light, dark]` tuple is dramatically better than what we have.** Compare:

```js
// XDS — clean
'--color-accent': ['#0077B6', '#48CAE4']
// Compiles to CSS: --color-accent: light-dark(#0077B6, #48CAE4);

// StyleX today — verbose
color: {
  default: '#0077B6',
  '@media (prefers-color-scheme: dark)': '#48CAE4',
}
```

XDS compiles the tuple to CSS's native `light-dark()` function — the browser handles mode switching, no JavaScript needed. We could support this as shorthand inside `defineVarsNested` in a future enhancement. For now, a `lightDark()` helper function (like comet-theme-infra's `t.lightDark()`) bridges the gap.

**XDS organizes tokens in three tiers.** Primitives (`blue-500`) → Semantics (`color-action-primary`) → Components (`button-cta-bg`). Each tier references the one above. This maps perfectly to our nested APIs:

```js
// Tier 1: Primitives — static, no CSS vars (defineConstsNested)
const primitives = stylex.unstable_defineConstsNested({
  blue: { 500: '#0077B6', 600: '#005F99' },
  gray: { 100: '#F1F5F9', 900: '#0F172A' },
});

// Tier 2: Semantics — themeable, CSS vars (defineVarsNested)
export const tokens = stylex.unstable_defineVarsNested({
  color: {
    action: { primary: primitives.blue[500] },
    background: { default: primitives.gray[100] },
    text: { primary: primitives.gray[900] },
  },
});

// Tier 3: Component overrides (createThemeNested)
export const cardTheme = stylex.unstable_createThemeNested(tokens, {
  color: { background: { default: '#FFFFFF' } },
});
```

That's XDS's exact architecture expressed natively in StyleX.

**XDS uses CSS `@scope` to prevent theme bleed.** This is the elegant answer to the React Portal problem that comet-theme-infra struggles with. When themes are applied via `data-xds-theme` attributes and scoped with `@scope`, they work regardless of React's component tree:

```css
@scope([data-xds-theme="ocean"]) to ([data-xds-theme]) {
  .xds-button.primary { background-color: var(--color-accent); }
}
```

No Context forwarding needed. The nested APIs don't solve this directly, but they don't block it either — `@scope` works on the same CSS variables regardless of whether they came from flat `defineVars` or nested `defineVarsNested`.

**XDS keeps to ~80 semantic tokens intentionally** (vs. Ant Design's 500+). The philosophy: fewer well-named tokens with clear hierarchy beats hundreds of specific ones. The nested structure helps here — the tree makes each token discoverable, so you need fewer of them.

**XDS themes are pure CSS — no React Context needed.** This makes them RSC-compatible and avoids the Portal problem entirely. Our nested APIs don't change this equation (they produce the same CSS), but they do make it easier to *define* the tokens that feed into XDS's CSS-based theming.

The bottom line: our nested APIs are **fully compatible with XDS**. They produce identical CSS output. XDS could start using them for new theme definitions immediately after release. The three-tier architecture (primitives as `defineConstsNested`, semantics as `defineVarsNested`, component overrides as `createThemeNested`) maps directly to what XDS already wants conceptually but can't express structurally today.

| | StyleX (today) | Nested APIs (proposed) | XDS defineTheme |
|---|---|---|---|
| **Level** | Low-level primitives | Structured primitives | Complete system |
| **Token structure** | Flat only | Nested objects | Flat CSS var names |
| **Dark mode** | Manual `@media` objects | Manual (future: tuples) | `[light, dark]` → `light-dark()` |
| **Component overrides** | Not built-in | Not built-in | Built-in with `@scope` |
| **Theme containment** | React Context | React Context | CSS `@scope` (no Portal issues) |
| **Token count** | Unlimited | Unlimited | ~80, intentionally minimal |
| **RSC compatible** | Partial | Partial | Yes (pure CSS) |
| **Can use nested APIs?** | N/A | N/A | ✅ Yes — drop-in compatible |

### The `token()` / `@nest/styx` exploration

Melissa and Vincent have been exploring a `token()` function for AI-native authoring:

```js
backgroundColor: token("colors.slate.800"),
borderRadius: token("radii.xl"),
```

Here's the cool part: **`token()` can be built on top of `defineConstsNested` with zero compiler changes.** It's just a function that walks a dot path through the nested object:

```js
function token(path) {
  return path.split('.').reduce((obj, key) => obj[key], designTokens);
}
```

The Babel plugin already evaluates member expressions statically, so `designTokens.colors.slate[800]` and `token("colors.slate.800")` both resolve at compile time. The nested API provides the data structure; `token()` provides an LLM-friendly access pattern on top.

These aren't competing approaches — they're layers that compose.

### The MCDS theming RFC

The MCDS team documented some real pain points with their current theming:

- Untyped `var(--dolly-text-primary)` strings that break silently on typos
- Dark/light mode implementations that diverge per component
- Naming conventions nobody agrees on
- Friction when adding tokens, so people just hardcode values

They proposed moving to typed `mcdsColorVars.textPrimary` via `defineVars`. Nested APIs take that further:

```js
// Before: untyped string
color: 'var(--dolly-text-primary)',

// Flat defineVars: typed, but still flat
color: mcdsColorVars.textPrimary,

// Nested: typed, hierarchical, self-documenting
color: mcdsVars.text.primary,
```

The nested structure makes the taxonomy explicit. You don't need to guess whether it's `textPrimary` or `primaryText` or `text_primary` — you navigate the tree.

---

## Why this matters for AI

From the [Feb 2026 benchmarks](https://docs.google.com/document/d/1WBVjbkJ2rDYCKPVBVvgwuw9YBUxFkpKj-sB3UtKF8X0), StyleX scores 62% on AI code generation vs. Tailwind's 74%. The gap is mainly training data availability, not fundamental API problems — adding context files improved StyleX from 32% to 92%.

But nested tokens help in a different way. When an LLM generates code using flat tokens, it has to **guess the exact string** for each token name. With 200+ tokens, it frequently hallucinates: `tokens.buttonPrimaryBgDefault` instead of `tokens.buttonPrimaryBackgroundDefault` (notice "Bg" vs "Background").

With nested tokens, generation becomes a series of small choices:

```
tokens.  →  button | input              (pick one)
tokens.button.  →  primary | secondary  (pick one)
tokens.button.primary.  →  background | borderRadius  (pick one)
```

At each dot, there are only a few valid options. The tree structure makes it much harder to hallucinate a wrong path. And if you do, TypeScript catches it immediately.

This is the same reason Tailwind's `bg-slate-800` works well for LLMs — the namespace (`bg-`) constrains the search space. Our nested objects do the same thing through structure.

---

## The rollout plan

**Phase 1 (now)**: Ship as `unstable_*` APIs. Zero breaking changes. Teams opt in.

**Phase 2**: Gather feedback from early adopters. Run AI benchmarks with nested vs. flat tokens.

**Phase 3**: If validated, promote to stable. Potentially detect nesting automatically in `defineVars` (no separate API needed).

**Phase 4**: Build `token()` on top for the `@nest/styx` use case.

---

## The implementation is surprisingly simple

The whole thing is a flatten → delegate → unflatten sandwich:

```
Nested input  →  flattenNestedConfig()  →  existing styleXDefineVars  →  unflattenObject()  →  nested output
                                        →  CSS output (already flat, no change)
```

7 new files, 7 modified files. The new files are thin wrappers. The modified files are adding import tracking and dispatch — the same pattern used for every other StyleX API.

No new runtime code. No CSS changes. No performance penalty. Just a better way to organize the input that produces identical output.

---

## Open questions we'd love input on

1. **Should `default` be disallowed as a namespace key?** Right now, `{ default: 'blue' }` means "this is a conditional value." If someone tries to use `default` as a namespace name (like `button: { default: { background: ... } }`), it would be ambiguous. We're leaning toward disallowing it and throwing a clear error.

2. **Partial theme overrides?** With `createThemeNested`, should you have to override every leaf, or just the ones you want to change? We think partial overrides make sense — you shouldn't need to re-specify your entire spacing scale just to change one color.

3. **Where does `token()` live?** Should it be a first-party StyleX API or a separate package? Given that it's literally just `path.split('.').reduce(...)` over a `defineConstsNested` result, a separate package feels right. But standardization is valuable too.

---

## What this enables down the road

The nested API is a building block. On top of it, you can imagine:

- **`lightDark()` helper** that generates `{ default: light, '@media (prefers-color-scheme: dark)': dark }` — could become a first-class StyleX utility
- **Typed token annotations** (like comet-theme-infra's `t.Color`, `t.Spacing`) as optional type refinements on nested leaves
- **Theme merging**: deep-merge two nested theme objects to compose themes
- **Selective inlining**: mark specific branches as static (`inline: true`) to mix CSS vars and inlined values in one definition
- **Canonical token taxonomy**: a shared naming convention (`colors.*`, `spacing.*`, `radii.*`) that works across design systems and makes context files smaller for AI

The nested structure makes all of these tractable. Without it, you're always fighting the flat-key problem.

---

*This proposal lives at `packages/@stylexjs/babel-plugin/PROPOSAL-unified-theming-api.md` if you want the full formal version with comparison tables and appendices. The implementation plan is at `.llms/plans/nested_design_token_apis.plan.md`.*

*Feedback welcome — drop a comment or reach out directly. We're especially interested in hearing from teams with large token sets who've hit the flat-key problem.*
