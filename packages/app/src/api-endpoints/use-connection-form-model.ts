import { useEffect, useState } from "react";
import {
  createConnectionFormModel,
  type ConnectionFormDeps,
  type ConnectionFormOptions,
  type ConnectionFormSeed,
} from "./internal/connection-form-model";

/** 模型只在挂载时构造一次，卸载时关闭（顺带取消还在进行的自动检测）；seed、options 之后再变也不重建。 */
export function useConnectionFormModel(
  seed: ConnectionFormSeed,
  deps: ConnectionFormDeps,
  options: ConnectionFormOptions,
) {
  const [model] = useState(() => createConnectionFormModel(seed, deps, options));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  return model;
}
