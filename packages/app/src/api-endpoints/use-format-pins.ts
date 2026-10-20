import { useCallback, useMemo, useState } from "react";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { pinnedFormat } from "@getpaseo/protocol/api-endpoint/model-settings";
import {
  choosableFormats,
  withModelFormat,
  type SaveModelSettings,
} from "./internal/model-settings-form";
import type { ModelFormatPins } from "./models-section";

/**
 * 模型行上的「只用这种格式」（照 magpie 模型行的 Asked on…）：这家有两种以上格式的地址才有；选了立刻保存，
 * 失败原因交给详情页头部的提示，下次设成功时清掉。作废的设置行上不标，模型设置里说明。
 */
export function useFormatPins(input: {
  endpoint: ApiEndpoint;
  hasManagement: boolean;
  save: SaveModelSettings;
}): { pins: ModelFormatPins | null; error: string | null } {
  const { endpoint, hasManagement, save } = input;
  const [error, setError] = useState<string | null>(null);
  const onPin = useCallback(
    (modelId: string, format: string | null) => {
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
        return pin.kind === "pinned" ? pin.format : null;
      },
      onPin,
    };
  }, [endpoint, hasManagement, onPin]);
  return { pins, error };
}
