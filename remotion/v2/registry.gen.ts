// Bundle-side entry for the v2 component registry. The generated data lives in src/v2/registry.gen.ts (the container
// build's rootDir is src/, so src/ cannot import from remotion/); Remotion code imports this file, which re-exports it.
// Extensionless on purpose: Remotion's webpack resolves .ts but not NodeNext ".js" specifiers.
export * from "../../src/v2/registry.gen";
