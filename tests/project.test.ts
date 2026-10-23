import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config.js";
import { ProjectInspectionError, listProjectModules, scanProject, summarizeProject } from "../src/project.js";

let root: string;
let workspace: string;
let project: string;
let outside: string;

async function file(path: string, body = "not inspected"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body);
}
async function config() {
  return await loadRuntimeConfig(
    ["--project-root", project, "--trusted-root", workspace], {}
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gungnir-mcp-project-"));
  workspace = join(root, "workspace");
  project = join(workspace, "inventory");
  outside = join(root, "outside");
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("trusted Gungnir project intelligence", () => {
  it("detects a structured project and maps modules to their dotted names and categories", async () => {
    await file(join(project, ".gungnir-project"), "name=inventory\nprofile=structured\n");
    await file(join(project, "app", "models", "Product.gnr"));
    await file(join(project, "app", "controllers", "ProductController.gnr"));
    await file(join(project, "routes", "web.gnr"));
    await file(join(project, "database", "migrations", "create_products_table.gnr"));
    await mkdir(join(project, "bootstrap"), { recursive: true });

    const scan = await scanProject(await config());
    expect(scan).toMatchObject({
      profile: "structured", marker: "present", name: "inventory",
      truncated: false,
      structure: { app: true, routes: true, database: true, bootstrap: true }
    });
    const list = listProjectModules(scan);
    expect(list.modules).toEqual([
      { path: "app/controllers/ProductController.gnr", module: "app.controllers.ProductController", category: "controllers" },
      { path: "app/models/Product.gnr", module: "app.models.Product", category: "models" },
      { path: "database/migrations/create_products_table.gnr", module: "database.migrations.create_products_table", category: "migrations" },
      { path: "routes/web.gnr", module: "routes.web", category: "routes" }
    ]);
    expect(summarizeProject(scan).categories).toEqual({
      controllers: 1, models: 1, migrations: 1, routes: 1
    });
    expect(JSON.stringify(scan)).not.toContain(root);
  });

  it("treats a profile-less marker and no marker as legacy projects", async () => {
    await file(join(project, ".gungnir-project"), "name=legacy_app\n");
    const legacy = await scanProject(await config());
    expect(legacy.profile).toBe("legacy");
    expect(legacy.marker).toBe("present");
    await rm(join(project, ".gungnir-project"));
    const missing = await scanProject(await config());
    expect(missing.profile).toBe("legacy");
    expect(missing.marker).toBe("missing");
    expect(missing.diagnostics).toContain("project_marker_missing");
  });

  it("rejects invalid, oversized, duplicate and unrecognized project marker content", async () => {
    const marker = join(project, ".gungnir-project");
    for (const contents of [
      "name=inventory\nprofile=unexpected\n",
      "profile=structured\nprofile=structured\n",
      "name=inventory\nunknown=something\n",
      "name=inventory\nprofile=structured\n".repeat(200)
    ]) {
      await file(marker, contents);
      const scan = await scanProject(await config());
      expect(scan.profile).toBe("invalid");
      expect(scan.name).toBeNull();
      expect(scan.diagnostics).toContain("invalid_project_marker");
    }
  });

  it("does not expose untrusted marker names", async () => {
    await file(join(project, ".gungnir-project"), "name=secrets\nprofile=structured\n");
    const scan = await scanProject(await config());
    expect(scan.name).toBeNull();
  });

  it("excludes hidden, generated, vendor and sensitive paths and never reveals source contents", async () => {
    await file(join(project, ".gungnir-project"), "name=inventory\nprofile=structured\n");
    await file(join(project, "app", "models", "Visible.gnr"), "PRIVATE_SOURCE_DO_NOT_ECHO");
    for (const directory of [
      ".git", ".gungnir", "build", "vendor", "storage", "node_modules",
      "dist", "coverage", "tmp", ".vscode", "secrets", "credentials"
    ]) {
      await file(join(project, directory, "Hidden.gnr"), "TOP_SECRET");
    }
    await file(join(project, ".env"), "API_KEY=hidden");
    await file(join(project, "app", "models", "password.gnr"), "TOP_SECRET");
    await file(join(project, "app", "models", "secrets.gnr"), "TOP_SECRET");

    const scan = await scanProject(await config());
    expect(scan.modules.map(m => m.path)).toEqual(["app/models/Visible.gnr"]);
    const output = JSON.stringify(scan);
    expect(output).not.toContain("PRIVATE_SOURCE_DO_NOT_ECHO");
    expect(output).not.toContain("TOP_SECRET");
    expect(output).not.toContain(".env");
    expect(output).not.toContain("API_KEY");
  });

  it("ignores symlink and junction escapes without listing external files", async () => {
    await file(join(outside, "Outside.gnr"), "secret outside");
    const shortcut = join(project, "external");
    await symlink(outside, shortcut, process.platform === "win32" ? "junction" : "dir");

    const scan = await scanProject(await config());
    expect(scan.modules).toEqual([]);
    expect(scan.diagnostics).toContain("symlinks_ignored");
    expect(JSON.stringify(scan)).not.toContain("Outside.gnr");
  });

  it("refuses inspection when there is no trusted project", async () => {
    await expect(scanProject({ projectRoot: null, trustedRoots: [] }))
      .rejects.toBeInstanceOf(ProjectInspectionError);
    await expect(scanProject({ projectRoot: project, trustedRoots: [] }))
      .rejects.toBeInstanceOf(ProjectInspectionError);
    await expect(scanProject({ projectRoot: outside, trustedRoots: [workspace] }))
      .rejects.toBeInstanceOf(ProjectInspectionError);
  });

  it("enforces the bounded module cap and reports partial results", async () => {
    await mkdir(join(project, "app", "models"), { recursive: true });
    for (let i = 0; i < 210; i++) {
      await file(join(project, "app", "models", "Model_" + String(i).padStart(3, "0") + ".gnr"));
    }
    const scan = await scanProject(await config());
    expect(scan.truncated).toBe(true);
    expect(scan.modules).toHaveLength(200);
    expect(scan.diagnostics).toContain("scan_truncated");
    expect(scan.diagnostics).toContain("module_limit_reached");
    expect(scan.scannedEntries).toBeLessThanOrEqual(2_048);
  });

  it("enforces depth bounds and treats skipped descendants as incomplete", async () => {
    let nested = project;
    for (let i = 0; i < 14; i++) nested = join(nested, "level" + i);
    await file(join(nested, "VeryDeep.gnr"));
    const scan = await scanProject(await config());
    expect(scan.truncated).toBe(true);
    expect(scan.modules).toEqual([]);
    expect(scan.diagnostics).toContain("max_depth_reached");
  });

  it("never treats sensitive or hidden directories as modules even when named .gnr", async () => {
    await mkdir(join(project, "private-key"), { recursive: true });
    await file(join(project, "private-key", "File.gnr"));
    await file(join(project, "app", "models", ".Hidden.gnr"));
    await file(join(project, "app", "models", "Token.gnr"));
    const scan = await scanProject(await config());
    expect(scan.modules.map(m => m.path)).toEqual(["app/models/Token.gnr"]);
  });
});
