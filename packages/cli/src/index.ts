import { describeLegacyEnvVars, findLegacyEnvVars } from "@osuna/server";
import { runCli } from "./run.js";

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
const legacyEnvVars = findLegacyEnvVars(process.env);
if (legacyEnvVars.length > 0) {
  process.stderr.write(`Warning: ${describeLegacyEnvVars(legacyEnvVars)}\n`);
}

const exitCode = await runCli(process.argv.slice(2), {
  nodeArgv: [process.argv[0] ?? "node", process.argv[1] ?? "osuna"],
});
process.exitCode = exitCode;
