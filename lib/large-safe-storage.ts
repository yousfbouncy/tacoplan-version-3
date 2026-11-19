import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLargeSafeStorage } from "./large-safe-storage-engine";

/**
 * iOS writes >1KB normally use file-backed AsyncStorage. The TestFlight 14
 * crash occurred inside that native file write. Use an atomic, backwards-
 * compatible chunked store for Tacoplan's historic JSON collections.
 */
const safe = createLargeSafeStorage(AsyncStorage, Platform.OS === "ios");

export const getLargeSafeItem = safe.read;
export const setLargeSafeItem = safe.write;
export const removeLargeSafeItem = safe.remove;
