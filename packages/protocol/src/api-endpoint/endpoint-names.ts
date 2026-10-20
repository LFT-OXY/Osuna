/**
 * 接口名显示方式（Endpoint name in model lists，整台主机共用，照 magpie 的 Provider in model names）：
 * always 每个接口模型后面都带接口名（缺省）；clash 只有几家用同一个名字时带；never 都不带。
 * 线上是字符串，以后加方式时老客户端照常解析；没有或认不出的当 always。
 */
export const API_ENDPOINT_NAME_DISPLAYS = ["always", "clash", "never"] as const;
export type ApiEndpointNameDisplay = (typeof API_ENDPOINT_NAME_DISPLAYS)[number];

export function isApiEndpointNameDisplay(value: string): value is ApiEndpointNameDisplay {
  return (API_ENDPOINT_NAME_DISPLAYS as readonly string[]).includes(value);
}

/** 线上或文件里读到的值：没有（老主机、没设）或认不出的都当 always。只在边界上用这一处。 */
export function apiEndpointNameDisplayOf(value: string | undefined): ApiEndpointNameDisplay {
  return value !== undefined && isApiEndpointNameDisplay(value) ? value : "always";
}

/**
 * 一个选单里各家接口的模型（names 是选单里显示的名字，同一家里已不撞名）后面带不带接口名；
 * clash 时名字不分大小写和别的一条一样的才带（magpie provider.Labels 的 same）。
 */
export function showsEndpointNames(input: {
  display: ApiEndpointNameDisplay;
  names: ReadonlyArray<string>;
}): boolean[] {
  const { display, names } = input;
  if (display === "never") return names.map(() => false);
  if (display === "always") return names.map(() => true);
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return names.map((name) => (counts.get(name.toLowerCase()) ?? 0) > 1);
}
