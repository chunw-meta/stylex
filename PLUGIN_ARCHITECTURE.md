# StyleX Babel Plugin — Architecture & Data Flow

## High-Level Architecture

```mermaid
graph TB
    subgraph Entry["index.js — Plugin Entry Point"]
        direction TB
        SF["styleXTransform()"]
        PSR["processStylexRules()"]
    end

    subgraph SM["state-manager.js — StateManager"]
        direction TB
        OPT["Option Parsing\n& Validation"]
        IT["Import Tracking\n(Sets per API)"]
        ST["Style Tracking\n(styleMap, styleVars)"]
        MR["Module Resolution\n(importPathResolver)"]
        REG["CSS Rule Registration\n(registerStyles)"]
    end

    subgraph Visitors["Babel Visitors (index.js)"]
        direction TB
        PE["Program.enter"]
        CE["CallExpression"]
        JSX["JSXOpeningElement"]
        PX["Program.exit"]
    end

    subgraph Transforms["Transform Visitors (visitors/)"]
        direction TB
        IMP["imports.js\nreadImportDeclarations\nreadRequires"]
        SC["stylex-create"]
        SK["stylex-keyframes"]
        SDV["stylex-define-vars"]
        SDC["stylex-define-consts"]
        SCT["stylex-create-theme"]
        SPT["stylex-position-try"]
        SVTC["stylex-view-transition-class"]
        SDM["stylex-define-marker"]
        SDFM["stylex-default-marker"]
        SMG["stylex-merge"]
        SP["stylex-props"]
    end

    SF --> Visitors
    PE -->|"creates"| SM
    PE -->|"reads imports"| IMP
    IMP -->|"populates"| IT

    CE --> SK & SVTC & SPT & SDV & SDC & SCT & SC & SDM & SDFM
    SK & SVTC & SPT & SDV & SDC & SCT & SC & SDM & SDFM -->|"read/write"| SM

    JSX -->|"rewrites sx prop"| SP

    PX -->|"transforms"| SMG & SP
    PX -->|"dead-code eliminates\nunused styles"| ST

    REG -->|"collects CSS tuples"| PSR

    style Entry fill:#1a1a2e,stroke:#e94560,color:#fff
    style SM fill:#16213e,stroke:#0f3460,color:#fff
    style Visitors fill:#0f3460,stroke:#533483,color:#fff
    style Transforms fill:#533483,stroke:#e94560,color:#fff
```

## Plugin Lifecycle — Data Flow

```mermaid
sequenceDiagram
    participant Babel
    participant Plugin as index.js
    participant State as StateManager
    participant Visitors as Transform Visitors
    participant Meta as file.metadata.stylex

    Note over Babel,Meta: Phase 1 — Initialization (Program.enter)
    Babel->>Plugin: Visit Program node
    Plugin->>State: new StateManager(babelState)
    State->>State: setOptions() — validate & normalize config
    Plugin->>Visitors: readImportDeclarations / readRequires
    Visitors->>State: Populate import Sets (stylexImport, stylexCreateImport, etc.)

    Note over Babel,Meta: Phase 2 — Transform API Calls (CallExpression)
    Babel->>Plugin: Visit CallExpression nodes
    Plugin->>State: Check if callee is a known StyleX API
    Plugin->>Visitors: transformStyleXKeyframes()
    Visitors->>State: registerStyles([key, {ltr, rtl}, priority])
    State->>Meta: Push CSS rule tuples
    Plugin->>Visitors: transformStyleXViewTransitionClass()
    Plugin->>Visitors: transformStyleXPositionTry()
    Plugin->>Visitors: transformStyleXDefineVars()
    Visitors->>State: importPathResolver() → resolve theme files
    Visitors->>State: registerStyles(...)
    State->>Meta: Push CSS rule tuples
    Plugin->>Visitors: transformStyleXDefineConsts()
    Plugin->>Visitors: transformStyleXCreateTheme()
    Plugin->>Visitors: transformStyleXCreate()
    Visitors->>State: styleMap.set(varName, compiledNamespaces)
    Visitors->>State: styleVars.set(varName, astPath)
    Visitors->>State: registerStyles(...)
    State->>Meta: Push CSS rule tuples

    Note over Babel,Meta: Phase 2b — JSX Transform (JSXOpeningElement)
    Babel->>Plugin: Visit JSXOpeningElement
    Plugin->>Plugin: Rewrite sx={...} → {...stylex.props(...)}

    Note over Babel,Meta: Phase 3 — Post-Processing (Program.exit)
    Babel->>Plugin: Program.exit
    Plugin->>Plugin: Traverse Identifiers → mark used styleVarsToKeep
    Plugin->>Visitors: transformStylexCall() — stylex() merge
    Plugin->>Visitors: transformStylexProps() — stylex.props()
    Plugin->>Plugin: Dead-code eliminate unused stylex.create() vars
    Plugin->>Plugin: Rewrite aliased import paths (if enabled)

    Note over Babel,Meta: Phase 4 — CSS Generation (post-build)
    Meta-->>Plugin: Collect all CSS tuples from all files
    Plugin->>Plugin: processStylexRules(allRules, config)
    Plugin-->>Babel: Return final CSS string
```

