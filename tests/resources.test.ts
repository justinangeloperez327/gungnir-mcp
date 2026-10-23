import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CATALOG_RESOURCE_URI, SDK_RESOURCE_URI, DocumentationResourceError,
  documentationCatalogJson, officialResourceCatalog, parseSdkCapabilities,
  readOfficialDocument, readSdkCapabilities
} from "../src/resources.js";
import { OFFICIAL_DOCS_COMMIT, OFFICIAL_DOCS_VERSION } from "../src/official-docs.js";

let tmp: string;
let sdk: string;
let marker: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "gungnir-mcp-resource-"));
  sdk = join(tmp, "sdk");
  await mkdir(join(sdk, "share", "gungnir"), { recursive: true });
  marker = join(sdk, "share", "gungnir", "sdk.txt");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("pinned official documentation resources", () => {
  it("uses an immutable 1.0.2 release tag with a known source commit", () => {
    expect(OFFICIAL_DOCS_VERSION).toBe("1.0.2");
    expect(OFFICIAL_DOCS_COMMIT).toBe("90cb063eca81f121c78c8ab77b8dea67143dbad1");
    const catalog = officialResourceCatalog();
    expect(catalog).toHaveLength(16);
    expect(new Set(catalog.map(x => x.uri)).size).toBe(16);
    for (const item of catalog) {
      expect(item.uri).toMatch(/^gungnir:\/\/docs\/1\.0\.2\/[a-z][a-z-]+$/u);
      expect(item.source).toContain(OFFICIAL_DOCS_COMMIT);
      expect(item.sha).toMatch(/^[0-9a-f]{40}$/u);
      expect(readOfficialDocument(item.uri).startsWith("#")).toBe(true);
      expect(Buffer.byteLength(readOfficialDocument(item.uri), "utf8")).toBeLessThanOrEqual(32_768);
    }
    expect(readOfficialDocument("gungnir://docs/1.0.2/grammar")).toContain("Gungnir");
    expect(readOfficialDocument("gungnir://docs/1.0.2/sdk-packages")).toContain("SDK");
  });

  it("exposes a bounded catalog with exact provenance", () => {
    const catalog = JSON.parse(documentationCatalogJson()) as {
      framework: string; documentationVersion: string; sourceTag: string;
      sourceCommit: string; resources: Array<{ uri: string }>
    };
    expect(catalog).toMatchObject({
      framework: "Gungnir", documentationVersion: "1.0.2",
      sourceTag: "v1.0.2", sourceCommit: OFFICIAL_DOCS_COMMIT
    });
    expect(catalog.resources).toHaveLength(16);
    expect(CATALOG_RESOURCE_URI).toBe("gungnir://docs/catalog");
    expect(SDK_RESOURCE_URI).toBe("gungnir://sdk/capabilities");
  });

  it("rejects unknown versions, arbitrary paths, traversal and URI variations", () => {
    for (const uri of [
      "gungnir://docs/1.0.3/grammar", "gungnir://docs/1.0.2/../../.env",
      "gungnir://docs/1.0.2/%2e%2e", "gungnir://docs/1.0.2/.secret",
      "gungnir://docs/1.0.2/grammar?file=secret", "file:///etc/passwd",
      "gungnir://docs/1.0.2/unknown", "gungnir://docs/1.0.2/grammar/",
      "gungnir://docs/1.0.2/grammar#fragment", "gungnir://docs/1.0.2/GRAMMAR"
    ]) expect(() => readOfficialDocument(uri)).toThrow(DocumentationResourceError);
  });
});

describe("bounded, validated local SDK capability resource", () => {
  it("returns not configured without inspecting PATH or executing a binary", async () => {
    expect(await readSdkCapabilities({ PATH: sdk })).toEqual({
      state: "not_configured", version: null, profile: null, adapters: {},
      matchesDocumentationVersion: null,
      documentationVersion: "1.0.2", reason: "sdk_root_not_configured"
    });
  });

  it("extracts only allowlisted SDK metadata from a trusted marker", async () => {
    await writeFile(marker,
      "profile=application\npackage_version=1.0.2\nsqlite=ON\npassword=ON\nredis=OFF\n" +
      "compiler=PRIVATE_COMPILER_PATH\nplatform=PRIVATE_SYSTEM_IDENTIFIER\n");
    const result = await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: sdk });
    expect(result).toMatchObject({
      state: "ready", version: "1.0.2", profile: "application",
      adapters: { sqlite: true, password: true, redis: false },
      matchesDocumentationVersion: true
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain(tmp);
  });

  it("does not claim a mismatched installed SDK is covered by the pinned documentation", async () => {
    await writeFile(marker, "profile=core\npackage_version=1.0.1\nsqlite=OFF\n");
    const sdkInfo = await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: sdk });
    expect(sdkInfo).toMatchObject({
      state: "incompatible", version: "1.0.1", profile: "core",
      matchesDocumentationVersion: false,
      reason: "sdk_documentation_version_mismatch"
    });
  });

  it("uses explicit SDK root ahead of CMake prefix without implicit fallback", async () => {
    await writeFile(marker, "profile=core\npackage_version=1.0.2\n");
    const good = await readSdkCapabilities({ GUNGNIR_CMAKE_PREFIX: sdk });
    expect(good.state).toBe("ready");
    const invalid = await readSdkCapabilities({
      GUNGNIR_MCP_SDK_ROOT: "relative/sdk",
      GUNGNIR_CMAKE_PREFIX: sdk
    });
    expect(invalid).toMatchObject({ state: "invalid", reason: "sdk_manifest_unavailable_or_unsafe" });
  });

  it("rejects duplicate fields, invalid flags, missing versions, non-ASCII/control injection", () => {
    for (const source of [
      "profile=core\nprofile=custom\npackage_version=1.0.2\n",
      "profile=core\npackage_version=1.0.2\nsqlite=YES\n",
      "profile=core\npackage_version=1.0.2\nsqlite=ON\nsqlite=OFF\n",
      "profile=unknown\npackage_version=1.0.2\n",
      "profile=core\n",
      "profile=core\npackage_version=not-a-version\n",
      "profile=core\npackage_version=1.0.2\nPRIVATE=secret\n",
      "profile=core\npackage_version=1.0.2\nx=evil\0byte\n",
      "profile=core\npackage_version=1.0.2\nx=unicode-🌟\n",
      "profile=core\npackage_version=1.0.2\n".repeat(500)
    ]) expect(parseSdkCapabilities(source).state).toBe("invalid");
  });

  it("refuses oversized markers, missing markers, directories and unsafe root paths", async () => {
    await writeFile(marker, "a".repeat(16_385));
    expect((await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: sdk })).state).toBe("invalid");
    await rm(marker);
    expect((await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: sdk })).state).toBe("invalid");
    expect((await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: "../sdk" })).state).toBe("invalid");
  });

  it("refuses symlinked or junction SDK marker directories", async () => {
    const root = join(tmp, "redirected");
    await mkdir(join(root, "gungnir"), { recursive: true });
    await writeFile(join(root, "gungnir", "sdk.txt"), "profile=core\npackage_version=1.0.2\n");
    await rm(join(sdk, "share"), { recursive: true });
    await symlink(root, join(sdk, "share"), process.platform === "win32" ? "junction" : "dir");
    const result = await readSdkCapabilities({ GUNGNIR_MCP_SDK_ROOT: sdk });
    expect(result.state).toBe("invalid");
  });
});
