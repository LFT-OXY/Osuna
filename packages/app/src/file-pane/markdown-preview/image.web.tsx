import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react-native";
import type { ExtraProps } from "react-markdown";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { ICON_SIZE } from "@/styles/theme";
import { useLiveFile } from "../live-file/hook";
import { useFilePreview } from "../preview-lifecycle/hook";
import { resolveFilePreviewLifecycle } from "../preview-lifecycle/model";
import { resolveMarkdownResource, type MarkdownPreviewResources } from "./resource";
import { useMarkdownPreviewResources } from "./resources-context.web";

type ImageAttributes = Omit<ComponentProps<"img">, "src">;

interface MissingImageProps {
  alt: string | undefined;
  source: string | null;
}

function MissingImage({ alt, source }: MissingImageProps) {
  const { t } = useTranslation();
  const label = alt?.trim() || t("message.attachments.imageUnavailable");
  return (
    <span
      role="img"
      aria-label={label}
      title={source ?? undefined}
      className="md-image-missing"
      data-testid="markdown-image-missing"
    >
      <ImageOff aria-hidden size={ICON_SIZE.sm} color="currentColor" />
      <span>{label}</span>
    </span>
  );
}

interface LoadedWorkspaceImageProps {
  uri: string;
  source: string;
  attributes: ImageAttributes;
}

/** 预览地址解码失败（文件损坏）时同样换成占位；文件更新换了地址后重新尝试。 */
function LoadedWorkspaceImage({ uri, source, attributes }: LoadedWorkspaceImageProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const handleError = useCallback(() => setFailedUri(uri), [uri]);
  if (failedUri === uri) return <MissingImage alt={attributes.alt} source={source} />;
  return <img {...attributes} src={uri} onError={handleError} />;
}

interface WorkspaceImageProps {
  resources: MarkdownPreviewResources;
  path: string;
  source: string;
  attributes: ImageAttributes;
}

/** 与文件面板的图片预览同一条链路：读取、转附件、取预览地址，并随文件订阅刷新。 */
function WorkspaceImage({ resources, path, source, attributes }: WorkspaceImageProps) {
  const liveFile = useLiveFile({
    client: resources.client,
    cwd: resources.workspaceRoot,
    path,
    enabled: resources.enabled,
    liveUpdates: resources.liveUpdates,
  });
  const lifecycle = useFilePreview({
    targetKey: `${resources.workspaceRoot}:${path}`,
    liveFileSnapshot: liveFile.snapshot,
  });
  const { file, imageAttachment } = resolveFilePreviewLifecycle(lifecycle);
  const uri = useAttachmentPreviewUrl(imageAttachment);
  const readFailed = lifecycle.status === "error" || lifecycle.status === "unsupported";
  const notAnImage = file !== null && file.kind !== "image";

  if (readFailed || notAnImage) return <MissingImage alt={attributes.alt} source={source} />;
  if (!uri) {
    return <span role="img" aria-label={attributes.alt} aria-busy className="md-image-pending" />;
  }
  return <LoadedWorkspaceImage uri={uri} source={source} attributes={attributes} />;
}

interface ResolvedMarkdownImageProps {
  resources: MarkdownPreviewResources;
  source: string;
  attributes: ImageAttributes;
}

function ResolvedMarkdownImage({ resources, source, attributes }: ResolvedMarkdownImageProps) {
  const target = useMemo(
    () =>
      resolveMarkdownResource({
        href: source,
        documentPath: resources.documentPath,
        workspaceRoot: resources.workspaceRoot,
      }),
    [resources, source],
  );

  if (target.kind === "external") return <img {...attributes} src={target.url} />;
  if (target.kind === "workspace_file") {
    return (
      <WorkspaceImage
        resources={resources}
        path={target.path}
        source={source}
        attributes={attributes}
      />
    );
  }
  return <MissingImage alt={attributes.alt} source={source} />;
}

export function MarkdownImage({
  node: _node,
  src,
  ...attributes
}: ComponentProps<"img"> & ExtraProps) {
  const resources = useMarkdownPreviewResources();
  const source = typeof src === "string" && src.trim() !== "" ? src : null;
  if (!resources || source === null) {
    return <MissingImage alt={attributes.alt} source={source} />;
  }
  return <ResolvedMarkdownImage resources={resources} source={source} attributes={attributes} />;
}
