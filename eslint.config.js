import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "target/**", "src/generated/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", ".dependency-cruiser.cjs", "vite.config.ts"],
    languageOptions: {
      globals: {
        console: "readonly",
        module: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-dom/**",
            "zustand",
            "@tauri-apps/**",
            "@/features/**",
            "@/state/**",
            "@/data/adapters/**",
          ],
        },
      ],
    },
  },
  {
    files: ["src/state/**/*.ts", "src/state/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/features/**", "@/components/**"] }],
    },
  },
);
