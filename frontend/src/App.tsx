import { Suspense } from "react";
import { lazyWithRetry } from "./lib/lazyWithRetry";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "./context/ThemeContext";
import { CustomThemeProvider } from "./context/CustomThemeContext";
import { LiteModeProvider } from "./context/LiteModeContext";
import { AccessibilityProvider } from "./context/AccessibilityContext";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { queryClient } from "./lib/queryClient";
import {
  persister,
  shouldDehydrateQuery,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
} from "./lib/queryPersistence";
import Layout from "./components/Layout";
import AdminGuard from "./components/AdminGuard";
import MaintenanceGate from "./components/MaintenanceGate";
import RebuildingBanner from "./components/RebuildingBanner";
import { AiCompanionProvider } from "./components/ai/AiCompanion";
import { AskAiProvider } from "./hooks/useAskAi";

const MapPage = lazyWithRetry(() => import("./pages/MapPage"));
const StatsPage = lazyWithRetry(() => import("./pages/StatsPage"));
const AboutPage = lazyWithRetry(() => import("./pages/AboutPage"));
const AskAiPage = lazyWithRetry(() => import("./pages/AskAiPage"));
const PrivacyPage = lazyWithRetry(() => import("./pages/PrivacyPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const AdminEtlPage = lazyWithRetry(() => import("./pages/AdminEtlPage"));
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"));

export default function App() {
  return (
    <ErrorBoundary fallback={
      <div role="alert" className="flex flex-col items-center justify-center h-dvh text-center p-8">
        <span className="material-symbols-outlined text-[48px] text-error mb-4" aria-hidden="true">error</span>
        <p className="text-on-surface font-semibold text-lg mb-2">Something went wrong</p>
        <p className="text-on-surface-variant text-sm mb-4">The app encountered an unexpected error.</p>
        <button type="button" onClick={() => { queryClient.clear(); window.location.reload(); }} className="px-6 py-2 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 transition-opacity">
          Reload
        </button>
      </div>
    }>
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
          <MaintenanceGate />
          <RebuildingBanner />
          <BrowserRouter>
          <AskAiProvider>
          <AiCompanionProvider>
          <Suspense fallback={<div className="flex items-center justify-center h-dvh" role="status" aria-label="Loading page"><span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" /><span className="sr-only">Loading page</span></div>}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<MapPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="ask" element={<AskAiPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="admin/etl" element={<AdminGuard><AdminEtlPage /></AdminGuard>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
          </AiCompanionProvider>
          </AskAiProvider>
          </BrowserRouter>
          </AccessibilityProvider>
        </LiteModeProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
