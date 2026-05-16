import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./context/ThemeContext";
import { LiteModeProvider } from "./context/LiteModeContext";
import { AccessibilityProvider } from "./context/AccessibilityContext";
import { queryClient } from "./lib/queryClient";
import Layout from "./components/Layout";

const MapPage = lazy(() => import("./pages/MapPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const AskAiPage = lazy(() => import("./pages/AskAiPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const AdminEtlPage = lazy(() => import("./pages/AdminEtlPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
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
                <Route path="admin/etl" element={<AdminEtlPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
          </BrowserRouter>
          </AccessibilityProvider>
        </LiteModeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
