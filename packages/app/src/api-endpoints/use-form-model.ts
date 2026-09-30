import { useEffect, useState } from "react";
import {
  createApiEndpointFormModel,
  type ApiEndpointFormSeed,
  type ApiEndpointSaveRequestInput,
  type ApiEndpointSaveResult,
} from "./internal/form-model";

/** 模型只在挂载时构造一次，卸载时关闭；打开时的 seed 之后再变也不重建。 */
export function useApiEndpointFormModel(
  seed: ApiEndpointFormSeed,
  save: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult>,
) {
  const [model] = useState(() => createApiEndpointFormModel(seed, { save }));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  return model;
}
