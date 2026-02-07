import { useState, useEffect } from 'react';
import ServerList from './pages/ServerList';
import Chat from './pages/Chat';
import { migrateFromLegacy, getActiveServer, getServers, type ServerConfig } from './lib/servers';

type Route = 'servers' | 'chat';

export default function App() {
  const [route, setRoute] = useState<Route>('servers');
  const [pairInfo, setPairInfo] = useState<{ serverUrl: string; token: string } | null>(null);
  const [activeServer, setActiveServer] = useState<ServerConfig | null>(null);

  useEffect(() => {
    // One-time migration from legacy flat keys
    migrateFromLegacy();

    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    if (path.startsWith('/pair')) {
      // Parse pairing URL
      const segments = path.split('/').filter(Boolean);
      const serverParam = params.get('server');
      const tokenParam = params.get('token');

      if (serverParam && tokenParam) {
        setPairInfo({ serverUrl: serverParam, token: tokenParam });
      } else if (segments.length >= 2 && segments[0] === 'pair') {
        const token = segments[1];
        const serverUrl = `${window.location.protocol}//${window.location.host}`;
        setPairInfo({ serverUrl, token });
      }
      setRoute('servers');
    } else if (path === '/chat') {
      const server = getActiveServer();
      if (server) {
        setActiveServer(server);
        setRoute('chat');
      } else if (getServers().length > 0) {
        setRoute('servers');
      } else {
        setRoute('servers');
      }
    } else {
      // Auto-navigate to chat if there's only one server
      const servers = getServers();
      const active = getActiveServer();
      if (active) {
        setActiveServer(active);
        setRoute('chat');
      } else if (servers.length === 1) {
        setActiveServer(servers[0]);
        setRoute('chat');
      } else {
        setRoute('servers');
      }
    }
  }, []);

  const navigate = (newRoute: 'servers' | 'chat') => {
    if (newRoute === 'servers') {
      window.history.pushState({}, '', '/');
      setActiveServer(null);
    } else if (newRoute === 'chat') {
      const server = getActiveServer();
      if (server) {
        setActiveServer(server);
        window.history.pushState({}, '', '/chat');
      } else {
        // No active server — go to server list
        window.history.pushState({}, '', '/');
        setRoute('servers');
        return;
      }
    }
    setRoute(newRoute);
  };

  if (route === 'chat' && activeServer) {
    return <Chat key={activeServer.id} serverConfig={activeServer} onNavigate={navigate} />;
  }

  return <ServerList onNavigate={navigate} pairInfo={pairInfo} />;
}
