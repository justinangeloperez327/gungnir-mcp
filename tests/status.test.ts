import { describe, expect, it } from "vitest";

import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "../src/status.js";

describe("Group 2 status", () => {
  it("identifies this server as the Gungnir MCP protocol foundation", () => {
    const status = foundationStatus();
    expect(status.name).toBe(SERVER_NAME);
    expect(status.version).toBe(SERVER_VERSION);
    expect(status.implementationGroup).toBe(2);
  });

  it("does not claim unimplemented native or mutation capabilities", () => {
    const status = foundationStatus();
    expect(status.capabilities).toEqual(["gungnir_status"]);
    expect(status.nativeCliAvailable).toBe("not-checked");
    expect(status.projectMutationEnabled).toBe(false);
  });
});
