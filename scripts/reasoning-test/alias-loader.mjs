/**
 * --import entry that registers the "@/..." -> "src/..." resolver so the
 * agent modules can be loaded by plain node (outside Next).
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./alias-hooks.mjs", import.meta.url), pathToFileURL("./"));
