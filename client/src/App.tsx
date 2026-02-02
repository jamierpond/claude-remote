import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Chat from './pages/Chat';

type Route = 'home' | 'chat' | 'pair';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [pairToken, setPairToken] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    if (path.startsWith('/pair/')) {
      const token = path.split('/pair/')[1];
      setPairToken(token);
      setRoute('pair');
    } else if (path === '/chat' || params.get('token')) {
      setPairToken(params.get('token'));
      setRoute('chat');
    } else {
      setRoute('home');
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

  if (route === 'home') {
    return <Home onNavigate={navigate} />;
  }

  return <Chat token={pairToken} onNavigate={navigate} />;
}
