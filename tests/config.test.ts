import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigurationError, isContained, loadRuntimeConfig, resolveExistingProjectPath
} from "../src/config.js";

let temp: string;
let trusted: string;
let project: string;
let outside: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "gungnir-mcp-security-"));
  trusted = join(temp, "trusted");
  project = join(trusted, "inventory");
  outside = join(temp, "outside");
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(project, "Product.gnr"), "model Product {}\n");
  await writeFile(join(outside, "secret.txt"), "do-not-read\n");
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe("fail-closed startup configuration", () => {
  it("disables project access without an explicit project root", async () => {
    expect(await loadRuntimeConfig([], {})).toEqual({ projectRoot: null, trustedRoots: [] });
  });

  it("accepts an explicit project inside an existing trusted directory", async () => {
    const config = await loadRuntimeConfig(
      ["--project-root", project, "--trusted-root", trusted], {}
    );
    expect(config.projectRoot).toBe(await realpath(project));
    expect(config.trustedRoots).toEqual([await realpath(trusted)]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("supports environment configuration with OS-native path delimiters", async () => {
    const config = await loadRuntimeConfig([], {
      GUNGNIR_MCP_PROJECT_ROOT: project,
      GUNGNIR_MCP_TRUSTED_ROOTS: [trusted, trusted].join(delimiter)
    });
    expect(config.projectRoot).toBe(await realpath(project));
    expect(config.trustedRoots).toHaveLength(1);
  });

  it("gives complete CLI trust flags precedence over environment trust flags", async () => {
    const config = await loadRuntimeConfig(
      ["--project-root", project, "--trusted-root", trusted],
      { GUNGNIR_MCP_PROJECT_ROOT: outside, GUNGNIR_MCP_TRUSTED_ROOTS: outside }
    );
    expect(config.projectRoot).toBe(await realpath(project));
    expect(config.trustedRoots).toEqual([await realpath(trusted)]);
  });

  it("rejects a project without an explicit trusted root", async () => {
    await expect(loadRuntimeConfig(["--project-root", project], {}))
      .rejects.toThrow(/requires at least one explicit trusted root/);
  });

  it("rejects a trust allowlist without a project", async () => {
    await expect(loadRuntimeConfig(["--trusted-root", trusted], {}))
      .rejects.toThrow(/project root is required/i);
  });

  it("rejects an existing project outside the allowlist", async () => {
    await expect(loadRuntimeConfig(["--project-root", outside, "--trusted-root", trusted], {}))
      .rejects.toThrow(/outside the configured trusted roots/);
  });

  it("rejects relative, nonexistent and regular-file roots", async () => {
    for (const root of ["relative-dir", join(temp, "missing"), join(project, "Product.gnr")]) {
      await expect(loadRuntimeConfig(["--project-root", root, "--trusted-root", trusted], {}))
        .rejects.toBeInstanceOf(ConfigurationError);
    }
    await expect(loadRuntimeConfig(["--project-root", project, "--trusted-root", "relative"], {}))
      .rejects.toBeInstanceOf(ConfigurationError);
  });

  it("rejects unknown flags, absent values and duplicate roots", async () => {
    for (const args of [
      ["--unsafe"],
      ["--project-root"],
      ["--trusted-root", "--project-root", project],
      ["--project-root", project, "--project-root", project]
    ]) {
      await expect(loadRuntimeConfig(args, {})).rejects.toBeInstanceOf(ConfigurationError);
    }
  });

  it("rejects empty or over-limit environment allowlists", async () => {
    await expect(loadRuntimeConfig([], {
      GUNGNIR_MCP_PROJECT_ROOT: project,
      GUNGNIR_MCP_TRUSTED_ROOTS: ""
    })).rejects.toBeInstanceOf(ConfigurationError);
    const args = ["--project-root", project];
    for (let i = 0; i < 17; i++) args.push("--trusted-root", trusted);
    await expect(loadRuntimeConfig(args, {})).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("denies a project symlink resolving outside trust", async () => {
    const link = join(trusted, "external-alias");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await expect(loadRuntimeConfig(["--project-root", link, "--trusted-root", trusted], {}))
      .rejects.toThrow(/outside the configured trusted roots/);
  });
});

describe("existing-path containment", () => {
  it("allows an existing in-root file", async () => {
    const config = await loadRuntimeConfig(["--project-root", project, "--trusted-root", trusted], {});
    expect(await resolveExistingProjectPath(config, "Product.gnr"))
      .toBe(await realpath(join(project, "Product.gnr")));
  });

  it("rejects traversal, Windows drive paths, UNC paths, NUL and ADS-like paths", async () => {
    const config = await loadRuntimeConfig(["--project-root", project, "--trusted-root", trusted], {});
    for (const attack of [
      "../outside/secret.txt", "..\\outside\\secret.txt", "/etc/passwd",
      "C:\\Windows\\system.ini", "\\\\server\\share\\file.gnr",
      "Product.gnr:stream", "bad\0name", ""
    ]) {
      await expect(resolveExistingProjectPath(config, attack)).rejects.toBeInstanceOf(ConfigurationError);
    }
  });

  it("rejects nonexisting files and disabled project access", async () => {
    const config = await loadRuntimeConfig(["--project-root", project, "--trusted-root", trusted], {});
    await expect(resolveExistingProjectPath(config, "missing.gnr"))
      .rejects.toBeInstanceOf(ConfigurationError);
    await expect(resolveExistingProjectPath({ projectRoot: null, trustedRoots: [] }, "Product.gnr"))
      .rejects.toBeInstanceOf(ConfigurationError);
  });

  it("rejects symlinks or junctions that escape the project", async () => {
    const config = await loadRuntimeConfig(["--project-root", project, "--trusted-root", trusted], {});
    const shortcut = join(project, "shortcut");
    await symlink(outside, shortcut, process.platform === "win32" ? "junction" : "dir");
    await expect(resolveExistingProjectPath(config, "shortcut/secret.txt"))
      .rejects.toThrow(/escapes its configured root/);
  });

  it("prevents sibling-prefix confusion in containment checks", () => {
    const root = resolve(temp, "repo");
    expect(isContained(root, root)).toBe(true);
    expect(isContained(root, join(root, "sub"))).toBe(true);
    expect(isContained(root, resolve(temp, "repo-malicious"))).toBe(false);
    expect(isContained(root, resolve(temp, "other"))).toBe(false);
  });
});
