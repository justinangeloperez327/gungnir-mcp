export const SERVER_NAME = "gungnir-mcp";
export const SERVER_VERSION = "0.2.0";

export interface FoundationStatus {
  readonly name: string;
  readonly version: string;
  readonly implementationGroup: number;
  readonly capabilities: readonly string[];
  readonly nativeCliAvailable: "not-checked";
  readonly projectMutationEnabled: false;
}

export function foundationStatus(): FoundationStatus {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    implementationGroup: 2,
    capabilities: ["gungnir_status"],
    nativeCliAvailable: "not-checked",
    projectMutationEnabled: false
  };
}
