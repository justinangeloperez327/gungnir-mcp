import { describe, expect, it } from "vitest";

import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "../src/status.js";

describe("Group 4 status", () => {
  it("reports truthful group identity and unimplemented project mutations", () => {
    const status = foundationStatus();
    expect(status.name).toBe(SERVER_NAME);
    expect(status.version).toBe(SERVER_VERSION);
    expect(status.implementationGroup).toBe(3);
    expect(status.capabilities).toEqual(["gungnir_status", "gungnir_toolchain_info"]);
    expect(status.nativeCliAvailable).toBe("not-checked");
    expect(status.projectMutationEnabled).toBe(false);
    expect(status.projectAccess).toBe("disabled");
  });

  it("reports trusted status without revealing filesystem paths", () => {
    const status = foundationStatus({ projectRoot: "/private/user/project", trustedRoots: ["/private/user"] });
    expect(status.projectAccess).toBe("trusted");
    expect(JSON.stringify(status)).not.toContain("/private/user");
  });
});
