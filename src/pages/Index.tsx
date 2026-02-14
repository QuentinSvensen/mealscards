import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MealList } from "@/components/MealList";
import { useMeals } from "@/hooks/useMeals";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const { allMeals, availableMeals, isLoading, addMeal, toggleAvailability, renameMeal, deleteMeal } = useMeals();
  const [newName, setNewName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleAdd = () => {
    if (!newName.trim()) return;
    addMeal.mutate(newName.trim(), {
      onSuccess: () => {
        setNewName("");
        setDialogOpen(false);
        toast({ title: "Repas ajouté 🎉" });
      },
    });
  };

  const handleMove = (id: string, toAvailable: boolean) => {
    toggleAvailability.mutate({ id, is_available: toAvailable });
  };

  const handleDrop = (mealId: string, toAvailable: boolean) => {
    toggleAvailability.mutate({ id: mealId, is_available: toAvailable });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground animate-pulse text-lg">Chargement des repas…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-foreground">
            🍽️ Mes Repas
          </h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Ajouter
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau repas</DialogTitle>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Ex: Pâtes carbonara"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <Button onClick={handleAdd} disabled={!newName.trim()}>
                  Ajouter
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MealList
            title="Tous mes repas"
            emoji="📋"
            meals={allMeals}
            direction="right"
            onMove={(id) => handleMove(id, true)}
            onRename={(id, name) => renameMeal.mutate({ id, name })}
            onDelete={(id) => deleteMeal.mutate(id)}
            onDrop={(mealId) => handleDrop(mealId, false)}
          />
          <MealList
            title="Repas possibles"
            emoji="🍳"
            meals={availableMeals}
            direction="left"
            onMove={(id) => handleMove(id, false)}
            onRename={(id, name) => renameMeal.mutate({ id, name })}
            onDelete={(id) => deleteMeal.mutate(id)}
            onDrop={(mealId) => handleDrop(mealId, true)}
          />
        </div>
      </main>
    </div>
  );
};

export default Index;
