import { defineConfig } from "orval";

export default defineConfig({
  testcasehub: {
    input: {
      target: "./openapi.yml",
    },
    output: {
      mode: "tags-split",
      target: "../api-client-react/src/generated",
      client: "react-query",
      schemas: "../api-client-react/src/generated/schemas",
      mock: false,
      override: {
        useDates: false,
        mutator: {
          path: "../api-client-react/src/custom-fetch.ts",
          name: "customFetch",
        },
        query: {
          useQuery: true,
          useSuspenseQuery: false,
        },
      },
    },
    hooks: {
      afterAllFilesWrite: "prettier --write",
    },
  },
});
