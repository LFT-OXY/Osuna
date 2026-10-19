import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { ConnectionFormModel } from "./internal/connection-form-model";

// 添加窗口里跟粘贴 curl 有关的输入框：地址框与 key 框收粘贴，「模型」框只被改写。
export type CurlPasteField = "address" | "apiKey" | "models";

export interface CurlPasteFieldInput {
  model: ConnectionFormModel;
  field: CurlPasteField;
}

// 交给输入框的回调 ref。
export type CurlPasteFieldRef = (handle: EditingTextInputHandle | null) => void;
