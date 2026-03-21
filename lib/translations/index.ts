import es from "./es";
import en from "./en";
import ar from "./ar";
import fr from "./fr";

export type Locale = "es" | "en" | "ar" | "fr";

const translations: Record<Locale, Record<string, string>> = { es, en, ar, fr };

export default translations;
