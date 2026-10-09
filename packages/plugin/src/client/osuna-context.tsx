import type { OsunaApi } from "@osuna/client";
import { createContext, useContext, type ReactNode } from "react";

const OsunaApiContext = createContext<OsunaApi | null>(null);

export function useOsunaContextValue(): OsunaApi | null {
  return useContext(OsunaApiContext);
}

export function OsunaApiProvider({ children, osuna }: { children: ReactNode; osuna: OsunaApi }) {
  return <OsunaApiContext.Provider value={osuna}>{children}</OsunaApiContext.Provider>;
}

export function useOsuna(): OsunaApi {
  const osuna = useOsunaContextValue();
  if (!osuna) throw new Error("useOsuna must run inside a contributed plugin surface");
  return osuna;
}
