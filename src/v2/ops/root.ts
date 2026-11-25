// Repo root for the v2 ops adapters. src/v2/ops/*.ts (tsx) and dist/v2/ops/*.js (container build, rootDir=src) sit at
// the same depth, so "../../.." is the repo / app root in both.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
