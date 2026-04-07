import { useState } from "react";
import ServerList from "./pages/ServerList";
import Chat from "./pages/Chat";
import {
  getActiveServer,
  getServers,
  type ServerConfig,
} from "./lib/servers";

type Route = "servers" | "chat";

function getInitialState(): {
  route: Route;
  activeServer: ServerConfig | null;
} {
  // Auto-navigate to chat if there's an active or single server
  const active = getActiveServer();
  if (active) {
    return { route: "chat", activeServer: active };
  }
  const servers = getServers();
  if (servers.length === 1) {
    return { route: "chat", activeServer: servers[0] };
  }
  return { route: "servers", activeServer: null };
}

export default function App() {
  const [initial] = useState(getInitialState);
  const [route, setRoute] = useState<Route>(initial.route);
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

  return <ServerList onNavigate={navigate} />;
}
