import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { userScopedKey } from "@/lib/user-scope";
import { useSync } from "@/lib/sync-context";

const FERRY_CONFIG_KEY = "tacoplan_ferry_config";

export type RouteMode = "spain" | "morocco";
export type PaymentMode = "spain_diet" | "morocco_trip" | "morocco_pernight" | "morocco_diet";

export interface FerryConfig {
  crossesFerry: boolean;
  routeMode: RouteMode;
  paymentMode: PaymentMode;
  tripRate: number;
  pernightRate: number;
  ferryRestEnabled: boolean;
  ferryTransitRate: number;
  ferryCabinRate: number;
  _updated_at?: string;
}

const DEFAULT_CONFIG: FerryConfig = {
  crossesFerry: false,
  routeMode: "spain",
  paymentMode: "spain_diet",
  tripRate: 0,
  pernightRate: 0,
  ferryRestEnabled: false,
  ferryTransitRate: 54.30,
  ferryCabinRate: 54.30,
};

interface FerryContextValue {
  config: FerryConfig;
  updateConfig: (partial: Partial<FerryConfig>) => Promise<void>;
  isLoaded: boolean;
  isMoroccoMode: boolean;
  isFerryRestMode: boolean;
}

const FerryContext = createContext<FerryContextValue>({
  config: DEFAULT_CONFIG,
  updateConfig: async () => {},
  isLoaded: false,
  isMoroccoMode: false,
  isFerryRestMode: false,
});

export function FerryProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<FerryConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);
  const { syncVersion } = useSync();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(await userScopedKey(FERRY_CONFIG_KEY));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!cancelled) setConfig({ ...DEFAULT_CONFIG, ...parsed });
        }
      } catch {}
      if (!cancelled) setIsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncVersion]);

  const updateConfig = useCallback(async (partial: Partial<FerryConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial, _updated_at: new Date().toISOString() };
      userScopedKey(FERRY_CONFIG_KEY).then((k) => AsyncStorage.setItem(k, JSON.stringify(next))).catch(() => {});
      return next;
    });
  }, []);

  const isMoroccoMode = config.crossesFerry && config.routeMode === "morocco" && config.paymentMode !== "spain_diet";
  const isFerryRestMode = config.crossesFerry && config.ferryRestEnabled;

  return (
    <FerryContext.Provider value={{ config, updateConfig, isLoaded, isMoroccoMode, isFerryRestMode }}>
      {children}
    </FerryContext.Provider>
  );
}

export function useFerry() {
  return useContext(FerryContext);
}
