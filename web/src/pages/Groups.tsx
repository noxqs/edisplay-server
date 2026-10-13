import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Layers, Trash2, Pencil, Check, X } from "lucide-react";
import { apiGet, apiSend, type Group } from "../api/client.ts";
import { PageHeader, Card, Button } from "../components/ui.tsx";

export function Groups() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => apiGet<Group[]>("/api/groups") });

  const [name, setName] = useState("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["groups"] });
    qc.invalidateQueries({ queryKey: ["devices"] });
  };

  const create = useMutation({
    mutationFn: () => apiSend("POST", "/api/groups", { name: name.trim() }),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });

  return (
    <div>
      <PageHeader title="Groups" subtitle="Create groups of frames that rotate through a shared sequence." />

      <Card className="mb-5">
        <div className="font-medium mb-2 flex items-center gap-1.5">
          <Plus size={15} /> Add a group
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hallway wall"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus size={15} /> Add
          </Button>
        </form>
      </Card>

      {groups.data?.length === 0 && (
        <Card className="flex flex-col items-center text-center py-10 border-dashed">
          <Layers className="text-[var(--muted)] mb-2" size={28} />
          <div className="font-medium">No groups yet</div>
          <p className="text-sm text-[var(--muted)] mt-1">Add a group above, then assign frames to it on the Devices tab.</p>
        </Card>
      )}

      <div className="space-y-2">
        {groups.data?.map((g) => (
          <GroupRow key={g.id} group={g} onChange={invalidate} />
        ))}
      </div>
    </div>
  );
}

function GroupRow({ group: g, onChange }: { group: Group; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);

  const rename = useMutation({
    mutationFn: () => apiSend("PATCH", `/api/groups/${g.id}`, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false);
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/groups/${g.id}`),
    onSuccess: onChange,
  });

  return (
    <Card className="flex items-center gap-2">
      <Layers size={15} className="text-[var(--muted)] shrink-0" />
      {editing ? (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) rename.mutate();
              if (e.key === "Escape") {
                setName(g.name);
                setEditing(false);
              }
            }}
          />
          <Button onClick={() => rename.mutate()} disabled={!name.trim() || rename.isPending}>
            <Check size={14} /> Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setName(g.name);
              setEditing(false);
            }}
          >
            <X size={14} />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 font-medium">{g.name}</span>
          <button onClick={() => setEditing(true)} className="text-[var(--muted)] hover:text-[var(--text)]" title="Rename">
            <Pencil size={14} />
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="text-[var(--muted)] hover:text-red-500 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </Card>
  );
}
