import {
  isApiEndpointNameDisplay,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";

/*
 * 「第三方接口」页的「接口名显示方式」（照 magpie 设置页的 Provider in model names）：纯 TypeScript，无 React（docs/forms.md）。
 * 一选就存；存的时候先显示选的那项，存失败时回到存着的那项，原因留在原处（magpie suffixSegs 失败时按存着的重画）。
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
}

export function openEndpointNameDisplayForm(input: {
  // 主机存着的；老主机不发为 undefined。
  initial: string | undefined;
  // 失败原因，成功为 null。
  save: (display: ApiEndpointNameDisplay) => Promise<string | null>;
}): EndpointNameDisplayForm {
  let saved: ApiEndpointNameDisplay =
    input.initial !== undefined && isApiEndpointNameDisplay(input.initial)
      ? input.initial
      : "always";
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
  };
}
