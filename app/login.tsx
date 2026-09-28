import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable as NativePressable,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as AppleAuthentication from "expo-apple-authentication";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n-context";
import { WEB_HIDE_BILLING_UI } from "@/lib/utils";
import type { Locale } from "@/lib/translations";

type Screen = "login" | "register" | "verify" | "verified" | "email_exists" | "forgot" | "new_password" | "password_updated";

const LANGUAGES: { code: Locale; flag: string; label: string }[] = [
  { code: "es", flag: "\u{1F1EA}\u{1F1F8}", label: "ES" },
  { code: "en", flag: "\u{1F1EC}\u{1F1E7}", label: "EN" },
  { code: "ar", flag: "\u{1F1F8}\u{1F1E6}", label: "AR" },
  { code: "fr", flag: "\u{1F1EB}\u{1F1F7}", label: "FR" },
];

const REGISTER_URL = "https://tacoplan.es/registro";
const PRIVACY_URL = "https://www.tacoplan.es/politica-privacidad";
const TERMS_URL = "https://www.tacoplan.es/terminos-condiciones";

type NativePressableProps = React.ComponentProps<typeof NativePressable>;
function Pressable(props: NativePressableProps) {
  return React.createElement(NativePressable, props);
}

function devLog(...args: any[]) {
  if (__DEV__) console.log(...args);
}