## StateManager Internal Structure

```mermaid
classDiagram
    class StateManager {
        -_state: PluginPass
        +importPaths: Set~string~
        +stylexImport: Set~string~
        +stylexPropsImport: Set~string~
        +stylexAttrsImport: Set~string~
        +stylexCreateImport: Set~string~
        +stylexIncludeImport: Set~string~
        +stylexFirstThatWorksImport: Set~string~
        +stylexKeyframesImport: Set~string~
        +stylexPositionTryImport: Set~string~
        +stylexDefineVarsImport: Set~string~
        +stylexDefineMarkerImport: Set~string~
        +stylexDefineConstsImport: Set~string~
        +stylexCreateThemeImport: Set~string~
        +stylexTypesImport: Set~string~
        +stylexViewTransitionClassImport: Set~string~
        +stylexDefaultMarkerImport: Set~string~
        +stylexWhenImport: Set~string~
        +stylexEnvImport: Set~string~
        +injectImportInserted: Identifier?
        +styleMap: Map~string, CompiledNamespaces~
        +styleVars: Map~string, NodePath~
        +styleVarsToKeep: Set~tuple~
        +inStyleXCreate: boolean
        +options: StyleXStateOptions
        +constructor(state)
        +setOptions(options) StyleXStateOptions
        +importPathResolver(importPath) ImportPathResolution
        +addStyle(style) void
        +registerStyles(styles, path) void
        +markComposedNamespace(memberExpression) void
        +getCanonicalFilePath(filePath) string
        +getPackageNameAndPath(filepath) tuple?
        +applyStylexEnv(identifiers) void
        +filename: string?
        +fileNameForHashing: string?
        +runtimeInjection: object?
        +isDev: boolean
        +isDebug: boolean
        +isTest: boolean
        +canReferenceTheme: boolean
        +metadata: object
        +cssVars: any
        +treeshakeCompensation: boolean
    }

    class StyleXStateOptions {
        +dev: boolean
        +debug: boolean
        +test: boolean
        +classNamePrefix: string
        +importSources: Array
        +runtimeInjection: string?
        +styleResolution: string
        +unstable_moduleResolution: ModuleResolution?
        +aliases: object?
        +rewriteAliases: boolean
        +treeshakeCompensation: boolean
        +enableDebugClassNames: boolean
        +enableDebugDataProp: boolean
        +enableDevClassNames: boolean
        +enableMinifiedKeys: boolean
        +enableMediaQueryOrder: boolean
        +enableLegacyValueFlipping: boolean
        +enableLogicalStylesPolyfill: boolean
        +enableLTRRTLComments: boolean
        +sxPropName: string | false
        +env: object
        +propertyValidationMode: string
        +debugFilePath: function?
    }

    class ModuleResolution {
        <<union>>
        commonJS: rootDir, themeFileExtension
        haste: themeFileExtension
        custom: filePathResolver, getCanonicalFilePath
        experimental_crossFileParsing: rootDir
    }

    StateManager --> StyleXStateOptions : options
    StyleXStateOptions --> ModuleResolution : unstable_moduleResolution
```

## CSS Rule Processing Pipeline (`processStylexRules`)

