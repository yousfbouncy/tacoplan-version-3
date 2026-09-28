import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { userScopedKey } from "@/lib/user-scope";
import { useSync } from "@/lib/sync-context";

export type PeriodMode = "AUTO_01_30" | "AUTO_20_20" | "AUTO_MONTH" | "MANUAL";

export interface PeriodConfig {
  mode: PeriodMode;
  manualFrom: number;
  manualTo: number;
  _updated_at?: string;
}

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

interface PeriodContextValue {
  config: PeriodConfig;
  isLoaded: boolean;
  needsSetup: boolean;
  getPeriod: (offset?: number) => PeriodRange;
  saveConfig: (cfg: PeriodConfig) => Promise<void>;
}

const PERIOD_KEY = "tacoplan_period_config";

const DEFAULT_CONFIG: PeriodConfig = {
  mode: "AUTO_01_30",
  manualFrom: 1,
  manualTo: 30,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function computeRange(mode: PeriodMode, manualFrom: number, manualTo: number, refDate?: Date): PeriodRange {
  const d = refDate || new Date();
  const year = d.getFullYear();
  const month0 = d.getMonth();
  const day = d.getDate();

  let fromYear: number, fromMonth1: number, fromDay: number;
  let toYear: number, toMonth1: number, toDay: number;

  if (mode === "AUTO_MONTH") {
    fromYear = year;
    fromMonth1 = month0 + 1;
    fromDay = 1;
    toYear = year;
    toMonth1 = month0 + 1;
    toDay = lastDayOfMonth(year, month0 + 1);
  } else if (mode === "AUTO_01_30") {
    fromYear = year;
    fromMonth1 = month0 + 1;
    fromDay = 1;
    toYear = year;
    toMonth1 = month0 + 1;
    const lastDay = lastDayOfMonth(year, month0 + 1);
    toDay = Math.min(30, lastDay);
  } else if (mode === "AUTO_20_20") {
    if (day > 20) {
      fromYear = year;
      fromMonth1 = month0 + 1;
      fromDay = 21;
      let nm = month0 + 2;
      let ny = year;
      if (nm > 12) { nm = 1; ny++; }
      toYear = ny;
      toMonth1 = nm;
      toDay = 20;
    } else {
      let pm = month0;
      let py = year;
      if (pm < 1) { pm = 12; py--; }
      fromYear = py;
      fromMonth1 = pm;
      fromDay = 21;
      toYear = year;
      toMonth1 = month0 + 1;
      toDay = 20;
    }

    if (fromYear === toYear && fromMonth1 === toMonth1 && fromDay === toDay) {
      console.warn("[PeriodContext] AUTO_20_20 bug: from === to, applying fallback");
      let nm = fromMonth1 + 1;
      let ny = fromYear;
      if (nm > 12) { nm = 1; ny++; }
      toYear = ny;
      toMonth1 = nm;
      toDay = 20;
    }
  } else {
    const sd = manualFrom;
    const ed = manualTo;

    if (ed >= sd) {
      fromYear = year;
      fromMonth1 = month0 + 1;
      let ldFrom = lastDayOfMonth(year, month0 + 1);
      fromDay = Math.min(sd, ldFrom);
      toYear = year;
      toMonth1 = month0 + 1;
      toDay = Math.min(ed, ldFrom);

      if (day < sd) {
        let pm = month0;
        let py = year;
        if (pm < 1) { pm = 12; py--; }
        fromYear = py;
        fromMonth1 = pm;
        const ld = lastDayOfMonth(py, pm);
        fromDay = Math.min(sd, ld);
        toYear = py;
        toMonth1 = pm;
        toDay = Math.min(ed, ld);
      } else if (day > ed) {
        let nm = month0 + 2;
        let ny = year;
        if (nm > 12) { nm = 1; ny++; }
        fromYear = ny;
        fromMonth1 = nm;
        const ld = lastDayOfMonth(ny, nm);
        fromDay = Math.min(sd, ld);
        toYear = ny;
        toMonth1 = nm;
        toDay = Math.min(ed, ld);
      }
    } else {
      if (day > ed) {
        fromYear = year;
        fromMonth1 = month0 + 1;
        let ldF = lastDayOfMonth(year, month0 + 1);
        fromDay = Math.min(sd, ldF);
        let nm = month0 + 2;
        let ny = year;
        if (nm > 12) { nm = 1; ny++; }
        toYear = ny;
        toMonth1 = nm;
        let ldT = lastDayOfMonth(ny, nm);
        toDay = Math.min(ed, ldT);
      } else {
        let pm = month0;
        let py = year;
        if (pm < 1) { pm = 12; py--; }
        fromYear = py;
        fromMonth1 = pm;
        let ldF = lastDayOfMonth(py, pm);
        fromDay = Math.min(sd, ldF);
        toYear = year;
        toMonth1 = month0 + 1;
        let ldT = lastDayOfMonth(year, month0 + 1);
        toDay = Math.min(ed, ldT);
      }
    }
  }

  const fromStr = `${fromYear}-${pad2(fromMonth1)}-${pad2(fromDay)}`;
  const toStr = `${toYear}-${pad2(toMonth1)}-${pad2(toDay)}`;

  if (fromStr >= toStr) {
    console.warn(`[PeriodContext] Invalid range from=${fromStr} to=${toStr}, fixing`);
    let nm = fromMonth1 + 1;
    let ny = fromYear;
    if (nm > 12) { nm = 1; ny++; }
    const fixedTo = `${ny}-${pad2(nm)}-${pad2(toDay)}`;
    const label = `${pad2(fromDay)}/${pad2(fromMonth1)}/${fromYear} - ${pad2(toDay)}/${pad2(nm)}/${ny}`;
    return { from: fromStr, to: fixedTo, label };
  }

  const label = `${pad2(fromDay)}/${pad2(fromMonth1)}/${fromYear} - ${pad2(toDay)}/${pad2(toMonth1)}/${toYear}`;
  return { from: fromStr, to: toStr, label };
}

const PeriodContext = createContext<PeriodContextValue>({
  config: DEFAULT_CONFIG,
  isLoaded: false,
  needsSetup: false,
  getPeriod: () => computeRange("AUTO_01_30", 1, 30),
  saveConfig: async () => {},
});

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PeriodConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { syncVersion } = useSync();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(await userScopedKey(PERIOD_KEY));
      if (cancelled) return;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PeriodConfig;
          if (parsed.mode) {
            const mode =
              parsed.mode === "AUTO_01_30" || parsed.mode === "AUTO_20_20" || parsed.mode === "AUTO_MONTH" || parsed.mode === "MANUAL"
                ? parsed.mode
                : "AUTO_01_30";
            setConfig({ ...parsed, mode });
            setNeedsSetup(false);
          } else {
            setNeedsSetup(true);
          }
        } catch {
          setNeedsSetup(true);
        }
      } else {
        const oldRaw = await AsyncStorage.getItem(await userScopedKey("tacoplan_user_settings"));
        if (cancelled) return;
        if (oldRaw) {
          try {
            const old = JSON.parse(oldRaw);
            const sd = parseInt(old.period_start_day, 10);
            const ed = parseInt(old.period_end_day, 10);
            if (!isNaN(sd) && !isNaN(ed)) {
              const migrated: PeriodConfig = { mode: "MANUAL", manualFrom: sd, manualTo: ed };
              setConfig(migrated);
              await AsyncStorage.setItem(await userScopedKey(PERIOD_KEY), JSON.stringify(migrated));
              setNeedsSetup(false);
            } else {
              setNeedsSetup(true);
            }
          } catch {
            setNeedsSetup(true);
          }
        } else {
          setNeedsSetup(true);
        }
      }
      setIsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncVersion]);

  const saveConfig = useCallback(async (cfg: PeriodConfig) => {
    const next: PeriodConfig = { ...cfg, _updated_at: new Date().toISOString() };
    setConfig(next);
    setNeedsSetup(false);
    await AsyncStorage.setItem(await userScopedKey(PERIOD_KEY), JSON.stringify(next));
  }, []);

  const getPeriod = useCallback((offset: number = 0) => {
    const d = new Date();
    d.setMonth(d.getMonth() - offset);
    return computeRange(config.mode, config.manualFrom, config.manualTo, d);
  }, [config]);

  const value = useMemo(() => ({
    config,
    isLoaded,
    needsSetup,
    getPeriod,
    saveConfig,
  }), [config, isLoaded, needsSetup, getPeriod, saveConfig]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  return useContext(PeriodContext);
}

export { computeRange };
