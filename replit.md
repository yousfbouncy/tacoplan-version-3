# Tacoplan - Legal Compliance Assistant for Truck Drivers

## Overview
Tacoplan is a mobile application designed for truck drivers in Spain to ensure compliance with EU Regulation 561/2006. It offers automatic tracking of driving hours, rest periods, and provides legal compliance alerts. The application also includes features for calculating diet expenses with user-customizable rates, day surcharges, and managing trips. Its core purpose is to simplify legal adherence and financial tracking for drivers.

## User Preferences
- Local device storage preferred over server-side database for jornada data
- Supabase for auth and user configuration
- Multi-language UI (ES/EN/AR/FR) via `lib/i18n-context.tsx` + `lib/translations/`
- Offline-first with cloud backup sync
- Auto-sync: every data mutation (create/edit/close/delete jornada, compensations) triggers debounced cloud sync
- Offline queue: changes made without internet are queued and synced when connectivity returns

## System Architecture
The application uses a hybrid architecture with a mobile frontend and a lightweight Node.js backend.

### Frontend
- Built with Expo (React Native) and TypeScript, utilizing file-based routing through `expo-router`.
- State management is handled by React Query, with custom `queryFn` interacting directly with local storage functions.
- All core business logic, including legal compliance calculations, diet calculations, and compensation tracking, is executed client-side within `lib/local-storage.ts` and `lib/legalEngine.ts`.
- UI/UX features include a color theme defined in `constants/colors.ts`, period configuration modals, and specialized forms for jornada registration, trip tracking, and user settings.
- The UI adapts for different periods (AUTO_01_30, AUTO_20_20, MANUAL) managed by `PeriodContext`.
- Diet values are snapshotted and frozen upon jornada closure, with an option to recalculate.
- The historial view visually separates rest periods, classifies them, and highlights compensation debts.
- Associated trips are displayed within jornada cards in the historial.
- Ferry/Morocco feature: Manages specific rest validations for ferry travel, including interruption tracking and specialized diet/trip payment modes.

### Backend
- An Express.js server in TypeScript runs on port 5000, serving a landing page and APIs for user configuration and data synchronization.

### Authentication & Onboarding
- Implemented using Supabase for email/password, Google OAuth, and guest mode, managed via `lib/auth-context.tsx`.
- New authenticated users must complete mandatory onboarding (`components/OnboardingSetup.tsx`) before accessing the app.
- Onboarding collects: driver profile, operation zone, trip types, diet rates, day extras, accounting period, and optionally payment mode for Morocco/Ferry profiles.
- Onboarding gate in `app/_layout.tsx` checks `tacoplan_onboarding_completed` in AsyncStorage. Guest users skip onboarding entirely.
- Onboarding saves to the same AsyncStorage keys used by the settings screen (`tacoplan_user_settings`, `tacoplan_period_config`, `tacoplan_ferry_config`), merging with any existing data.
- After onboarding, settings remain editable from the usuario/config tab.

### Data Storage & Sync
- Primary data (jornadas, compensaciones, viajes) is stored locally on the device using AsyncStorage, ensuring offline capability.
- User configurations (diet rates, day extras, holidays) and cloud backups are managed in Supabase tables.
- **Centralized sync via `syncAll()`** in `lib/sync-service.ts`: Push pending → Push profile/dietas → Pull all (profiles, jornadas, compensaciones, dietas_config via `POST /api/sync/all`) → Merge → Mark synced.
- **Smart merge**: Cloud-only records are saved locally; when both exist, `updatedAt` wins; ferry fields use null-coalescing to preserve local data during merge.
- **Auto-sync triggers**: AppState `active` (foreground), device online event, initial auth, data mutations (debounced 2s).
- **Offline queue**: Changes made without internet are queued in AsyncStorage and replayed when connectivity returns.
- **Visual feedback**: `SyncStatusBadge` (cloud icon) + `SyncToast` (animated banner showing "Sincronización completada · X subidos, Y descargados").
- **Supabase schema**: `supabase-schema-v2.sql` defines all tables with RLS policies. Key tables: `profiles` (language, period config), `jornadas` (ALL ferry/morocco columns), `dietas_config` (centralized rates), `compensaciones`, `user_diet_rates`, `user_day_extras`, `user_holidays`, `user_ferry_config`, `ferry_rests`, `morocco_trips`, `viajes`.
- **Server sync endpoints**: `POST /api/sync/push`, `GET /api/sync/pull`, `POST /api/sync/all` (bulk pull), `GET/PUT /api/sync/profile`, `GET/PUT /api/sync/dietas-config`.

