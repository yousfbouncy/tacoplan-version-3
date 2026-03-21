import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import translations, { type Locale } from "@/lib/translations";

const STORAGE_KEY = "tacoplan_locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "es",
  setLocale: () => {},
  t: (k) => k,
  isRTL: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("es");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v && (v === "es" || v === "en" || v === "ar" || v === "fr")) {
        setLocaleState(v as Locale);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }, []);

  const t = useCallback((key: string): string => {
    return translations[locale][key] ?? translations["es"][key] ?? key;
  }, [locale]);

  if (!loaded) return null;

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, isRTL: locale === "ar" }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