function getOAuthRedirectUrl(): string {
  if (Platform.OS === "web") {
    return window.location.origin;
  }
  return Linking.createURL("auth/callback", { scheme: "tacoplan" });
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { signIn, signUp, verifyEmail, resendVerification, resetPassword, updatePassword, handleOAuthTokens, recoveryTokens } = useAuth();
  const { t, locale, setLocale } = useI18n();

  const [screen, setScreen] = useState<Screen>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (recoveryTokens) {
      setScreen("new_password");
    }
  }, [recoveryTokens]);

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert(t("common.error"), t("login.passwordMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t("common.error"), t("login.passwordsNoMatch"));
      return;
    }
    if (!recoveryTokens) {
      Alert.alert(t("common.error"), t("login.invalidRecoveryLink"));
      return;
    }
    setLoading(true);
    try {
      const result = await updatePassword(recoveryTokens.access_token, newPassword);
      Alert.alert(t("common.success"), result.message);
      setScreen("password_updated");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
    setLoading(false);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (Platform.OS !== "web") Alert.alert(t("common.error"), msg);
  };

  const oauthHandledRef = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") return;

    const tryHandleUrl = async (urlStr: string) => {
      if (!urlStr) return;
      if (oauthHandledRef.current) return;
      if (!urlStr.includes("auth/callback")) return;

      oauthHandledRef.current = true;
      try {
        try {
          const u = new URL(urlStr);
          devLog("[OAUTH] deep link received", { origin: u.origin, pathname: u.pathname });
        } catch {
          devLog("[OAUTH] deep link received");
        }
        const parsedUrl = new URL(urlStr);
        const code = parsedUrl.searchParams.get("code");
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) showError(exErr.message || t("common.error"));
          return;
        }
        const hashParams = new URLSearchParams(parsedUrl.hash.substring(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          const ok = await handleOAuthTokens(accessToken, refreshToken);
          if (!ok) showError(t("common.error"));
        }
      } catch (e: any) {
        showError(e?.message || t("common.error"));
      } finally {
        setLoading(false);
      }
    };

    Linking.getInitialURL().then((u) => {
      if (u) tryHandleUrl(u);
    }).catch(() => {});

    const sub = Linking.addEventListener("url", (ev) => {
      tryHandleUrl(ev.url);
    });

    return () => sub.remove();
  }, [handleOAuthTokens, t]);

  const startOAuth = async (provider: "google" | "apple") => {
    const couldNotKey = provider === "google" ? "login.couldNotGoogle" : "login.couldNotApple";
    const couldNotConnectKey = provider === "google" ? "login.couldNotConnectGoogle" : "login.couldNotConnectApple";

    setErrorMsg("");
    setLoading(true);
    try {
      if (provider === "apple" && Platform.OS === "ios") {
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        if (!isAvailable) {
          showError(t(couldNotConnectKey));
          return;
        }

        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          showError(t(couldNotKey));
          return;
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: "apple",
          token: credential.identityToken,
        });
        if (error) {
          const msg = error.message || "";
          if (msg.includes("Unacceptable audience in id_token") && msg.includes("host.exp.Exponent")) {
            showError("Estás probando en Expo Go. Para Apple nativo necesitas una build propia (Dev Build/TestFlight) o añadir 'host.exp.Exponent' como Authorized Client ID en Supabase (solo para pruebas).");
          } else {
            showError(msg || t(couldNotKey));
          }
        }
        return;
      }

      const redirectUrl = getOAuthRedirectUrl();

      devLog("[OAUTH] start", {
        provider,
        platform: Platform.OS,
        redirectTo: redirectUrl,
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
          scopes: provider === "apple" ? "email name" : undefined,
        },
      });

      if (error) {
        devLog("[OAUTH] error", { provider, message: error.message });
        showError(error.message);
        setLoading(false);
        return;
      }

      if (Platform.OS === "web" && data?.url) {
        devLog("[OAUTH] web redirecting", { provider, redirectTo: redirectUrl });
        window.location.assign(data.url);
        return;
      }

      if (Platform.OS !== "web" && data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );

        if (result.type === "success" && result.url) {
          devLog("[OAUTH] auth session success url", { provider, url: result.url });
          const parsedUrl = new URL(result.url);
          const code = parsedUrl.searchParams.get("code");
          if (code) {
            const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
            if (exErr) {
              showError(exErr.message || t(couldNotKey));
            }
          }
          const hashParams = new URLSearchParams(parsedUrl.hash.substring(1));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            const ok = await handleOAuthTokens(accessToken, refreshToken);
            if (!ok) {
              showError(t(couldNotKey));
            }
          }
        }
      }
    } catch (e: any) {
      showError(e.message || t(couldNotConnectKey));
    } finally {
      if (Platform.OS !== "web") setLoading(false);
    }
  };

  const openRegisterUrl = async () => {
    try {
      const supported = await Linking.canOpenURL(REGISTER_URL);
      if (!supported) {
        showError("No se pudo abrir la página de registro.");
        return;
      }
      await Linking.openURL(REGISTER_URL);
    } catch (e: any) {
      showError(e?.message || "No se pudo abrir la página de registro.");
    }
  };

  const openLegalUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        showError(t("common.couldNotOpenLink"));
        return;
      }
      await Linking.openURL(url);
    } catch (e: any) {
      showError(e?.message || t("common.couldNotOpenLink"));
    }
  };

  const handleLogin = async () => {
    setErrorMsg("");
    if (!email.trim() || !email.includes("@")) {
      showError(t("login.enterValidEmail"));
      return;
    }
    if (!password.trim()) {
      showError(t("login.enterPassword"));
      return;
    }
    setLoading(true);
    try {
      const result = await signIn(email.trim().toLowerCase(), password);
      if (!result.ok) {
        showError(result.message || t("login.couldNotSignIn"));
      }
    } catch (e: any) {
      showError(e.message);
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    setErrorMsg("");
    if (!name.trim()) {
      showError(t("login.enterName"));
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      showError(t("login.enterValidEmail"));
      return;
    }
    if (password.length < 6) {
      showError(t("login.passwordMinLength"));
      return;
    }
    setLoading(true);
    try {
      const result = await signUp(name.trim(), email.trim().toLowerCase(), password);
      if (result.emailExists) {
        setScreen("login");
        setPassword("");
        showError(`${t("login.emailExists")}: ${email.trim().toLowerCase()} ${t("login.emailExistsDesc")}`);
      } else if (result.needsVerification) {
        setScreen("verify");
      }
    } catch (e: any) {
      showError(e.message);
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!email.trim() || !email.includes("@")) {
      Alert.alert(t("common.error"), t("login.enterEmailToRecover"));
      return;
    }
    setLoading(true);
    try {
      const result = await resetPassword(email.trim().toLowerCase());
      Alert.alert(t("common.sent"), result.message);
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (!verifyCode.trim() || verifyCode.length < 6) {
      Alert.alert(t("common.error"), t("login.enterVerifyCode"));
      return;
    }
    setLoading(true);
    try {
      const ok = await verifyEmail(email.trim().toLowerCase(), verifyCode.trim());
      if (ok) {
        setVerifyCode("");
        setScreen("verified");
      } else {
        Alert.alert(t("common.error"), t("login.incorrectCode"));
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
    setLoading(false);
  };

  const handleResend = async () => {
    setLoading(true);
    try {
      const result = await resendVerification(email.trim().toLowerCase());
      Alert.alert(t("common.sent"), result.message);
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + webTopInset + 40,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.langRow}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              style={[
                styles.langBtn,
                locale === lang.code && styles.langBtnActive,
              ]}
              onPress={() => setLocale(lang.code)}
            >
              <Text style={styles.langFlag}>{lang.flag}</Text>
              <Text
                style={[
                  styles.langLabel,
                  locale === lang.code && styles.langLabelActive,
                ]}
              >
                {lang.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.logoSection}>
          <View style={styles.logoCircle}>
            <MaterialCommunityIcons name="steering" size={48} color="#fff" />
          </View>
          <Text style={styles.appName}>Tacoplan</Text>
          <Text style={styles.appDesc}>{t("login.appDesc")}</Text>
          {Platform.OS === "web" && WEB_HIDE_BILLING_UI ? (
            <Text style={styles.betaNotice}>{t("web.betaFreeNotice")}</Text>
          ) : null}
        </View>

        {screen === "password_updated" ? (
          <View style={styles.card}>
            <View style={{ alignItems: "center", marginBottom: 20 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#22C55E", justifyContent: "center", alignItems: "center", marginBottom: 16 }}>
                <Ionicons name="checkmark" size={36} color="#fff" />
              </View>
              <Text style={styles.cardTitle}>{t("login.passwordUpdated")}</Text>
              <Text style={[styles.cardDesc, { textAlign: "center" as const }]}>
                {t("login.passwordUpdatedDesc")}
              </Text>
            </View>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => { setScreen("login"); setPassword(""); }}
            >
              <Text style={styles.btnText}>{t("login.signIn")}</Text>
            </Pressable>
          </View>
        ) : screen === "new_password" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("login.newPasswordTitle")}</Text>
            <Text style={styles.cardDesc}>
              {t("login.newPasswordDesc")}
            </Text>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder={t("login.newPassword")}
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn} hitSlop={8}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={Colors.light.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t("login.confirmPassword")}
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
                editable={!loading}
              />
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={handleUpdatePassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{t("login.savePassword")}</Text>}
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setScreen("login")}
            >
              <Text style={styles.linkTextSecondary}>{t("login.backToLogin")}</Text>
            </Pressable>
          </View>
        ) : screen === "email_exists" ? (
          <View style={styles.card}>
            <View style={{ alignItems: "center", marginBottom: 20 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#F59E0B", justifyContent: "center", alignItems: "center", marginBottom: 16 }}>
                <Ionicons name="alert" size={36} color="#fff" />
              </View>
              <Text style={styles.cardTitle}>{t("login.emailExists")}</Text>
              <Text style={[styles.cardDesc, { textAlign: "center" as const }]}>
                {email} {t("login.emailExistsDesc")}
              </Text>
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => { setScreen("login"); setPassword(""); }}
            >
              <Ionicons name="log-in-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.btnText}>{t("login.signIn")}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.secondaryBtn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={handleForgotPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.light.tint} size="small" />
              ) : (
                <>
                  <Ionicons name="key-outline" size={20} color={Colors.light.tint} style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryBtnText}>{t("login.recoverPassword")}</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={async () => { setPassword(""); await openRegisterUrl(); }}
            >
              <Text style={styles.linkTextSecondary}>{t("login.backToRegister")}</Text>
            </Pressable>
          </View>
        ) : screen === "forgot" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("login.recoverPassword")}</Text>
            <Text style={styles.cardDesc}>
              {t("login.recoverPasswordDesc")}
            </Text>

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t("login.email")}
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={handleForgotPassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{t("login.sendLink")}</Text>}
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => setScreen("login")}
            >
              <Text style={styles.linkTextSecondary}>{t("login.backToLogin")}</Text>
            </Pressable>
          </View>
        ) : screen === "verified" ? (
          <View style={styles.card}>
            <View style={{ alignItems: "center", marginBottom: 20 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#22C55E", justifyContent: "center", alignItems: "center", marginBottom: 16 }}>
                <Ionicons name="checkmark" size={36} color="#fff" />
              </View>
              <Text style={styles.cardTitle}>{t("login.accountConfirmed")}</Text>
              <Text style={[styles.cardDesc, { textAlign: "center" as const }]}>
                {t("login.accountConfirmedDesc")}
              </Text>
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => setScreen("login")}
            >
              <Text style={styles.btnText}>{t("login.signIn")}</Text>
            </Pressable>
          </View>
        ) : screen === "verify" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("login.verifyEmail")}</Text>
            <Text style={styles.cardDesc}>
              {t("login.verifyEmailDesc")} {email}
            </Text>

            <View style={styles.inputContainer}>
              <Ionicons name="key-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={verifyCode}
                onChangeText={setVerifyCode}
                placeholder="12345678"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={8}
                autoFocus
                editable={!loading}
              />
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={handleVerify}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{t("login.verify")}</Text>}
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={handleResend}
              disabled={loading}
            >
              <Text style={styles.linkText}>{t("login.resendCode")}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={async () => { setVerifyCode(""); await openRegisterUrl(); }}
            >
              <Text style={styles.linkTextSecondary}>{t("common.back")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tab, screen === "login" && styles.tabActive]}
                onPress={() => setScreen("login")}
              >
                <Text style={[styles.tabText, screen === "login" && styles.tabTextActive]}>{t("login.signIn")}</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, screen === "register" && styles.tabActive]}
                onPress={openRegisterUrl}
              >
                <Text style={[styles.tabText, screen === "register" && styles.tabTextActive]}>{t("login.register")}</Text>
              </Pressable>
            </View>

            {screen === "register" && (
              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={t("login.fullName")}
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>
            )}

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t("login.email")}
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder={t("login.password")}
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn} hitSlop={8}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={Colors.light.textSecondary} />
              </Pressable>
            </View>

            {!!errorMsg && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={Colors.light.danger} />
                <Text style={styles.errorBannerText}>{errorMsg}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={screen === "login" ? handleLogin : handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnText}>
                  {screen === "login" ? t("login.signIn") : t("login.createAccount")}
                </Text>
              )}
            </Pressable>

            {screen === "login" && (
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1, marginTop: 12, marginBottom: 0 }]}
                onPress={() => setScreen("forgot")}
              >
                <Text style={styles.linkText}>{t("login.forgotPassword")}</Text>
              </Pressable>
            )}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t("common.or")}</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.googleBtn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={() => startOAuth("google")}
              disabled={loading}
            >
              <Ionicons name="logo-google" size={20} color="#4285F4" />
              <Text style={styles.googleBtnText}>{t("login.continueGoogle")}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }: { pressed: boolean }) => [styles.appleBtn, { opacity: pressed ? 0.85 : 1 }, loading && styles.btnDisabled]}
              onPress={() => startOAuth("apple")}
              disabled={loading}
            >
              <Ionicons name="logo-apple" size={20} color="#fff" />
              <Text style={styles.appleBtnText}>{t("login.continueApple")}</Text>
            </Pressable>

            <View style={styles.legalRow}>
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => openLegalUrl(PRIVACY_URL)}
              >
                <Text style={styles.legalText}>{t("login.privacyPolicy")}</Text>
              </Pressable>
              <Text style={styles.legalDivider}>·</Text>
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => openLegalUrl(TERMS_URL)}
              >
                <Text style={styles.legalText}>{t("login.termsAndConditions")}</Text>
              </Pressable>
            </View>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: Colors.light.background,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  langRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 20,
    width: "100%",
    maxWidth: 400,
  },
  langBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: Colors.light.surface,
  },
  langBtnActive: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.surface,
  },
  langFlag: {
    fontSize: 18,
  },
  langLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  langLabelActive: {
    color: Colors.light.tint,
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.light.tint,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    shadowColor: Colors.light.tint,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    letterSpacing: -0.5,
  },
  appDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  betaNotice: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    color: "#3730A3",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    overflow: "hidden",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.light.surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: Colors.light.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  tabTextActive: {
    color: Colors.light.tint,
    fontFamily: "Inter_600SemiBold",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 14,
  },
  inputIcon: {
    paddingLeft: 14,
  },
  input: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    color: Colors.light.text,
    padding: 14,
  },
  eyeBtn: {
    paddingRight: 14,
    paddingVertical: 14,
  },
  btn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.border,
  },
  dividerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginHorizontal: 12,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingVertical: 13,
    gap: 10,
  },
  googleBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: Colors.light.text,
  },
  appleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#000",
    paddingVertical: 13,
    gap: 10,
    marginTop: 10,
  },
  appleBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: "#fff",
  },
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 14,
  },
  legalBtn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  legalText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.light.textSecondary,
    textDecorationLine: "underline",
  },
  legalDivider: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginHorizontal: 6,
  },
  linkBtn: {
    alignItems: "center",
    marginTop: 16,
  },
  linkText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.light.tint,
  },
  linkTextSecondary: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    paddingVertical: 13,
    marginTop: 12,
  },
  secondaryBtnText: {
    color: Colors.light.tint,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.danger,
  },
});
