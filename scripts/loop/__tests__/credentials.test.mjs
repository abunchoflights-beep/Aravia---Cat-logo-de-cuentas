import { describe, expect, it } from "vite-plus/test";
import { agentapiEnv, resolveCredentials } from "../lib/credentials.mjs";

describe("credentials resolution (Fresh credentials win)", () => {
  it("uses env credentials when both env and config provide values", () => {
    const env = {
      ANTIGRAVITY_LS_ADDRESS: "env-address:1234",
      ANTIGRAVITY_CSRF_TOKEN: "fresh-env-token",
    };
    const config = {
      lsAddress: "config-address:5678",
      csrfToken: "stale-config-token",
    };

    const creds = resolveCredentials(env, config);
    expect(creds.lsAddress).toBe("env-address:1234");
    expect(creds.csrfToken).toBe("fresh-env-token");
    expect(creds.source).toEqual({
      lsAddress: "env",
      csrfToken: "env",
    });
  });

  it("uses env token even when config has a stale token (acceptance test)", () => {
    const env = {
      ANTIGRAVITY_CSRF_TOKEN: "fresh-valid-token-from-env",
    };
    const config = {
      csrfToken: "stale-token-in-config",
    };

    const creds = resolveCredentials(env, config);
    expect(creds.csrfToken).toBe("fresh-valid-token-from-env");
    expect(creds.source.csrfToken).toBe("env");
  });

  it("falls back to config values when env lacks credentials", () => {
    const env = {};
    const config = {
      lsAddress: "localhost:56173",
      csrfToken: "c9ad75a8-fallback-token",
    };

    const creds = resolveCredentials(env, config);
    expect(creds.lsAddress).toBe("localhost:56173");
    expect(creds.csrfToken).toBe("c9ad75a8-fallback-token");
    expect(creds.source).toEqual({
      lsAddress: "config",
      csrfToken: "config",
    });
  });

  it("reports missing when neither env nor config provides credentials", () => {
    const env = {};
    const config = {};

    const creds = resolveCredentials(env, config);
    expect(creds.lsAddress).toBeNull();
    expect(creds.csrfToken).toBeNull();
    expect(creds.source).toEqual({
      lsAddress: "missing",
      csrfToken: "missing",
    });
  });

  it("constructs agentapiEnv with resolved credentials and strips internal vars", () => {
    const env = {
      ANTIGRAVITY_LS_ADDRESS: "env-host:1111",
      ANTIGRAVITY_CSRF_TOKEN: "env-token-xyz",
      ANTIGRAVITY_CONVERSATION_ID: "conv-123",
      ANTIGRAVITY_SOURCE_METADATA: "meta",
      ANTIGRAVITY_TRAJECTORY_ID: "traj-456",
      PATH: "/usr/bin",
    };
    const config = {
      projectId: "proj-uuid-999",
      lsAddress: "config-host:2222",
      csrfToken: "config-token",
    };

    const result = agentapiEnv(env, config);
    expect(result.ANTIGRAVITY_LS_ADDRESS).toBe("env-host:1111");
    expect(result.ANTIGRAVITY_CSRF_TOKEN).toBe("env-token-xyz");
    expect(result.ANTIGRAVITY_PROJECT_ID).toBe("proj-uuid-999");
    expect(result.ANTIGRAVITY_CONVERSATION_ID).toBeUndefined();
    expect(result.ANTIGRAVITY_SOURCE_METADATA).toBeUndefined();
    expect(result.ANTIGRAVITY_TRAJECTORY_ID).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
  });
});
