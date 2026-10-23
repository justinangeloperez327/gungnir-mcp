import type { RuntimeConfig } from "./config.js";

export const SERVER_NAME = "gungnir-mcp";
export const SERVER_VERSION = "0.5.0";

export interface FoundationStatus {
  readonly name: string;
  readonly version: string;
  readonly implementationGroup: number;
  readonly capabilities: readonly string[];
  readonly nativeCliAvailable: "not-checked";
  readonly projectMutationEnabled: false;
  readonly projectAccess: "trusted" | "disabled";
}

export function foundationStatus(config: RuntimeConfig = { projectRoot: null, trustedRoots: [] }): FoundationStatus {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    implementationGroup: 5,
    capabilities: ["gungnir_status", "gungnir_toolchain_info"],
    nativeCliAvailable: "not-checked",
    projectMutationEnabled: false,
    projectAccess: config.projectRoot === null ? "disabled" : "trusted"
  };
}
