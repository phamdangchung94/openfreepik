import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

/**
 * Audit P2-1: minimal flat-config lint. Catches the high-value issues
 * (unused vars, no-explicit-any with escape hatch, react-hooks rules,
 * Next.js best practices) without dragging in the full Next.js preset
 * which has circular-config issues under Next 16's FlatCompat shim.
 */
export default [
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      // TS already enforces this and the lint version misfires on JSX
      "no-undef": "off",
      // react-hooks v7 introduced strict React-Compiler rules that flag
      // patterns we use intentionally (refs read during render for
      // dedupe flags, set state inside effects to reset on prop change,
      // useTaskStore.getState() inside callbacks). They're not bugs in
      // our codebase. Demote to warn so CI still surfaces them but
      // doesn't block.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      // We use Next.js Image only when we're confident it adds value;
      // many video frames are remote and Image's preload cost > benefit
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "scripts/**",
      "next-env.d.ts",
      "*.config.mjs",
      "*.config.js",
      "*.config.ts",
    ],
  },
];
