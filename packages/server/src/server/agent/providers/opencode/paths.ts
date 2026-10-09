import path from "node:path";

import { resolveOsunaHome } from "../../../osuna-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveOsunaHome(env), OPENCODE_HOME_DIRNAME);
}
