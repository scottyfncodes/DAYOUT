import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider } from './state';
import { Home } from './Home';
import { Results } from './Results';
import { Day } from './Day';
import { SharedPlan } from './SharedPlan';
import { PlaceSheet } from './components';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <ScrollToTop />
        <main className="app">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/results" element={<Results />} />
            <Route path="/day" element={<Day />} />
            <Route path="/plan" element={<SharedPlan />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <PlaceSheet />
      </AppProvider>
    </BrowserRouter>
  );
}
