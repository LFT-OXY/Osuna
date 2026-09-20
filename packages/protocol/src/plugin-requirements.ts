import type { PluginRequirements } from "./messages.js";
import parse from "semver/functions/parse.js";
import validRange from "semver/ranges/valid.js";
import satisfies from "semver/functions/satisfies.js";

export function validatePluginRequirements(requirements: PluginRequirements | undefined): void {
  const range = requirements?.osuna;
  if (range !== undefined && (!range.trim() || validRange(range) === null)) {
    throw new Error(
      `Invalid requirements.osuna: ${JSON.stringify(range)}. Use an npm semver range such as ">=0.8.0".`,
    );
  }
}

interface PluginCompatibilityInput {
  id: string;
  requirements?: PluginRequirements;
  version: string | null;
  runtime: "daemon" | "app";
}

export function assertPluginCompatibility(input: PluginCompatibilityInput): void {
  validatePluginRequirements(input.requirements);
  // COMPAT(plugin-requirements): added in v0.8.0-beta.1; remove after 2027-03-07 once pre-0.8
  // plugins and catalogs are unsupported. The legacy range excludes 0.8 prereleases and their
  // stable core. Since the Osuna rename this default is also what rejects plugins written for
  // upstream Paseo: they declare `requirements.paseo`, never `requirements.osuna`, so they land
  // here and fail the range check. That rejection is intended — see the task's plugin-contract
  // batch — so do not add a `requirements.osuna` fallback to make them install.
  const range = input.requirements?.osuna ?? "<0.8.0";
  const version = input.version ? parse(input.version) : null;
  if (!version) {
    throw new Error(
      `Cannot check plugin "${input.id}" requirements: Osuna ${input.runtime} version is unknown. Update the ${input.runtime}.`,
    );
  }
  const stableCore = `${version.major}.${version.minor}.${version.patch}`;
  if (satisfies(version, range) || satisfies(stableCore, range)) return;
  const action =
    input.requirements?.osuna === undefined
      ? "This plugin declares no requirements.osuna, so it targets either Paseo (a different product) or Osuna before 0.8. Ask its author to migrate it: https://github.com/LFT-OXY/Osuna/blob/main/public-docs/plugins/v0.8/migration.md"
      : `Use a compatible plugin version or update the ${input.runtime}.`;
  throw new Error(
    `Plugin "${input.id}" requires Osuna ${range}. Your ${input.runtime} is ${input.version}. ${action}`,
  );
}
