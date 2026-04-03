import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import Layout from "./components/Layout";
import MapPage from "./pages/MapPage";
import StatsPage from "./pages/StatsPage";
import AboutPage from "./pages/AboutPage";
import AskAiPage from "./pages/AskAiPage";

export default function App() {

  return (
    <ThemeProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* 1. Primary Landing: The Interactive Map */}
          <Route index element={<MapPage />} /> 
          
          {/* 2. Quantitative Data: Charts and Graphs */}
          <Route path="stats" element={<StatsPage />} /> 
          
          {/* 3. Qualitative Insights: AI Queries */}
          <Route path="ask-ai" element={<AskAiPage />} /> 
          
          {/* 4. Project Context: Team and Privacy */}
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
  );
}
