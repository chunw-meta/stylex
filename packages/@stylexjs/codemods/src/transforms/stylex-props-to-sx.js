/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const t = require('@babel/types');

const STYLEX_IMPORT_SOURCES = [
  'stylex',
  '@stylexjs/stylex',
  '@stylexjs/stylex/lib/stylex',
];

/**
 * Codemod: stylex-props-to-sx
 *
 * Transforms JSX spread attributes using `stylex.props()` into the `sx` prop syntax.
 *
 * Before: <div {...stylex.props(styles.foo, styles.bar)} />
 * After:  <div sx={[styles.foo, styles.bar]} />
 *
 * Options:
 *   - sxPropName (string, default: 'sx'): The JSX prop name to use.
 *   - importSources (string[], default: ['stylex', '@stylexjs/stylex', ...]): Import sources to match.
 */
module.exports = function stylexPropsToSx() {
  const stylexDefaultImports = new Set();
  const stylexPropsImports = new Set();

  return {
    name: 'stylex-props-to-sx',
    visitor: {
      Program: {
        enter(_path, state) {
          stylexDefaultImports.clear();
          stylexPropsImports.clear();

          const opts = state.opts ?? {};
          const importSources = opts.importSources ?? STYLEX_IMPORT_SOURCES;

          // Collect imports in a pre-pass
          _path.traverse({
            ImportDeclaration(importPath) {
              const source = importPath.node.source.value;
              if (!importSources.includes(source)) {
                return;
              }
              for (const specifier of importPath.node.specifiers) {
                if (t.isImportDefaultSpecifier(specifier)) {
                  stylexDefaultImports.add(specifier.local.name);
                }
                if (
                  t.isImportSpecifier(specifier) &&
                  t.isIdentifier(specifier.imported) &&
                  specifier.imported.name === 'props'
                ) {
                  stylexPropsImports.add(specifier.local.name);
                }
              }
            },
            VariableDeclarator(varPath) {
              const init = varPath.node.init;
              if (
                init != null &&
                t.isCallExpression(init) &&
                t.isIdentifier(init.callee) &&
                init.callee.name === 'require' &&
                init.arguments.length === 1 &&
                t.isStringLiteral(init.arguments[0]) &&
                importSources.includes(init.arguments[0].value)
              ) {
                const id = varPath.node.id;
                if (t.isIdentifier(id)) {
                  stylexDefaultImports.add(id.name);
                }
                if (t.isObjectPattern(id)) {
                  for (const prop of id.properties) {
                    if (
                      t.isObjectProperty(prop) &&
                      t.isIdentifier(prop.key) &&
                      prop.key.name === 'props' &&
                      t.isIdentifier(prop.value)
                    ) {
                      stylexPropsImports.add(prop.value.name);
                    }
                  }
                }
              }
            },
          });
        },
      },

      JSXSpreadAttribute(path, state) {
        const opts = state.opts ?? {};
        const sxPropName = opts.sxPropName ?? 'sx';

        const argument = path.node.argument;

        if (!t.isCallExpression(argument)) {
          return;
        }

        const callee = argument.callee;
        let isStylexProps = false;

        // Match: stylex.props(...)
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object) &&
          t.isIdentifier(callee.property) &&
          callee.property.name === 'props' &&
          stylexDefaultImports.has(callee.object.name)
        ) {
          isStylexProps = true;
        }

        // Match: props(...) (named import)
        if (t.isIdentifier(callee) && stylexPropsImports.has(callee.name)) {
          isStylexProps = true;
        }

        if (!isStylexProps) {
          return;
        }

        const args = argument.arguments;

        // Build the sx prop value
        let sxValue;
        if (args.length === 0) {
          // stylex.props() → sx={[]}
          sxValue = t.arrayExpression([]);
        } else if (args.length === 1) {
          const singleArg = args[0];
          if (t.isArrayExpression(singleArg)) {
            // stylex.props([a, b]) → sx={[a, b]}
            sxValue = singleArg;
          } else if (t.isSpreadElement(singleArg)) {
            // stylex.props(...items) → sx={[...items]}
            sxValue = t.arrayExpression([singleArg]);
          } else {
            // stylex.props(styles.foo) → sx={styles.foo}
            sxValue = singleArg;
          }
        } else {
          // stylex.props(a, b, c) → sx={[a, b, c]}
          sxValue = t.arrayExpression(args);
        }

        // Replace the spread attribute with a JSX attribute
        path.replaceWith(
          t.jsxAttribute(
            t.jsxIdentifier(sxPropName),
            t.jsxExpressionContainer(sxValue),
          ),
        );
      },
    },
  };
};
