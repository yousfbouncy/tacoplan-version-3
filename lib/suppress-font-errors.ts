import { Platform } from "react-native";

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    if (
      event?.reason?.message &&
      /timeout exceeded/i.test(event.reason.message)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  const origError = console.error;
  console.error = (...args: any[]) => {
    const firstArg = typeof args[0] === "string" ? args[0] : "";
    if (/timeout exceeded/i.test(firstArg)) return;
    if (args[0]?.message && /timeout exceeded/i.test(args[0].message)) return;
    origError.apply(console, args);
  };
}

export {};
