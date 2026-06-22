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
    // Thư viện minify (pdf.js worker) — không lint code bên thứ ba.
    "public/pdf.worker.min.mjs",
    // Code Convex tự sinh — có sẵn eslint-disable nội bộ, không cần lint lại.
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
