import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { App } from "./App";
import { trpc } from "./lib/trpc";
import { createDemoLink } from "./lib/demoLink";
import "./index.css";

const showroomMode = import.meta.env.VITE_SHOWROOM_MODE === "1";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: showroomMode
        ? [createDemoLink()]
        : [
            httpBatchLink({
              url: "/trpc",
              transformer: superjson,
            }),
          ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
