import { useState, useRef } from "react";
import { z } from "zod";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useShoppingList, type ShoppingItem } from "@/hooks/useShoppingList";
import { toast } from "@/hooks/use-toast";

// ─── Validation schemas ───────────────────────────────────────────────────────
const shoppingItemSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)"),
});

const shoppingGroupSchema = z.object({
  name: z.string().trim().min(1, "Le nom du groupe est requis").max(60, "Nom trop long (60 car. max)"),
});

// ─── drag state stored as module-level ref to avoid stale closures ───────────
type DragPayload =
  | { kind: "item"; id: string; groupId: string | null }
  | { kind: "group"; id: string };

export function ShoppingList() {
  const {
    groups, ungroupedItems,
    addGroup, renameGroup, deleteGroup,
    addItem, toggleItem, updateItemQuantity, updateItemBrand, renameItem, deleteItem,
    getItemsByGroup, reorderItems, reorderGroups,
  } = useShoppingList();

  const [newGroupName, setNewGroupName] = useState("");
  const [newItemTexts, setNewItemTexts] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // per-item editing state: "brand" | "qty" | null
  const [editingField, setEditingField] = useState<Record<string, "brand" | "qty" | null>>({});

  // Debounce timers
  const nameTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const brandTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const quantityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Local state for controlled inputs
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [localBrands, setLocalBrands] = useState<Record<string, string>>({});
  const [localQuantities, setLocalQuantities] = useState<Record<string, string>>({});

  // Drag state
  const dragPayload = useRef<DragPayload | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const getLocalName = (item: ShoppingItem) => localNames[item.id] ?? item.name;
  const getLocalBrand = (item: ShoppingItem) => localBrands[item.id] ?? (item.brand || "");
  const getLocalQuantity = (item: ShoppingItem) => localQuantities[item.id] ?? (item.quantity || "");

  const handleNameChange = (item: ShoppingItem, value: string) => {
    setLocalNames(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(nameTimers.current[item.id]);
    nameTimers.current[item.id] = setTimeout(() => {
      if (value.trim()) renameItem.mutate({ id: item.id, name: value.trim() });
    }, 600);
  };

  const handleBrandChange = (item: ShoppingItem, value: string) => {
    setLocalBrands(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(brandTimers.current[item.id]);
    brandTimers.current[item.id] = setTimeout(() => {
      updateItemBrand.mutate({ id: item.id, brand: value || null });
    }, 600);
  };

  const handleQuantityChange = (item: ShoppingItem, value: string) => {
    setLocalQuantities(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(quantityTimers.current[item.id]);
    quantityTimers.current[item.id] = setTimeout(() => {
      updateItemQuantity.mutate({ id: item.id, quantity: value || null });
    }, 600);
  };

  const commitBrand = (item: ShoppingItem) => {
    const val = getLocalBrand(item);
    updateItemBrand.mutate({ id: item.id, brand: val || null });
    setEditingField(prev => ({ ...prev, [item.id]: null }));
  };

  const commitQty = (item: ShoppingItem) => {
    const val = getLocalQuantity(item);
    updateItemQuantity.mutate({ id: item.id, quantity: val || null });
    // Always close editing on commit (whether empty or not)
    setEditingField(prev => ({ ...prev, [item.id]: null }));
  };

  const toggleCollapse = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddGroup = () => {
    const result = shoppingGroupSchema.safeParse({ name: newGroupName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }
    addGroup.mutate(result.data.name);
    setNewGroupName("");
  };

  const handleAddItem = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    const result = shoppingItemSchema.safeParse({ name: newItemTexts[key] || "" });
    if (!result.success) return; // silent: empty field, user hasn't typed yet
    addItem.mutate({ name: result.data.name, group_id: groupId });
    setNewItemTexts(prev => ({ ...prev, [key]: "" }));
  };

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  const handleItemDragStart = (e: React.DragEvent, item: ShoppingItem) => {
    e.stopPropagation();
    dragPayload.current = { kind: "item", id: item.id, groupId: item.group_id };
    e.dataTransfer.effectAllowed = "move";
  };

  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    dragPayload.current = { kind: "group", id: groupId };
    e.dataTransfer.effectAllowed = "move";
  };

  // Drop ON an item → insert before that item in its group
  const handleDropOnItem = (e: React.DragEvent, targetItem: ShoppingItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const payload = dragPayload.current;
    if (!payload || payload.kind !== "item") return;

    const targetGroupId = targetItem.group_id;
    const targetGroupItems = (targetGroupId
      ? getItemsByGroup(targetGroupId)
      : ungroupedItems
    ).filter(i => i.id !== payload.id);

    const targetIdx = targetGroupItems.findIndex(i => i.id === targetItem.id);
    const insertAt = targetIdx === -1 ? targetGroupItems.length : targetIdx;

    targetGroupItems.splice(insertAt, 0, { id: payload.id } as ShoppingItem);
    const updates = targetGroupItems.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
      group_id: targetGroupId,
    }));
    reorderItems.mutate(updates);
    dragPayload.current = null;
  };

  // Drop on group header / container → append to end of that group
  const handleDropOnGroup = (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const payload = dragPayload.current;
    if (!payload) return;

    if (payload.kind === "item") {
      const groupItems = (targetGroupId ? getItemsByGroup(targetGroupId) : ungroupedItems)
        .filter(i => i.id !== payload.id);
      const updates = [...groupItems, { id: payload.id } as ShoppingItem].map((i, idx) => ({
        id: i.id,
        sort_order: idx,
        group_id: targetGroupId,
      }));
      reorderItems.mutate(updates);
    } else if (payload.kind === "group" && targetGroupId && payload.id !== targetGroupId) {
      const fromIdx = groups.findIndex(g => g.id === payload.id);
      const toIdx = groups.findIndex(g => g.id === targetGroupId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const reordered = [...groups];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        reorderGroups.mutate(reordered.map((g, i) => ({ id: g.id, sort_order: i })));
      }
    }
    dragPayload.current = null;
  };

  // ── Render item ────────────────────────────────────────────────────────────

  const renderItem = (item: ShoppingItem) => {
    const fieldEditing = editingField[item.id] ?? null;
    const brand = getLocalBrand(item);
    const qty = getLocalQuantity(item);
    const isBrandEditing = fieldEditing === "brand";
    const isQtyEditing = fieldEditing === "qty";
    const isOver = dragOverKey === `item:${item.id}`;
    // Show quantity input if editing OR if quantity is empty (always allow input when no value)
    const showQtyInput = isQtyEditing || (!qty && fieldEditing === null && false); // controlled by click

    return (
      <div key={item.id}
        draggable
        onDragStart={(e) => handleItemDragStart(e, item)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverKey(`item:${item.id}`); }}
        onDragLeave={() => setDragOverKey(null)}
        onDrop={(e) => handleDropOnItem(e, item)}
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${isOver ? 'ring-2 ring-primary/60 bg-primary/5' : ''} ${!item.checked ? 'opacity-40' : ''}`}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        <Checkbox
          checked={item.checked}
          onCheckedChange={(checked) => {
            toggleItem.mutate({ id: item.id, checked: !!checked });
            // Réinitialiser la quantité quand l'article est désélectionné
            if (!checked) {
              updateItemQuantity.mutate({ id: item.id, quantity: null });
              setLocalQuantities(prev => { const next = { ...prev }; delete next[item.id]; return next; });
            }
          }}
          className={item.checked ? 'border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black' : ''}
        />

        {/* Always-editable name — width adapts to content */}
        <Input
          value={getLocalName(item)}
          onChange={(e) => handleNameChange(item, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className={`h-6 text-sm border-transparent bg-transparent px-1 focus:border-border focus:bg-background font-medium ${!item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}
          style={{ width: `${Math.max(4, getLocalName(item).length + 1)}ch`, minWidth: '4ch', maxWidth: '60%' }}
        />

        {/* Brand — inline after name */}
        {isBrandEditing ? (
          <Input
            autoFocus
            placeholder="Marque"
            value={brand}
            onChange={(e) => handleBrandChange(item, e.target.value)}
            onBlur={() => commitBrand(item)}
            onKeyDown={(e) => { if (e.key === "Enter") commitBrand(item); }}
            className="h-6 w-24 text-xs italic border-border bg-background px-1 shrink-0"
          />
        ) : (
          <button
            onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "brand" }))}
            className={`text-xs italic shrink-0 px-1 rounded hover:bg-muted/60 transition-colors ${brand ? 'text-muted-foreground' : 'text-muted-foreground/20'}`}
          >
            {brand || <span className="text-[9px]">Marque</span>}
          </button>
        )}

        {/* Quantity — inline after brand */}
        {isQtyEditing ? (
          <div className="flex items-baseline gap-0.5 shrink-0">
            <span className="text-sm font-bold text-foreground">×</span>
            <Input
              autoFocus
              placeholder="Qté"
              value={qty}
              onChange={(e) => handleQuantityChange(item, e.target.value)}
              onBlur={() => commitQty(item)}
              onKeyDown={(e) => { if (e.key === "Enter") commitQty(item); }}
              className="h-6 w-14 text-sm font-bold border-border bg-background px-1 shrink-0"
            />
          </div>
        ) : (
          <button
            onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "qty" }))}
            className="shrink-0 px-1 rounded hover:bg-muted/60 transition-colors"
          >
            {qty ? (
              <span className="text-base font-bold text-foreground">×{qty}</span>
            ) : (
              <span className="text-[9px] text-muted-foreground/20">Quantité</span>
            )}
          </button>
        )}

        <Button size="icon" variant="ghost" onClick={() => deleteItem.mutate(item.id)} className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0 ml-auto">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  const renderAddInput = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    return (
      <div className="flex gap-1 mt-1.5 opacity-25 hover:opacity-70 transition-opacity focus-within:opacity-100">
        <Input
          placeholder="Ajouter un article…"
          value={newItemTexts[key] || ""}
          onChange={(e) => setNewItemTexts(prev => ({ ...prev, [key]: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem(groupId)}
          className="h-6 text-xs border-dashed border-border/40 bg-transparent focus:bg-background"
        />
        <Button size="sm" variant="ghost" onClick={() => handleAddItem(groupId)} className="h-6 shrink-0 px-1.5 opacity-60">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {/* Ungrouped items */}
      <div
        className={`bg-card/80 backdrop-blur-sm rounded-2xl p-3 ${dragOverKey === 'ungrouped' ? 'ring-2 ring-primary/60' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOverKey('ungrouped'); }}
        onDragLeave={() => setDragOverKey(null)}
        onDrop={(e) => handleDropOnGroup(e, null)}
      >
        <h3 className="text-xs font-extrabold text-foreground/60 mb-1.5 uppercase tracking-widest">Articles</h3>
        {ungroupedItems.map(renderItem)}
        {renderAddInput(null)}
      </div>

      {/* Groups */}
      {groups.map((group) => {
        const groupItems = getItemsByGroup(group.id);
        const isCollapsed = collapsedGroups.has(group.id);
        const isGroupOver = dragOverKey === `group:${group.id}`;
        return (
          <div key={group.id}
            draggable
            onDragStart={(e) => handleGroupDragStart(e, group.id)}
            onDragOver={(e) => { e.preventDefault(); setDragOverKey(`group:${group.id}`); }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={(e) => handleDropOnGroup(e, group.id)}
            className={`bg-card/80 backdrop-blur-sm rounded-2xl p-3 cursor-grab active:cursor-grabbing ${isGroupOver ? 'ring-2 ring-primary/60' : ''}`}>
            {/* Group header */}
            <div className="flex items-center gap-2 mb-2">
              <GripVertical className="h-4 w-4 text-muted-foreground/30 shrink-0" />
              <button onClick={() => toggleCollapse(group.id)} className="text-muted-foreground shrink-0">
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {editingGroup === group.id ? (
                <Input autoFocus value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onBlur={() => { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); } }}
                  className="h-7 text-sm font-bold flex-1" />
              ) : (
                <h3 className="text-base font-black text-foreground flex-1 tracking-wider uppercase">{group.name}</h3>
              )}
              <span className="text-[10px] font-bold text-foreground bg-foreground/10 rounded-full px-2 py-0.5 shrink-0">{groupItems.length}</span>
              <Button size="icon" variant="ghost" onClick={() => { setEditGroupName(group.name); setEditingGroup(group.id); }} className="h-6 w-6 text-muted-foreground/50 hover:text-muted-foreground">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => deleteGroup.mutate(group.id)} className="h-6 w-6 text-muted-foreground/50 hover:text-destructive">
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

      {/* Add group — more discreet */}
      <div className="flex gap-2 opacity-15 hover:opacity-50 transition-opacity focus-within:opacity-100">
        <Input
          placeholder="Nouveau groupe…"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
          className="h-6 text-xs border-dashed border-border/30 bg-transparent focus:bg-background"
        />
        <Button variant="ghost" onClick={handleAddGroup} disabled={!newGroupName.trim()} className="shrink-0 gap-1 text-xs h-6 border border-dashed border-border/30 px-2">
          <Plus className="h-3 w-3" /> Groupe
        </Button>
      </div>
    </div>
  );
}
