// Next 16 dropped the `next lint` CLI. This flat config extends
// eslint-config-next's published flat-config exports directly.
// Scope: frontend source only — skip generated output, deps, and
// the Python backend (which has no business in an ESLint run).

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "out/**", "node_modules/**", "api/**"],
  },
];