### Core Features
- **Legal Engine**: `lib/legalEngine.ts` contains pure functions for EU 561/2006 compliance, evaluating jornadas, building legal previews, and computing legal plans.
- **Driving Input Validation**: Supports various input formats and provides inline feedback, displaying infraction/warning badges for legal limit excesses.
- **Rest Gap Analysis**: Displays rest periods between jornadas in the historial with classification and color coding. Ferry rest gaps show enhanced blue cards with boat icon, destination, interruption details, Morocco badge, and tap-to-edit modal for ferry extras (transit diet, cabin overnight, rest type, destination).
- **Ferry Rest (Integrated)**: Ferry extras attach to the last closed jornada via `ferryPending` flag. When closing a jornada, drivers can toggle "embarking on ferry" which sets `ferryPending: true` and `ferryRestType` ("9h"/"11h"). The dashboard shows an integrated ferry panel with: rest countdown (accounting for interruptions), embark/disembark buttons (max 2 interruptions, 1h total per EU 561/2006), extras controls (transit diet count, cabin overnight count, country change toggle, destination input), live calculator showing total extras amount using user-configurable rates (`ferryTransitRate`, `ferryCabinRate` in FerryConfig, default 54.30), and a "finish ferry rest" button when effective rest meets the target. Ferry data fields on Jornada: `ferryPending`, `ferryDestination`, `ferryExtras` (transitDiet/cabinOvernight/countryChange), `ferryInterruptions`, `ferryRestCompleted`, `ferryRestType`. FerryRestRecord also supports `destination` and `ferryExtras`.
- **Ferry Events in Historial**: Ferry rest records appear as full cards in the historial list (light blue background, boat icon), sorted chronologically with jornadas. Cards show start/end times, interruptions, transit diet and cabin overnight badges, and the extras amount. Ferry events are editable (time, rest type, destination, extras) and deletable. Ferry extras amounts are summed into the historial monthly totals.
- **Viajes Stop Management**: Stops (paradas) can be edited (type, place, appointment) and deleted from any trip (in-progress or completed). New stops can be added to completed trips. Functions: `removeParada`, `updateParada` in `lib/local-storage.ts`.
- **Dietas Ferry Extras**: The dietas tab shows an "Extras Ferry / Transbordo" category summarizing transit diets, cabin overnights, and country changes from both jornadas and ferry rest records with ferry extras in the current period. Function: `getFerryExtrasSummary` in `lib/local-storage.ts`.
- **Morocco Mode / Dietas Integration**: When Morocco mode is active, the jornada close form adapts based on `payment_mode`: `morocco_trip` hides diet form and shows trip payment info; `morocco_pernight` shows nacional/internacional/ninguna route selector, pernocta toggle, manual day extras (not auto-detected), and total preview; `morocco_diet` uses standard diet logic.
- **PDF Export**: Allows exporting historial, dietas, and viajes data with date range filtering. Ferry rest events are included in the historial section with blue styling. Ferry extras are included in the dietas section with a dedicated breakdown table.
- **Sunday-Monday Driving Split**: Handles week boundary driving splits with timezone awareness.
- **Debug Simulator**: Developer-only panel (yost.bouncy@gmail.com) accessed via floating bug icon. Creates simulated jornadas with various scenarios: nacional/internacional/regional diets, ferry mode, extras, weekly batches. Results appear in historial and dietas tabs. Component: `components/DebugSimulator.tsx`.

## External Dependencies
- **Supabase**: Used for authentication, user configuration storage (`user_diet_rates`, `user_day_extras`, `user_holidays`), and cloud backup of `jornadas` and `compensaciones`. Also used for ferry/morocco related configurations (`user_ferry_config`, `ferry_rests`, `morocco_trips`).
- **Expo (React Native)**: Frontend framework.
- **Express.js**: Backend server.
- **AsyncStorage**: Local device storage for offline data persistence.
- **React Query**: For data fetching, caching, and state management.
- **Zod**: For schema validation (`shared/schema.ts`).