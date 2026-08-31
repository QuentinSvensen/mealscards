import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isMobileViewport } from "./hooks/use-mobile";

/** Redirige `/` vers Planning sur mobile, Repas sur desktop. */
function HomeRedirect() {
  return <Navigate to={isMobileViewport() ? "/planning" : "/repas"} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24h — keep cache for offline
      staleTime: 0, // Stale-while-revalidate : affiche le cache instantanément et synchronise aussitôt
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: (failureCount, error) => {
        // Don't retry on auth errors (expired session)
        if (error && typeof error === 'object' && 'code' in error) {
          const code = (error as { code?: string }).code;
          if (code === 'PGRST301' || code === '401' || code === 'refresh_token_not_found') return false;
        }
        if (error && typeof error === 'object' && 'message' in error) {
          const msg = (error as { message?: string }).message || '';
          if (msg.includes('JWT') || msg.includes('token') || msg.includes('401')) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "mealcards-cache",
});

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        // Ne pas persister user_preferences : au refresh on doit relire Supabase
        // (sinon l’UI réaffiche une version locale périmée de « il y a 5 min »).
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            if (query.queryKey[0] === "user_preferences") return false;
            return defaultShouldDehydrateQuery(query);
          },
        },
      }}
    >
      <TooltipProvider>
        <Toaster />
        <Sonner />
  <BrowserRouter>
          <ErrorBoundary section="Application">
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/aliments" element={<Index />} />
              <Route path="/repas" element={<Index />} />
              <Route path="/macros" element={<Index />} />
              <Route path="/planning" element={<Index />} />
              <Route path="/courses" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </PersistQueryClientProvider>
  </ThemeProvider>
);

export default App;
