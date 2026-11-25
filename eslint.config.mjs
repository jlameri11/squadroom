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
    ".next-sim/**",
    ".netlify/**",
    // Lint is the app's (Joey, 24 Nov 2026): the test suites, seeds and
    // simulation under scripts/ are tooling, written in their own idiom
    // (`cond ? ok('…') : bad('…')`), and are not linted.
    "scripts/**",
    "supabase/**",
    ".cache/**",
    ".shots/**",
    ".local-db/**",
  ]),
]);

export default eslintConfig;
