import {
  showsEndpointNames,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import { withoutDisabledModels } from "@getpaseo/protocol/api-endpoint/disabled-models";
import {
  distinctModelLabels,
  resolveModelFacts,
} from "@getpaseo/protocol/api-endpoint/model-settings";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 「接口名显示方式」（照 magpie 设置页的 Provider in model names）：纯 TypeScript，无 React（docs/forms.md）。
 * 「第三方接口」页底部与接口详情页各有一处，存的是同一个主机设置。
 * 一选就存；存的时候先显示选的那项，存失败时回到存着的那项，原因留在原处（magpie suffixSegs 失败时按存着的重画）。
 * 别的客户端改了（列表刷新带来新值）时跟着变，自己正在存时不动。
 */

export type EndpointNameDisplayStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string };

export interface EndpointNameDisplayFormState {
  display: ApiEndpointNameDisplay;
  status: EndpointNameDisplayStatus;
}

export interface EndpointNameDisplayForm {
  getState(): EndpointNameDisplayFormState;
  subscribe(listener: () => void): () => void;
  choose(display: ApiEndpointNameDisplay): Promise<void>;
  // 主机上的值变了（列表刷新）。
  hostChanged(display: ApiEndpointNameDisplay): void;
}

export function openEndpointNameDisplayForm(input: {
  initial: ApiEndpointNameDisplay;
  // 失败原因，成功为 null。
  save: (display: ApiEndpointNameDisplay) => Promise<string | null>;
}): EndpointNameDisplayForm {
  let saved = input.initial;
  let state: EndpointNameDisplayFormState = { display: saved, status: { kind: "idle" } };
  const listeners = new Set<() => void>();
  function publish(next: EndpointNameDisplayFormState) {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async choose(display) {
      if (display === state.display && state.status.kind !== "saving") return;
      publish({ display, status: { kind: "saving" } });
      const failure = await input.save(display);
      if (failure === null) {
        saved = display;
        publish({ display, status: { kind: "idle" } });
        return;
      }
      publish({ display: saved, status: { kind: "failed", message: failure } });
    },
    hostChanged(display) {
      if (state.status.kind === "saving" || display === saved) return;
      saved = display;
      publish({ display, status: { kind: "idle" } });
    },
  };
}

type PreviewEndpoint = Pick<
  ApiEndpoint,
  "name" | "slug" | "enabled" | "models" | "modelSettings" | "modelFacts"
>;

/**
 * 接口详情页的预览（magpie 的 Agents’ lists show “{label}”）：这家第一个在服务的模型在选单里叫什么。
 * 和 daemon 给选单起名用同一套：去掉已禁用的模型（withoutDisabledModels），名字按模型设置与自动取到的资料
 * （resolveModelFacts），同一家里撞名的改显示模型 id（distinctModelLabels），再按开着的接口一起判断同名。
 * 这家没有在服务的模型时为 null。
 */
export function endpointNamePreview(input: {
  endpoint: PreviewEndpoint;
  endpoints: readonly PreviewEndpoint[];
  display: ApiEndpointNameDisplay;
  disabledModels: readonly string[];
}): string | null {
  const { endpoint } = input;
  const listed = input.endpoints.filter(
    (candidate) => candidate === endpoint || candidate.enabled !== false,
  );
  const labelled = listed.map((candidate) => ({
    endpoint: candidate,
    labels: shownLabels({ endpoint: candidate, disabledModels: input.disabledModels }),
  }));
  const own = labelled.find((entry) => entry.endpoint === endpoint);
  if (own === undefined) return null;
  const first = own.labels[0];
  if (first === undefined) return null;
  const names = labelled.flatMap((entry) => entry.labels);
  // 这家第一个模型在整份名字里的位置：排在它前面的几家的模型数。
  const position = labelled
    .slice(0, labelled.indexOf(own))
    .reduce((count, entry) => count + entry.labels.length, 0);
  const shows = showsEndpointNames({ display: input.display, names });
  return shows[position] ? `${first} (${endpoint.name})` : first;
}

/** 一家在服务的模型在选单里的名字，按顺序。 */
function shownLabels(input: {
  endpoint: PreviewEndpoint;
  disabledModels: readonly string[];
}): string[] {
  const { endpoint } = input;
  const served = withoutDisabledModels({
    patterns: input.disabledModels,
    slug: endpoint.slug ?? "",
    models: endpoint.models,
  });
  return distinctModelLabels(
    served.map((model) => ({
      id: model.id,
      label:
        resolveModelFacts({
          settings: endpoint.modelSettings,
          modelId: model.id,
          auto: endpoint.modelFacts?.[model.id] ?? {},
        }).name ?? model.id,
    })),
  );
}
