import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Osuna.app/Contents/MacOS/Osuna",
        shimPath: "/Applications/Osuna.app/Contents/Resources/bin/osuna",
      }),
    ).toBe("/Applications/Osuna.app/Contents/Resources/bin/osuna");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_osuna123/osuna",
        shimPath: "/tmp/.mount_osuna123/resources/bin/osuna",
        appImagePath: "/home/user/Applications/Osuna.AppImage",
      }),
    ).toBe("/home/user/Applications/Osuna.AppImage");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Osuna/Osuna",
        shimPath: "/opt/Osuna/resources/bin/osuna",
      }),
    ).toBe("/opt/Osuna/resources/bin/osuna");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Osuna\\Osuna.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Osuna\\resources\\bin\\osuna.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Osuna\\resources\\bin\\osuna.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Osuna/osuna",
        shimPath: "/opt/Osuna/resources/bin/osuna",
      }),
    ).toBe("/opt/Osuna/resources/bin/osuna");
  });
});
