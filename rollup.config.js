import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import nodeResolve from 'rollup-plugin-node-resolve';
import eslint from 'rollup-plugin-eslint';
import json from 'rollup-plugin-json';
import builtins from 'rollup-plugin-node-builtins';

export default {
  input: './lib/enjoi.js',
  output: {
    name: 'Enjoi',
    file: 'dist/enjoi.min.js',
    format: 'iife'
  },
  plugins: [
    builtins(),
    nodeResolve({
      main: false,
      browser: true,
    }),
    commonjs({
      sourceMap: true
    }),
    babel({
      exclude: 'node_modules/**',
      babelrc: false,
      presets: [
        [
          "env",
          {
            modules: false
          }
        ]
      ],
      plugins: [
        "external-helpers"
      ]
    }),
    json(),
    eslint({
      fix: true
    })
  ]
};
