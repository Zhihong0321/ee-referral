/**
 * Module resolution hook: maps the Next path alias "@/x" to "<repo>/src/x",
 * and resolves extensionless relative TS imports ("./whatsapp-tools"), the
 * way tsconfig/Next do. Runs in the loader thread.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = path.resolve(process.cwd(), "src");

function resolveCandidate(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = resolveCandidate(path.join(SRC_ROOT, specifier.slice(2)));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier) &&
    context.parentURL
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const hit = resolveCandidate(path.join(parentDir, specifier));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  return nextResolve(specifier, context);
}
