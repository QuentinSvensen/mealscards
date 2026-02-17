import { useState } from "react";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useShoppingList, type ShoppingItem } from "@/hooks/useShoppingList";

export function ShoppingList() {
  const {
    groups, ungroupedItems,
    addGroup, renameGroup, deleteGroup,
    addItem, toggleItem, updateItemQuantity, updateItemBrand, renameItem, deleteItem,
    getItemsByGroup, moveItem, reorderGroups,
  } = useShoppingList();

  const [newGroupName, setNewGroupName] = useState("");
  const [newItemTexts, setNewItemTexts] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);

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

  const handleGroupDrop = (e: React.DragEvent, targetGroupId: string | null, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    // Item drop into group
    if (dragItemId) {
      moveItem.mutate({ id: dragItemId, group_id: targetGroupId });
      setDragItemId(null);
    }
    // Group reorder
    if (dragGroupId && targetGroupId && dragGroupId !== targetGroupId) {
      const fromIdx = groups.findIndex(g => g.id === dragGroupId);
      const toIdx = groups.findIndex(g => g.id === targetGroupId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const reordered = [...groups];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        reorderGroups.mutate(reordered.map((g, i) => ({ id: g.id, sort_order: i })));
      }
      setDragGroupId(null);
    }
  };

  const renderItem = (item: ShoppingItem) => (
    <div key={item.id} draggable
      onDragStart={(e) => { e.stopPropagation(); setDragItemId(item.id); e.dataTransfer.setData("itemId", item.id); }}
      className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${!item.checked ? 'opacity-40' : ''}`}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
      <Checkbox
        checked={item.checked}
        onCheckedChange={(checked) => toggleItem.mutate({ id: item.id, checked: !!checked })}
        className={item.checked ? 'border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black' : ''}
      />
      <span className={`text-sm ${!item.checked ? 'line-through text-muted-foreground' : 'text-foreground font-medium'}`}>
        {item.name}
      </span>
      {item.brand && (
        <span className="text-xs italic text-muted-foreground">{item.brand}</span>
      )}
      {item.checked && (
        <>
          <Input
            placeholder="Marque"
            value={item.brand || ""}
            onChange={(e) => updateItemBrand.mutate({ id: item.id, brand: e.target.value || null })}
            className="h-5 w-20 text-[10px] italic border-muted px-1 ml-auto"
          />
          <Input
            placeholder="Qté"
            value={item.quantity || ""}
            onChange={(e) => updateItemQuantity.mutate({ id: item.id, quantity: e.target.value || null })}
            className="h-5 w-12 text-[10px] border-muted px-1"
          />
        </>
      )}
      <Button size="icon" variant="ghost" onClick={() => deleteItem.mutate(item.id)} className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0 ml-auto">
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
          className="h-7 text-xs"
        />
        <Button size="sm" onClick={() => handleAddItem(groupId)} className="h-7 shrink-0 px-2">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {/* Ungrouped items */}
      <div className="bg-card/80 backdrop-blur-sm rounded-2xl p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleGroupDrop(e, null, 0)}>
        <h3 className="text-xs font-semibold text-foreground mb-1.5">Articles</h3>
        {ungroupedItems.map(renderItem)}
        {renderAddInput(null)}
      </div>

      {/* Groups */}
      {groups.map((group, groupIdx) => {
        const groupItems = getItemsByGroup(group.id);
        const isCollapsed = collapsedGroups.has(group.id);
        return (
          <div key={group.id} draggable
            onDragStart={(e) => { setDragGroupId(group.id); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleGroupDrop(e, group.id, groupIdx)}
            className="bg-card/80 backdrop-blur-sm rounded-2xl p-3 cursor-grab active:cursor-grabbing">
            <div className="flex items-center gap-1.5 mb-1.5">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
              <button onClick={() => toggleCollapse(group.id)} className="text-muted-foreground">
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {editingGroup === group.id ? (
                <Input autoFocus value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onBlur={() => { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); } }}
                  className="h-6 text-xs font-semibold" />
              ) : (
                <h3 className="text-xs font-semibold text-foreground flex-1">{group.name}</h3>
              )}
              <span className="text-[10px] text-muted-foreground">{groupItems.length}</span>
              <Button size="icon" variant="ghost" onClick={() => { setEditGroupName(group.name); setEditingGroup(group.id); }} className="h-5 w-5 text-muted-foreground">
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => deleteGroup.mutate(group.id)} className="h-5 w-5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-2.5 w-2.5" />
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
          className="h-8 text-sm"
        />
        <Button onClick={handleAddGroup} disabled={!newGroupName.trim()} className="shrink-0 gap-1 text-xs">
          <Plus className="h-3.5 w-3.5" /> Groupe
        </Button>
      </div>
    </div>
  );
}
