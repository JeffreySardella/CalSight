import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./context/ThemeContext";
import { queryClient } from "./lib/queryClient";
import Layout from "./components/Layout";
import MapPage from "./pages/MapPage";
import StatsPage from "./pages/StatsPage";
import AboutPage from "./pages/AboutPage";
import AskAiPage from "./pages/AskAiPage";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<MapPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="ask-ai" element={<AskAiPage />} />
              <Route path="about" element={<AboutPage />} />
            </Route>
          </Routes>
          <div
            className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-0 z-[60]"
            style={{
              backgroundImage:
                "url('https://www.transparenttextures.com/patterns/natural-paper.png')",
              backgroundRepeat: "repeat",
            }}
          />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
