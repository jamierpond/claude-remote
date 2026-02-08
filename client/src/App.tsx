import { useState } from "react";
import ServerList from "./pages/ServerList";
import Chat from "./pages/Chat";
import {
  migrateFromLegacy,
  getActiveServer,
  getServers,
  type ServerConfig,
} from "./lib/servers";

// Run migration once at module load
migrateFromLegacy();

type Route = "servers" | "chat";

function getInitialState(): {
  route: Route;
  pairInfo: { serverUrl: string; token: string } | null;
  activeServer: ServerConfig | null;
} {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith("/pair")) {
    const segments = path.split("/").filter(Boolean);
    const serverParam = params.get("server");
    const tokenParam = params.get("token");

    let pairInfo: { serverUrl: string; token: string } | null = null;
    if (serverParam && tokenParam) {
      pairInfo = { serverUrl: serverParam, token: tokenParam };
    } else if (segments.length >= 2 && segments[0] === "pair") {
      const token = segments[1];
      const serverUrl = `${window.location.protocol}//${window.location.host}`;
      pairInfo = { serverUrl, token };
    }
    return { route: "servers", pairInfo, activeServer: null };
  }

  if (path === "/chat") {
    const server = getActiveServer();
    if (server) {
      return { route: "chat", pairInfo: null, activeServer: server };
    }
    return { route: "servers", pairInfo: null, activeServer: null };
  }

  // Auto-navigate to chat if there's only one server
  const servers = getServers();
  const active = getActiveServer();
  if (active) {
    return { route: "chat", pairInfo: null, activeServer: active };
  }
  if (servers.length === 1) {
    return { route: "chat", pairInfo: null, activeServer: servers[0] };
  }
  return { route: "servers", pairInfo: null, activeServer: null };
}

export default function App() {
  const [initial] = useState(getInitialState);
  const [route, setRoute] = useState<Route>(initial.route);
  const [pairInfo] = useState(initial.pairInfo);
  const [activeServer, setActiveServer] = useState<ServerConfig | null>(
    initial.activeServer,
  );

  const navigate = (newRoute: "servers" | "chat") => {
    if (newRoute === "servers") {
      window.history.pushState({}, "", "/");
      setActiveServer(null);
    } else if (newRoute === "chat") {
      const server = getActiveServer();
      if (server) {
        setActiveServer(server);
        window.history.pushState({}, "", "/chat");
      } else {
        // No active server — go to server list
        window.history.pushState({}, "", "/");
        setRoute("servers");
        return;
      }
    }
    setRoute(newRoute);
  };

  if (route === "chat" && activeServer) {
    return (
      <Chat
        key={activeServer.id}
        serverConfig={activeServer}
        onNavigate={navigate}
      />
    );
  }

  return <ServerList onNavigate={navigate} pairInfo={pairInfo} />;
}
