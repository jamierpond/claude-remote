import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Chat from './pages/Chat';

type Route = 'home' | 'chat' | 'pair';

export interface PairInfo {
  serverUrl: string;
  token: string;
}

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [pairInfo, setPairInfo] = useState<PairInfo | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    if (path === '/pair' || path.startsWith('/pair')) {
      // New format: /pair?server=...&token=...
      const server = params.get('server');
      const token = params.get('token');
      if (server && token) {
        setPairInfo({ serverUrl: server, token });
      }
      setRoute('pair');
    } else if (path === '/chat') {
      setRoute('chat');
    } else {
      // Auto-redirect to chat if paired + have cached PIN
      const isPaired = localStorage.getItem('claude-remote-paired');
      const hasCachedPin = (() => {
        try {
          const stored = localStorage.getItem('claude-remote-pin');
          if (!stored) return false;
          const { exp } = JSON.parse(stored);
          return Date.now() <= exp;
        } catch { return false; }
      })();

      if (isPaired && hasCachedPin) {
        window.history.replaceState({}, '', '/chat');
        setRoute('chat');
      } else {
        setRoute('home');
      }
    }
  }, []);

  const navigate = (newRoute: Route) => {
    if (newRoute === 'home') {
      window.history.pushState({}, '', '/');
    } else if (newRoute === 'chat') {
      window.history.pushState({}, '', '/chat');
    }
    setRoute(newRoute);
  };

  // Home handles both unpaired state and pair route (with pairInfo)
  if (route === 'home' || route === 'pair') {
    return <Home onNavigate={navigate} pairInfo={pairInfo} />;
  }

  return <Chat onNavigate={navigate} />;
}
