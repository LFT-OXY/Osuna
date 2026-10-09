// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
const LEGACY_PREFIX = "PASEO_";
const CURRENT_PREFIX = "OSUNA_";

export interface LegacyEnvVar {
  name: string;
  replacement: string;
}

// 旧变量不再生效也不做别名，只负责点名，免得配置静默失效。
export function findLegacyEnvVars(env: NodeJS.ProcessEnv): LegacyEnvVar[] {
  const names = Object.keys(env).filter(
    (name) => name.startsWith(LEGACY_PREFIX) && env[name] !== undefined,
  );
  return names.sort().map((name) => ({
    name,
    replacement: `${CURRENT_PREFIX}${name.slice(LEGACY_PREFIX.length)}`,
  }));
}

export function describeLegacyEnvVars(legacyEnvVars: LegacyEnvVar[]): string {
  const renames = legacyEnvVars.map(({ name, replacement }) => `${name} to ${replacement}`);
  return `Osuna ignores ${LEGACY_PREFIX}* environment variables. Rename ${renames.join(", ")}.`;
}
