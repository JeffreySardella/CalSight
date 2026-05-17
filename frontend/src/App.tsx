import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "./context/ThemeContext";
import { CustomThemeProvider } from "./context/CustomThemeContext";
import { LiteModeProvider } from "./context/LiteModeContext";
import { AccessibilityProvider } from "./context/AccessibilityContext";
import { queryClient } from "./lib/queryClient";
import {
  persister,
  shouldDehydrateQuery,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
} from "./lib/queryPersistence";
import Layout from "./components/Layout";
import AdminGuard from "./components/AdminGuard";

const MapPage = lazy(() => import("./pages/MapPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const AskAiPage = lazy(() => import("./pages/AskAiPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const AdminEtlPage = lazy(() => import("./pages/AdminEtlPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      <ThemeProvider>
        <CustomThemeProvider>
        <LiteModeProvider>
          <AccessibilityProvider>
          <BrowserRouter>
          <Suspense fallback={<div className="flex items-center justify-center h-dvh"><span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<MapPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="ask" element={<AskAiPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="admin/etl" element={<AdminGuard><AdminEtlPage /></AdminGuard>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
          </BrowserRouter>
          </AccessibilityProvider>
        </LiteModeProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
