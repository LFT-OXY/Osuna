import { useCallback, useMemo, useState } from "react";
import type {
  ApiEndpoint,
  ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRequestFormat, pinnedFormat } from "@getpaseo/protocol/api-endpoint/model-settings";
import {
  choosableFormats,
  withModelFormat,
  type SaveModelSettings,
} from "./internal/model-settings-form";
import type { ModelFormatPins } from "./models-section";

/**
 * 模型行上的「只用这种格式」（照 magpie 模型行的 Asked on…）：这家有两种以上格式的地址才有；选了立刻保存，
 * 失败原因交给详情页头部的提示，下次设成功时清掉。作废的设置行上照样标出、写明不起作用。
 */
export function useFormatPins(input: {
  endpoint: ApiEndpoint;
  hasManagement: boolean;
  save: SaveModelSettings;
}): { pins: ModelFormatPins | null; error: string | null } {
  const { endpoint, hasManagement, save } = input;
  const [error, setError] = useState<string | null>(null);
  const onPin = useCallback(
    (modelId: string, format: ApiEndpointRequestFormat | null) => {
      void (async () => {
        const failure = await save((current) => withModelFormat({ current, modelId, format }));
        setError(failure);
      })();
    },
    [save],
  );
  const pins = useMemo<ModelFormatPins | null>(() => {
    const formats = choosableFormats(endpoint);
    if (!hasManagement || formats.length === 0) return null;
    const baseUrls = endpoint.baseUrls ?? [];
    return {
      formats,
      pinOf: (modelId) => {
        const pin = pinnedFormat({ settings: endpoint.modelSettings, modelId, baseUrls });
        if (pin.kind === "pinned") return { format: pin.format, isVoid: false };
        // 作废的也标出来（照 magpie：这家有两种以上地址就显示存着的格式）；不认识的格式不算。
        if (pin.kind !== "void" || !isRequestFormat(pin.format)) return null;
        return { format: pin.format, isVoid: true };
      },
      onPin,
    };
  }, [endpoint, hasManagement, onPin]);
  return { pins, error };
}
