import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { OFFICIAL_DOCS, OFFICIAL_DOCS_COMMIT, OFFICIAL_DOCS_VERSION } from "./official-docs.js";

export const DOC_MIME = "text/markdown";
export const SDK_MIME = "application/json";
export const SDK_RESOURCE_URI = "gungnir://sdk/capabilities";
export const CATALOG_RESOURCE_URI = "gungnir://docs/catalog";
const DOC_LIMIT = 32_768;
const MANIFEST_LIMIT = 16_384;
const ADAPTERS = [
  "sqlite", "password", "postgresql", "mysql", "sqlserver", "mongodb",
  "redis", "smtp", "otlp", "tls", "http2", "s3"
] as const;

export interface OfficialResource {
  readonly uri: string;
  readonly title: string;
  readonly source: string;
  readonly sha: string;
}

export interface SdkCapabilities {
  readonly state: "not_configured" | "ready" | "incompatible" | "invalid";
  readonly version: string | null;
  readonly profile: "core" | "application" | "custom" | null;
  readonly adapters: Readonly<Record<string, boolean>>;
  readonly matchesDocumentationVersion: boolean | null;
  readonly documentationVersion: string;
  readonly reason: string | null;
}

export class DocumentationResourceError extends Error {
  constructor() {
    super("Documentation resource unavailable or invalid");
    this.name = "DocumentationResourceError";
  }
}

function validSha(text: string, expected: string): boolean {
  const bytes = Buffer.from(text, "utf8");
  const gitSha = createHash("sha1").update("blob " + bytes.byteLength + "\0")
    .update(bytes).digest("hex");
  return gitSha === expected;
}

export function officialResourceCatalog(): readonly OfficialResource[] {
  return Object.entries(OFFICIAL_DOCS)
    .map(([slug, item]) => ({
      uri: "gungnir://docs/" + OFFICIAL_DOCS_VERSION + "/" + slug,
      title: item.title,
      source: "https://github.com/justinangeloperez327/gungnir/blob/" +
        OFFICIAL_DOCS_COMMIT + "/" + item.source,
      sha: item.blobSha
    }))
    .sort((a, b) => a.uri.localeCompare(b.uri));
}

/** Pinned exact official document, bounded in bytes and checked against Git's blob SHA. */
export function readOfficialDocument(uri: string): string {
  const prefix = "gungnir://docs/" + OFFICIAL_DOCS_VERSION + "/";
  if (typeof uri !== "string" || !uri.startsWith(prefix)) throw new DocumentationResourceError();
  const slug = uri.slice(prefix.length);
  if (!/^[a-z][a-z0-9-]{0,48}$/u.test(slug)) throw new DocumentationResourceError();
  const item = Object.hasOwn(OFFICIAL_DOCS, slug) ? OFFICIAL_DOCS[slug] : undefined;
  if (!item || !/^docs\/[a-z][a-z0-9-]+\.md$/u.test(item.source)
    || !/^[a-f0-9]{40}$/u.test(item.blobSha)
    || !item.text.startsWith("#") || Buffer.byteLength(item.text, "utf8") > DOC_LIMIT
    || !validSha(item.text, item.blobSha)) throw new DocumentationResourceError();
  return item.text;
}

function emptySdk(
  state: SdkCapabilities["state"], reason: string
): SdkCapabilities {
  return {
    state, version: null, profile: null, adapters: {},
    matchesDocumentationVersion: null,
    documentationVersion: OFFICIAL_DOCS_VERSION, reason
  };
}

function isContained(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === "" || (part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part));
}

async function validatedFile(root: string): Promise<string> {
  if (root.includes("\0") || !isAbsolute(root)) throw new DocumentationResourceError();
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new DocumentationResourceError();
  const canonicalRoot = await realpath(root);
  let next = canonicalRoot;
  for (const segment of ["share", "gungnir"]) {
    next = join(next, segment);
    const st = await lstat(next);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new DocumentationResourceError();
  }
  const file = join(next, "sdk.txt");
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > MANIFEST_LIMIT) {
    throw new DocumentationResourceError();
  }
  const canonical = await realpath(file);
  if (!isContained(canonicalRoot, canonical) || canonical !== file) {
    throw new DocumentationResourceError();
  }
  return canonical;
}

async function readBoundedManifest(path: string): Promise<string> {
  const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
  const handle = await open(path, flags);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > MANIFEST_LIMIT) throw new DocumentationResourceError();
    const buffer = Buffer.alloc(MANIFEST_LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MANIFEST_LIMIT) throw new DocumentationResourceError();
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function parseSdkCapabilities(text: string): SdkCapabilities {
  if (Buffer.byteLength(text, "utf8") > MANIFEST_LIMIT) {
    return emptySdk("invalid", "sdk_manifest_invalid");
  }
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^([a-z][a-z0-9_]*)=([ -~]{0,256})$/u.exec(line);
    if (!match?.[1] || match[2] === undefined || fields.has(match[1])) {
      return emptySdk("invalid", "sdk_manifest_invalid");
    }
    fields.set(match[1], match[2]);
  }
  const version = fields.get("package_version");
  const profile = fields.get("profile");
  if (!version || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(version)
    || (profile !== "core" && profile !== "application" && profile !== "custom")) {
    return emptySdk("invalid", "sdk_manifest_invalid");
  }
  const adapters: Record<string, boolean> = {};
  for (const name of ADAPTERS) {
    const value = fields.get(name);
    if (value !== undefined) {
      if (value !== "ON" && value !== "OFF") return emptySdk("invalid", "sdk_manifest_invalid");
      adapters[name] = value === "ON";
    }
  }
  const matchesDocumentationVersion = version === OFFICIAL_DOCS_VERSION;
  return {
    state: matchesDocumentationVersion ? "ready" : "incompatible",
    version, profile, adapters,
    matchesDocumentationVersion, documentationVersion: OFFICIAL_DOCS_VERSION,
    reason: matchesDocumentationVersion ? null : "sdk_documentation_version_mismatch"
  };
}

/**
 * Local SDK capability resource: only operator startup env selects the source.
 * No PATH discovery, no native execution, and no client-controlled file paths.
 */
export async function readSdkCapabilities(
  env: NodeJS.ProcessEnv = process.env
): Promise<SdkCapabilities> {
  const selected = env.GUNGNIR_MCP_SDK_ROOT ?? env.GUNGNIR_CMAKE_PREFIX;
  if (selected === undefined) return emptySdk("not_configured", "sdk_root_not_configured");
  try {
    const path = await validatedFile(selected);
    return parseSdkCapabilities(await readBoundedManifest(path));
  } catch {
    return emptySdk("invalid", "sdk_manifest_unavailable_or_unsafe");
  }
}

export function documentationCatalogJson(): string {
  return JSON.stringify({
    framework: "Gungnir",
    documentationVersion: OFFICIAL_DOCS_VERSION,
    sourceTag: "v" + OFFICIAL_DOCS_VERSION,
    sourceCommit: OFFICIAL_DOCS_COMMIT,
    resources: officialResourceCatalog()
  });
}
