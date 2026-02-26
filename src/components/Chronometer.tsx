import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChronoState {
  running: boolean;
  startedAt: string | null;
  accumulated: number; // ms
}

const DEFAULT_STATE: ChronoState = { running: false, startedAt: null, accumulated: 0 };

export function Chronometer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [display, setDisplay] = useState("00:00:00");

  // Poll DB every 3 seconds for cross-device sync
  const { data: storedState = DEFAULT_STATE } = useQuery({
    queryKey: ["chronometer_state"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_preferences")
        .select("value")
        .eq("key", "chronometer_state")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as ChronoState) ?? DEFAULT_STATE;
    },
    refetchInterval: 3000,
    retry: 2,
  });

  const saveMutation = useMutation({
    mutationFn: async (state: ChronoState) => {
      const { data: existing } = await (supabase as any)
        .from("user_preferences")
        .select("id")
        .eq("key", "chronometer_state")
        .maybeSingle();
      if (existing) {
        await (supabase as any)
          .from("user_preferences")
          .update({ value: state, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await (supabase as any)
          .from("user_preferences")
          .insert({ key: "chronometer_state", value: state });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chronometer_state"] }),
  });

  const getElapsed = (s: ChronoState) => {
    if (s.running && s.startedAt) {
      return s.accumulated + (Date.now() - new Date(s.startedAt).getTime());
    }
    return s.accumulated;
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Update display every 100ms
  useEffect(() => {
    const id = setInterval(() => setDisplay(formatTime(getElapsed(storedState))), 100);
    return () => clearInterval(id);
  }, [storedState]);

  const handleStart = () => {
    saveMutation.mutate({
      running: true,
      startedAt: new Date().toISOString(),
      accumulated: storedState.accumulated,
    });
  };

  const handlePause = () => {
    saveMutation.mutate({
      running: false,
      startedAt: null,
      accumulated: getElapsed(storedState),
    });
  };

  const handleReset = () => {
    saveMutation.mutate(DEFAULT_STATE);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs rounded-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-center">⏱ Chronomètre</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="text-5xl font-mono font-black text-foreground tabular-nums tracking-wider">
            {display}
          </div>
          <div className="flex items-center gap-3">
            {storedState.running ? (
              <Button onClick={handlePause} size="lg" variant="secondary" className="rounded-full h-14 w-14">
                <Pause className="h-6 w-6" />
              </Button>
            ) : (
              <Button onClick={handleStart} size="lg" className="rounded-full h-14 w-14">
                <Play className="h-6 w-6 ml-0.5" />
              </Button>
            )}
            <Button onClick={handleReset} size="lg" variant="outline" className="rounded-full h-14 w-14">
              <RotateCcw className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">Synchronisé entre tous les appareils</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
