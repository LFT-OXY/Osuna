import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, OSUNA_HUB_URL, then the active stored login. There is no hosted fallback.\nCredential precedence: --api-key, OSUNA_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
