import {
  showsEndpointNames,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
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

type PreviewEndpoint = Pick<ApiEndpoint, "name" | "enabled" | "models" | "modelSettings">;

/**
 * 接口详情页的预览（magpie 的 Agents’ lists show “{label}”）：这家第一个已选模型在选单里叫什么。
 * 名字取用户起的、再是清单给的、都没有是模型 id；同名按开着的接口的已选模型一起算。没有已选模型为 null。
 */
export function endpointNamePreview(input: {
  endpoint: PreviewEndpoint;
  endpoints: readonly PreviewEndpoint[];
  display: ApiEndpointNameDisplay;
}): string | null {
  const { endpoint } = input;
  const first = endpoint.models[0];
  if (first === undefined) return null;
  const listed = input.endpoints.filter(
    (candidate) => candidate === endpoint || candidate.enabled !== false,
  );
  const names = listed.flatMap((candidate) =>
    candidate.models.map((model) => nameOf(candidate, model)),
  );
  const own = nameOf(endpoint, first);
  const ownIndex = listed
    .slice(0, listed.indexOf(endpoint))
    .reduce((count, candidate) => count + candidate.models.length, 0);
  const shows = showsEndpointNames({ display: input.display, names });
  return shows[ownIndex] ? `${own} (${endpoint.name})` : own;
}

function nameOf(endpoint: PreviewEndpoint, model: PreviewEndpoint["models"][number]): string {
  return endpoint.modelSettings?.models?.[model.id]?.name ?? model.label ?? model.id;
}
