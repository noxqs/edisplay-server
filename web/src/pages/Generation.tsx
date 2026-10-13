import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Sparkles, Image, Newspaper } from "lucide-react";
import { apiGet, apiSend, type Generation as Gen } from "../api/client.ts";
import { PageHeader, Card, Button, Badge } from "../components/ui.tsx";

const SOURCES = [
  { value: "existing", label: "From existing photos", icon: Image, hint: "Re-style or remix your Immich photos." },
  { value: "news", label: "News from the web", icon: Newspaper, hint: "Summarise a feed/site into a visual." },
  { value: "full_ai", label: "Fully AI-generated", icon: Sparkles, hint: "Generate an image from the prompt." },
] as const;

export function Generation() {
  const qc = useQueryClient();
  const gens = useQuery({ queryKey: ["generations"], queryFn: () => apiGet<Gen[]>("/api/generations") });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiSend<Gen>("POST", "/api/generations", { name: "New generation" }),
    onSuccess: (g) => {
      setSelectedId(g.id);
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });

  const selected = gens.data?.find((g) => g.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="GenAI"
        subtitle="Configure AI-generated or AI-curated content."
        actions={
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus size={15} /> New GenAI
          </Button>
        }
      />

      <Card className="mb-4 border-dashed">
        <p className="text-sm text-[var(--muted)]">
          <span className="text-[var(--text)] font-medium">Scaffold.</span> Prompts and settings are saved now; the
          provider is wired up in a later pass. Connect Gemini (images) and Claude (text/news) under{" "}
          <span className="text-[var(--text)]">Settings → AI providers</span>; spend shows on the Usage → AI Cost tab.
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-2">
          {gens.data?.length === 0 && <Card>No generations yet.</Card>}
          {gens.data?.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedId(g.id)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                g.id === selectedId ? "border-blue-500 bg-blue-500/5" : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <div className="font-medium">{g.name}</div>
              <div className="mt-1">
                <Badge tone="slate">{SOURCES.find((s) => s.value === g.sourceType)?.label ?? g.sourceType}</Badge>
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <GenerationEditor key={selected.id} gen={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card className="text-sm text-[var(--muted)]">Select a generation, or create a new one.</Card>
        )}
      </div>
    </div>
  );
}

function GenerationEditor({ gen, onDeleted }: { gen: Gen; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(gen.name);
  const [sourceType, setSourceType] = useState(gen.sourceType);
  const [prompt, setPrompt] = useState(gen.prompt);
  const [style, setStyle] = useState(gen.style);
  const [provider, setProvider] = useState(gen.provider);

  const save = useMutation({
    mutationFn: () => apiSend<Gen>("PATCH", `/api/generations/${gen.id}`, { name, sourceType, prompt, style, provider }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });
  const remove = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/generations/${gen.id}`),
    onSuccess: () => {
      onDeleted();
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });

  return (
    <Card className="space-y-4">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
      </Field>

      <Field label="Source">
        <div className="grid sm:grid-cols-3 gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              onClick={() => setSourceType(s.value)}
              className={`text-left rounded-lg border p-3 ${
                sourceType === s.value ? "border-blue-500 bg-blue-500/5" : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <s.icon size={16} className="mb-1" />
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-xs text-[var(--muted)]">{s.hint}</div>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Prompt">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="A watercolor of a misty mountain lake at dawn…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Style">
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="watercolor, vivid, minimal…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
          />
        </Field>
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
          >
            <option value="">— not set —</option>
            <option value="replicate">Replicate</option>
            <option value="openai">OpenAI</option>
            <option value="local-sd">Local Stable Diffusion</option>
          </select>
        </Field>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="danger" onClick={() => remove.mutate()}>
          <Trash2 size={14} /> Delete
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--muted)] mb-1.5">{label}</div>
      {children}
    </div>
  );
}
