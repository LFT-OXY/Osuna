import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-lft-oxy",
              accountLogin: "lft-oxy",
              accountType: "Organization",
              repositories: ["lft-oxy/osuna"],
            },
          ],
          slack: [{ slug: "osuna", teamName: "Osuna" }],
          discord: [{ slug: "osuna-discord", guildName: "Osuna Discord" }],
          daemons: [],
          linear: [],
        },
        "lft-oxy/osuna",
      ),
    ).toEqual([
      {
        id: "github:lft-oxy/osuna",
        label: "GitHub — lft-oxy/osuna",
        provider: "github",
        filters: { connection: "github-lft-oxy", repo: "lft-oxy/osuna" },
      },
      {
        id: "slack:osuna",
        label: "Slack — Osuna",
        provider: "slack",
        filters: { connection: "osuna" },
      },
      {
        id: "discord:osuna-discord",
        label: "Discord — Osuna Discord",
        provider: "discord",
        filters: { connection: "osuna-discord" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-lft-oxy",
              accountLogin: "lft-oxy",
              accountType: "Organization",
              repositories: ["lft-oxy/hub"],
            },
          ],
          slack: [],
          discord: [],
          daemons: [],
          linear: [],
        },
        "lft-oxy/osuna",
      ),
    ).toEqual([]);
  });
});
