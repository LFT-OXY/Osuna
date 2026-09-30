import { useEffect, useState } from "react";
import {
  createApiEndpointFormModel,
  type ApiEndpointFormDeps,
  type ApiEndpointFormSeed,
} from "./internal/form-model";

/** 模型只在挂载时构造一次，卸载时关闭（顺带取消还在进行的拉取）；打开时的 seed 之后再变也不重建。 */
export function useApiEndpointFormModel(seed: ApiEndpointFormSeed, deps: ApiEndpointFormDeps) {
  const [model] = useState(() => createApiEndpointFormModel(seed, deps));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  return model;
}