```mermaid
flowchart LR
    A["Input:\nArray of Rule tuples\n[key, {ltr, rtl?, constKey?, constVal?}, priority]"] --> B["Separate\nconstant vs\nnon-constant rules"]

    B --> C["Build constsMap\nResolve circular refs"]
    B --> D["Sort by priority\nthen property name"]

    C --> E["Inline const values\ninto CSS rules"]
    D --> E

    E --> F["Group by\npriority level\n(floor(pri/1000))"]

    F --> G{"useLayers?"}
    G -->|Yes| H["Wrap groups in\n@layer priority1, priority2..."]
    G -->|No| I{"legacyDisableLayers?"}
    I -->|No| J["Add :not(#\\#)\nspecificity bumps"]
    I -->|Yes| K["No specificity\nmodification"]

    H --> L["Handle RTL"]
    J --> L
    K --> L

    L --> M{"Has RTL\nvariant?"}
    M -->|Yes, enableLTRRTLComments| N["/* @ltr */ ... /* @rtl */\ncomment markers"]
    M -->|Yes, default| O["html:not([dir='rtl']) ...\nhtml[dir='rtl'] ..."]
    M -->|No| P["Single LTR rule"]

    N --> Q["Prepend logical\nfloat vars\n(if needed)"]
    O --> Q
    P --> Q

    Q --> R["Output:\nFinal CSS string"]

    style A fill:#2d3436,stroke:#636e72,color:#fff
    style R fill:#00b894,stroke:#00cec9,color:#fff
```

## File Dependency Graph

```mermaid
graph TD
    INDEX["index.js\n(Plugin Entry)"] --> SM["utils/state-manager.js\n(State & Config)"]
    INDEX --> IMP["visitors/imports.js"]
    INDEX --> VSC["visitors/stylex-create.js"]
    INDEX --> VSCT["visitors/stylex-create-theme.js"]
    INDEX --> VSDV["visitors/stylex-define-vars.js"]
    INDEX --> VSDC["visitors/stylex-define-consts.js"]
    INDEX --> VSK["visitors/stylex-keyframes.js"]
    INDEX --> VSPT["visitors/stylex-position-try.js"]
    INDEX --> VSMG["visitors/stylex-merge.js"]
    INDEX --> VSP["visitors/stylex-props.js"]
    INDEX --> VSVTC["visitors/stylex-view-transition-class.js"]
    INDEX --> VSDM["visitors/stylex-define-marker.js"]
    INDEX --> VSDFM["visitors/stylex-default-marker.js"]
    INDEX --> LES["shared/preprocess-rules/\nlegacy-expand-shorthands.js"]

    SM --> VAL["utils/validate.js"]
    SM --> EP["utils/evaluate-path.js"]
    SM --> AH["utils/ast-helpers.js"]
    SM --> SHARED["shared/index.js"]
    SM --> DO["shared/utils/default-options.js"]
    SM --> IMR["import-meta-resolve\n(external)"]

    IMP --> SM
    VSC --> SM
    VSCT --> SM
    VSDV --> SM
    VSDC --> SM
    VSK --> SM
    VSPT --> SM
    VSMG --> SM
    VSP --> SM
    VSVTC --> SM
    VSDM --> SM
    VSDFM --> SM

    style INDEX fill:#e17055,stroke:#d63031,color:#fff
    style SM fill:#0984e3,stroke:#74b9ff,color:#fff
    style IMP fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSC fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSCT fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSDV fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSDC fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSK fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSPT fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSMG fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSP fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSVTC fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSDM fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style VSDFM fill:#6c5ce7,stroke:#a29bfe,color:#fff
    style LES fill:#fdcb6e,stroke:#e17055,color:#2d3436
    style VAL fill:#00cec9,stroke:#81ecec,color:#2d3436
    style EP fill:#00cec9,stroke:#81ecec,color:#2d3436
    style AH fill:#00cec9,stroke:#81ecec,color:#2d3436
    style SHARED fill:#00cec9,stroke:#81ecec,color:#2d3436
    style DO fill:#00cec9,stroke:#81ecec,color:#2d3436
    style IMR fill:#636e72,stroke:#b2bec3,color:#fff
```
