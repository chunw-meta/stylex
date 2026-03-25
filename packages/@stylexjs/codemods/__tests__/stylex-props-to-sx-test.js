/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

jest.autoMockOff();

const { transformSync } = require('@babel/core');
const jsx = require('@babel/plugin-syntax-jsx');
const stylexPropsToSx = require('../src/transforms/stylex-props-to-sx');

function transform(source, opts = {}) {
  return transformSync(source, {
    parserOpts: {
      sourceType: 'module',
      flow: 'all',
    },
    babelrc: false,
    plugins: [jsx, [stylexPropsToSx, opts]],
  }).code;
}

describe('@stylexjs/codemods', () => {
  describe('stylex-props-to-sx', () => {
    test('basic single style', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <div {...stylex.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div sx={styles.foo} />;
        }"
      `);
    });

    test('multiple styles', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <div {...stylex.props(styles.foo, styles.bar)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div sx={[styles.foo, styles.bar]} />;
        }"
      `);
    });

    test('array argument', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <div {...stylex.props([styles.foo, styles.bar])} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div sx={[styles.foo, styles.bar]} />;
        }"
      `);
    });

    test('conditional expression', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo({ isActive }) {
            return <div {...stylex.props(isActive ? styles.active : styles.inactive)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo({
          isActive
        }) {
          return <div sx={isActive ? styles.active : styles.inactive} />;
        }"
      `);
    });

    test('logical AND expression with multiple args', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo({ isActive }) {
            return <div {...stylex.props(isActive && styles.active, styles.base)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo({
          isActive
        }) {
          return <div sx={[isActive && styles.active, styles.base]} />;
        }"
      `);
    });

    test('empty props call', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <div {...stylex.props()} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div sx={[]} />;
        }"
      `);
    });

    test('uppercase component', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <Component {...stylex.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <Component sx={styles.foo} />;
        }"
      `);
    });

    test('member expression tag', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <animated.div {...stylex.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <animated.div sx={styles.foo} />;
        }"
      `);
    });

    test('namespaced component tag', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <Namespace.Component {...stylex.props(styles.foo, styles.bar)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <Namespace.Component sx={[styles.foo, styles.bar]} />;
        }"
      `);
    });

    test('named import: props()', () => {
      expect(
        transform(`
          import { props } from 'stylex';
          function Foo() {
            return <div {...props(styles.foo, styles.bar)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import { props } from 'stylex';
        function Foo() {
          return <div sx={[styles.foo, styles.bar]} />;
        }"
      `);
    });

    test('renamed named import: props as stylexProps', () => {
      expect(
        transform(`
          import { props as stylexProps } from 'stylex';
          function Foo() {
            return <div {...stylexProps(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import { props as stylexProps } from 'stylex';
        function Foo() {
          return <div sx={styles.foo} />;
        }"
      `);
    });

    test('require() default import', () => {
      expect(
        transform(`
          const stylex = require('stylex');
          function Foo() {
            return <div {...stylex.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "const stylex = require('stylex');
        function Foo() {
          return <div sx={styles.foo} />;
        }"
      `);
    });

    test('require() destructured props import', () => {
      expect(
        transform(`
          const { props } = require('stylex');
          function Foo() {
            return <div {...props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "const {
          props
        } = require('stylex');
        function Foo() {
          return <div sx={styles.foo} />;
        }"
      `);
    });

    test('@stylexjs/stylex import source', () => {
      expect(
        transform(`
          import stylex from '@stylexjs/stylex';
          function Foo() {
            return <div {...stylex.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from '@stylexjs/stylex';
        function Foo() {
          return <div sx={styles.foo} />;
        }"
      `);
    });

    test('does NOT transform non-JSX usage', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          const result = stylex.props(styles.foo);
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        const result = stylex.props(styles.foo);"
      `);
    });

    test('does NOT transform without stylex import', () => {
      expect(
        transform(`
          function Foo() {
            return <div {...someOther.props(styles.foo)} />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "function Foo() {
          return <div {...someOther.props(styles.foo)} />;
        }"
      `);
    });

    test('preserves other attributes', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return <div id="test" {...stylex.props(styles.foo)} className="extra" />;
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div id="test" sx={styles.foo} className="extra" />;
        }"
      `);
    });

    test('custom sxPropName', () => {
      expect(
        transform(
          `
          import stylex from 'stylex';
          function Foo() {
            return <div {...stylex.props(styles.foo)} />;
          }
        `,
          { sxPropName: 'css' },
        ),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <div css={styles.foo} />;
        }"
      `);
    });

    test('multiple elements in same file', () => {
      expect(
        transform(`
          import stylex from 'stylex';
          function Foo() {
            return (
              <>
                <div {...stylex.props(styles.foo)} />
                <span {...stylex.props(styles.bar, styles.baz)} />
              </>
            );
          }
        `),
      ).toMatchInlineSnapshot(`
        "import stylex from 'stylex';
        function Foo() {
          return <>
                        <div sx={styles.foo} />
                        <span sx={[styles.bar, styles.baz]} />
                      </>;
        }"
      `);
    });
  });
});
