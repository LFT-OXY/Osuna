// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { describe, expect, test } from "vitest";

import { describeLegacyEnvVars, findLegacyEnvVars } from "./legacy-env.js";

describe("legacy environment variables", () => {
  test("lists every PASEO_* variable with its OSUNA_* name", () => {
    const legacyEnvVars = findLegacyEnvVars({
      PASEO_LISTEN: "127.0.0.1:7000",
      PATH: "/usr/bin",
      PASEO_HOME: "/srv/paseo",
      OSUNA_RELAY_ENABLED: "false",
    });

    expect(legacyEnvVars).toEqual([
      { name: "PASEO_HOME", replacement: "OSUNA_HOME" },
      { name: "PASEO_LISTEN", replacement: "OSUNA_LISTEN" },
    ]);
    expect(describeLegacyEnvVars(legacyEnvVars)).toBe(
      "Osuna ignores PASEO_* environment variables. Rename PASEO_HOME to OSUNA_HOME, PASEO_LISTEN to OSUNA_LISTEN.",
    );
  });

  test("finds nothing when only OSUNA_* variables are set", () => {
    expect(
      findLegacyEnvVars({ OSUNA_HOME: "/srv/osuna", PATH: "/usr/bin", PASEO_UNSET: undefined }),
    ).toEqual([]);
  });
});
