import { createContext, useContext } from "react";
import type { MarkdownPreviewResources } from "./resource";

export const MarkdownPreviewResourcesContext = createContext<MarkdownPreviewResources | null>(null);

export function useMarkdownPreviewResources(): MarkdownPreviewResources | null {
  return useContext(MarkdownPreviewResourcesContext);
}
