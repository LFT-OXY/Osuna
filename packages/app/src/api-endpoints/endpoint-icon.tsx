import { Buffer } from "buffer";
import React, { createContext, useContext, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgIcon, scopeSvgIds } from "@/components/provider-icons";
import { Text } from "@/components/ui/text";
import { isWeb } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { TextVariant, Theme } from "@/styles/theme";
import {
  BUILT_IN_ICONS,
  builtInIconOf,
  isStoredIcon,
  type BuiltInIcon,
} from "./internal/endpoint-icon-names";

const ThemedSvgIcon = withUnistyles(SvgIcon);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/** 取存下的图标要问哪台主机；接口列表页与详情页提供，模板列表不用。 */
const EndpointIconHostContext = createContext<string | null>(null);

export function EndpointIconHostProvider({
  serverId,
  children,
}: {
  serverId: string;
  children: React.ReactNode;
}) {
  return (
    <EndpointIconHostContext.Provider value={serverId}>{children}</EndpointIconHostContext.Provider>
  );
}

/**
 * 接口或模板的图标：接口自选的（内置图标名或存下的图片）优先，其次按模板 id 取品牌图标，都没有（「自定义」、不认识的模板、
 * 图片还没取到或已不在）用名称首字，字号由调用方给。彩色的自带颜色，单色的跟前景色。
 */
export function EndpointIcon({
  icon,
  templateId,
  name,
  size,
  initialVariant,
}: {
  // 接口自选的图标；没选为 null。
  icon: string | null;
  templateId: string | null;
  name: string;
  size: number;
  initialVariant: TextVariant;
}) {
  if (icon !== null && isStoredIcon(icon)) {
    return <StoredIcon icon={icon} size={size} name={name} initialVariant={initialVariant} />;
  }
  const builtIn = builtInIconOf({ icon, templateId });
  if (builtIn === null) return <Initial name={name} variant={initialVariant} />;
  return <BuiltInIconView icon={builtIn} size={size} />;
}

/** 内置图标名画出来的样子（挑选格子用）；认不出的名字画不出，为 null。 */
export function BuiltInEndpointIcon({ name, size }: { name: string; size: number }) {
  const icon = BUILT_IN_ICONS[name] ?? null;
  if (icon === null) return null;
  return <BuiltInIconView icon={icon} size={size} />;
}

function Initial({ name, variant }: { name: string; variant: TextVariant }) {
  return <Text variant={variant}>{Array.from(name.trim())[0]?.toUpperCase() ?? "?"}</Text>;
}

function BuiltInIconView({ icon, size }: { icon: BuiltInIcon; size: number }) {
  if (icon.kind === "png") return <ImageIcon uri={icon.uri} size={size} />;
  return <BrandIcon svg={icon.svg} size={size} />;
}

// 渐变 id 每个实例各带后缀，免得网页上同名 id 取到别处那份（见 provider-icons.ts）。
function BrandIcon({ svg: markup, size }: { svg: string; size: number }) {
  const suffix = useId().replace(/[^A-Za-z0-9_]/g, "");
  const scoped = useMemo(() => scopeSvgIds(markup, suffix), [markup, suffix]);
  return <ThemedSvgIcon svg={scoped} size={size} uniProps={foregroundColorMapping} />;
}

function ImageIcon({ uri, size }: { uri: string; size: number }) {
  const source = useMemo(() => ({ uri }), [uri]);
  const sizeStyle = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image source={source} style={[styles.image, sizeStyle]} resizeMode="contain" />;
}

/**
 * 存下的图片：按主机与图标值取一次就一直用（按内容起名，内容不会变）。网页上一律当图片画（SVG 也不当标记插进页面）；
 * 原生端 Image 画不了 SVG，SVG 按标记画。没有主机可问（模板列表）时用首字。
 */
interface StoredIconProps {
  icon: string;
  size: number;
  // 图片取不到时画名称首字。
  name: string;
  initialVariant: TextVariant;
}

function StoredIcon(props: StoredIconProps) {
  const serverId = useContext(EndpointIconHostContext);
  if (serverId === null) return <Initial name={props.name} variant={props.initialVariant} />;
  return <StoredIconOnHost serverId={serverId} {...props} />;
}

function StoredIconOnHost({
  serverId,
  icon,
  size,
  name,
  initialVariant,
}: StoredIconProps & { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-icon", serverId, icon],
    dataShape: "value",
    immutableWhen: () => true,
    enabled: Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointReadIcon({ icon });
      if (response.error) throw new Error(response.error.message);
      return response.icon;
    },
  });
  const image = query.data ?? null;
  if (image === null) return <Initial name={name} variant={initialVariant} />;
  if (!isWeb && image.mimeType === "image/svg+xml") {
    return <BrandIcon svg={Buffer.from(image.data, "base64").toString("utf8")} size={size} />;
  }
  return <ImageIcon uri={`data:${image.mimeType};base64,${image.data}`} size={size} />;
}

const styles = StyleSheet.create({
  image: {
    flexShrink: 0,
  },
});
