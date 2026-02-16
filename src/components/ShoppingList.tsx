import { useState } from "react";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useShoppingList, type ShoppingGroup, type ShoppingItem } from "@/hooks/useShoppingList";

export function ShoppingList() {
  const {
    groups, ungroupedItems,
    addGroup, renameGroup, deleteGroup,
    addItem, toggleItem, updateItemQuantity, renameItem, deleteItem,
    getItemsByGroup,
  } = useShoppingList();

  const [newGroupName, setNewGroupName] = useState("");
  const [newItemTexts, setNewItemTexts] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return;
    addGroup.mutate(newGroupName.trim());
    setNewGroupName("");
  };

  const handleAddItem = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    const text = newItemTexts[key]?.trim();
    if (!text) return;
    addItem.mutate({ name: text, group_id: groupId });
    setNewItemTexts(prev => ({ ...prev, [key]: "" }));
  };

  const renderItem = (item: ShoppingItem) => (
    <div key={item.id} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors ${item.checked ? 'opacity-40' : ''}`}>
      <Checkbox
        checked={item.checked}
        onCheckedChange={(checked) => toggleItem.mutate({ id: item.id, checked: !!checked })}
      />
      <span className={`flex-1 text-sm ${item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
        {item.name}
      </span>
      {item.checked && (
        <Input
          placeholder="Qté"
          value={item.quantity || ""}
          onChange={(e) => updateItemQuantity.mutate({ id: item.id, quantity: e.target.value || null })}
          className="h-6 w-16 text-xs"
        />
      )}
      <Button size="icon" variant="ghost" onClick={() => deleteItem.mutate(item.id)} className="h-6 w-6 text-muted-foreground hover:text-destructive">
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );

  const renderAddInput = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    return (
      <div className="flex gap-1 mt-1">
        <Input
          placeholder="Ajouter un article..."
          value={newItemTexts[key] || ""}
          onChange={(e) => setNewItemTexts(prev => ({ ...prev, [key]: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem(groupId)}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={() => handleAddItem(groupId)} className="h-8 shrink-0">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Ungrouped items */}
      {ungroupedItems.length > 0 && (
        <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Articles</h3>
          {ungroupedItems.map(renderItem)}
          {renderAddInput(null)}
        </div>
      )}
      {ungroupedItems.length === 0 && groups.length === 0 && (
        <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-4">
          <p className="text-muted-foreground text-sm text-center py-4 italic">Aucun article</p>
          {renderAddInput(null)}
        </div>
      )}

      {/* Groups */}
      {groups.map((group) => {
        const groupItems = getItemsByGroup(group.id);
        const isCollapsed = collapsedGroups.has(group.id);
        return (
          <div key={group.id} className="bg-card/80 backdrop-blur-sm rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleCollapse(group.id)} className="text-muted-foreground">
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {editingGroup === group.id ? (
                <Input autoFocus value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onBlur={() => { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); } }}
                  className="h-7 text-sm font-semibold" />
              ) : (
                <h3 className="text-sm font-semibold text-foreground flex-1">{group.name}</h3>
              )}
              <span className="text-xs text-muted-foreground">{groupItems.length}</span>
              <Button size="icon" variant="ghost" onClick={() => { setEditGroupName(group.name); setEditingGroup(group.id); }} className="h-6 w-6 text-muted-foreground">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => deleteGroup.mutate(group.id)} className="h-6 w-6 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {!isCollapsed && (
              <>
                {groupItems.map(renderItem)}
                {renderAddInput(group.id)}
              </>
            )}
          </div>
        );
      })}

      {/* Add group */}
      <div className="flex gap-2">
        <Input
          placeholder="Nouveau groupe (ex: Frais, Sec...)"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
          className="h-9"
        />
        <Button onClick={handleAddGroup} disabled={!newGroupName.trim()} className="shrink-0 gap-1">
          <Plus className="h-4 w-4" /> Groupe
        </Button>
      </div>
    </div>
  );
}
