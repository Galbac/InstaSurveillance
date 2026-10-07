import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  { ignores: ["src/lib/generated-api.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
