import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output, not source. Without these `npm run lint` reports ~24,000
    // problems, all of them in bundled chunks and vendored Deno typings, and
    // the dozen that are actually ours are invisible underneath.
    ".next-test/**",
    ".netlify/**",
  ]),
  {
    // The test scripts assert with `cond ? ok('…') : bad('…')`, one line per
    // check, which the linter reads as an unused expression — 900 times.
    // That is the idiom, not a mistake, and under 900 copies of it the
    // twenty real errors in app/ were invisible.
    files: ["scripts/**/*.mjs", "scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
]);

export default eslintConfig;
