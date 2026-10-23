import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultVersionProbe, discoverToolchain } from "../src/toolchain.js";
import type { VersionProbe } from "../src/toolchain.js";

let root: string;
let bin: string;
const suffix = process.platform === "win32" ? ".exe" : "";
const banners: Record<string, string> = {
  gungnir: "gungnir version 1.0.2",
  gungnirc: "gungnirc version 1.0.2",
  cmake: "cmake version 3.25.1"
};

async function addBinary(name: string): Promise<void> {
  const path = join(bin, name + suffix);
  await writeFile(path, "fixture only");
  if (process.platform !== "win32") await chmod(path, 0o755);
}
async function manifest(content = [
  "profile=application", "package_version=1.0.2", "system=Fixture",
  "sqlite=ON", "password=ON", "postgresql=OFF", "mongodb=OFF"
].join("\n") + "\n"): Promise<void> {
  await mkdir(join(root, "share", "gungnir"), { recursive: true });
  await writeFile(join(root, "share", "gungnir", "sdk.txt"), content);
}
const probe: VersionProbe = vi.fn(async (_path, kind) => banners[kind] ?? "");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gungnir-mcp-sdk-"));
  bin = join(root, "bin");
  await mkdir(bin);
  await Promise.all(["gungnir", "gungnirc", "cmake"].map(addBinary));
  await manifest();
  vi.mocked(probe).mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("native SDK discovery", () => {
  it("detects matching executables and application SDK adapter capabilities", async () => {
    const result = await discoverToolchain({ env: { PATH: bin }, probe });
    expect(result.state).toBe("ready");
    expect(result.source).toBe("path");
    expect(result.cli.version).toBe("1.0.2");
    expect(result.compiler.version).toBe("1.0.2");
    expect(result.cmake.version).toBe("3.25.1");
    expect(result.sdk).toMatchObject({
      state: "ready", version: "1.0.2", profile: "application",
      adapters: { sqlite: true, password: true, postgresql: false, mongodb: false }
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("recognizes core and custom SDK profiles from the actual manifest", async () => {
    await manifest("profile=core\npackage_version=1.0.2\nsqlite=OFF\npassword=OFF\n");
    const core = await discoverToolchain({ env: { PATH: bin }, probe });
    expect(core.sdk.profile).toBe("core");
    expect(core.sdk.adapters.sqlite).toBe(false);
    await manifest("profile=custom\npackage_version=1.0.2\npostgresql=ON\n");
    const custom = await discoverToolchain({ env: { PATH: bin }, probe });
    expect(custom.sdk.profile).toBe("custom");
    expect(custom.sdk.adapters.postgresql).toBe(true);
  });

  it("uses explicit SDK roots before PATH and supports CMake prefix selection", async () => {
    const selected = await discoverToolchain({
      env: { GUNGNIR_MCP_SDK_ROOT: root, PATH: bin }, probe
    });
    expect(selected.source).toBe("sdk-root");
    expect(selected.state).toBe("ready");
    const prefix = await discoverToolchain({
      env: { GUNGNIR_CMAKE_PREFIX: root, PATH: bin }, probe
    });
    expect(prefix.source).toBe("cmake-prefix");
    expect(prefix.state).toBe("ready");
  });

  it("does not fall back to PATH when an explicit SDK override is invalid", async () => {
    const result = await discoverToolchain({
      env: { GUNGNIR_MCP_SDK_ROOT: "relative-sdk", PATH: bin }, probe
    });
    expect(result.source).toBe("sdk-root");
    expect(result.cli.state).toBe("missing");
    expect(result.compiler.state).toBe("missing");
    expect(result.sdk.state).toBe("missing");
    expect(result.state).not.toBe("ready");
    expect(result.diagnostics.join(" ")).toMatch(/absolute directory/);
  });

  it("reports missing tools with an empty PATH without executing anything", async () => {
    const result = await discoverToolchain({ env: { PATH: "" }, probe });
    expect(result.state).toBe("missing");
    expect(result.sdk.state).toBe("missing");
    expect(result.cli.state).toBe("missing");
    expect(result.cmake.state).toBe("missing");
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not search implicit current-directory PATH entries", async () => {
    const result = await discoverToolchain({
      env: { PATH: ["", ".", "relative/bin"].join(delimiter) }, probe
    });
    expect(result.cli.state).toBe("missing");
    expect(probe).not.toHaveBeenCalled();
  });

  it("detects mismatched CLI / compiler / SDK versions", async () => {
    const bad: VersionProbe = async (_path, kind) =>
      kind === "gungnirc" ? "gungnirc version 1.0.1" : banners[kind] ?? "";
    const result = await discoverToolchain({ env: { PATH: bin }, probe: bad });
    expect(result.state).toBe("incompatible");
    expect(result.diagnostics.join(" ")).toMatch(/differs/);
  });

  it("detects unsupported CLI and CMake versions", async () => {
    const bad: VersionProbe = async (_path, kind) =>
      kind === "cmake" ? "cmake version 3.24.4"
        : kind === "gungnir" ? "gungnir version 2.0.0" : banners[kind] ?? "";
    const result = await discoverToolchain({ env: { PATH: bin }, probe: bad });
    expect(result.state).toBe("incompatible");
    expect(result.cmake.state).toBe("incompatible");
    expect(result.cli.state).toBe("incompatible");
  });

  it("reports corrupt or missing SDK marker without inventing capabilities", async () => {
    await manifest("profile=application\nprofile=core\npackage_version=1.0.2\n");
    const invalid = await discoverToolchain({ env: { PATH: bin }, probe });
    expect(invalid.sdk.state).toBe("invalid");
    expect(invalid.sdk.adapters).toEqual({});
    await rm(join(root, "share", "gungnir", "sdk.txt"));
    const absent = await discoverToolchain({ env: { PATH: bin }, probe });
    expect(absent.sdk.state).toBe("invalid");
  });

  it("reports invalid version banners without exposing arbitrary probe output", async () => {
    const bad: VersionProbe = async (_path, kind) =>
      kind === "gungnir" ? "SECRET=do-not-show" : banners[kind] ?? "";
    const result = await discoverToolchain({ env: { PATH: bin }, probe: bad });
    expect(result.cli.state).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("does not surface exception content from a failed probe", async () => {
    const bad: VersionProbe = async () => { throw new Error("TOKEN=secret"); };
    const result = await discoverToolchain({ env: { PATH: bin }, probe: bad });
    expect(result.state).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain("TOKEN");
  });
});

describe("real fixed-argument version probe", () => {
  it.skipIf(process.platform === "win32")("executes only --version against a temporary test binary", async () => {
    const script = join(root, "gungnir");
    await writeFile(script, "#!/bin/sh\n[ \"$1\" = \"--version\" ] || exit 1\nprintf 'gungnir version 1.0.2\\n'\n");
    await chmod(script, 0o755);
    const output = await defaultVersionProbe(script, "gungnir");
    expect(output).toContain("gungnir version 1.0.2");
  });
});
