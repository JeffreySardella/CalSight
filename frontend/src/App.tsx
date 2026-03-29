import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import MapPage from "./pages/MapPage";
import StatsPage from "./pages/StatsPage";
import AboutPage from "./pages/AboutPage";
import AskAiPage from "./pages/AskAiPage";

export default function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MapPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="ask-ai" element={<AskAiPage />} />
        </Route>
      </Routes>
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03] z-[60]"
        style={{
          backgroundImage:
            "url('https://www.transparenttextures.com/patterns/natural-paper.png')",
          backgroundRepeat: "repeat",
        }}
      />
    </BrowserRouter>
  );
}
