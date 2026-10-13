import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export type SourceKind = "existing" | "news" | "full_ai";

export interface Generation {
  id: string;
  name: string;
  sourceType: SourceKind;
  prompt: string;
  style: string;
  provider: string;
  params: Record<string, unknown>;
  createdAt: number;
}

interface GenerationRow {
  id: string;
  name: string;
  source_type: SourceKind;
  prompt: string;
  style: string;
  provider: string;
  params: string;
  created_at: number;
}

export interface GenerationInput {
  name?: string;
  sourceType?: SourceKind;
  prompt?: string;
  style?: string;
  provider?: string;
  params?: Record<string, unknown>;
}

function toDomain(r: GenerationRow): Generation {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(r.params);
  } catch {
    params = {};
  }
  return {
    id: r.id,
    name: r.name,
    sourceType: r.source_type,
    prompt: r.prompt,
    style: r.style,
    provider: r.provider,
    params,
    createdAt: r.created_at,
  };
}

export class GenerationRepo {
  constructor(private readonly db: DB) {}

  list(): Generation[] {
    return (this.db.prepare("SELECT * FROM generations ORDER BY created_at").all() as GenerationRow[]).map(toDomain);
  }

  get(id: string): Generation | undefined {
    const r = this.db.prepare("SELECT * FROM generations WHERE id = ?").get(id) as GenerationRow | undefined;
    return r ? toDomain(r) : undefined;
  }

  create(input: GenerationInput): Generation {
    const id = randomUUID().slice(0, 8);
    this.db
      .prepare(
        `INSERT INTO generations (id, name, source_type, prompt, style, provider, params, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name ?? "New generation",
        input.sourceType ?? "full_ai",
        input.prompt ?? "",
        input.style ?? "",
        input.provider ?? "",
        JSON.stringify(input.params ?? {}),
        Date.now(),
      );
    return this.get(id)!;
  }

  update(id: string, patch: GenerationInput): Generation | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    this.db
      .prepare(`UPDATE generations SET name = ?, source_type = ?, prompt = ?, style = ?, provider = ?, params = ? WHERE id = ?`)
      .run(
        patch.name ?? cur.name,
        patch.sourceType ?? cur.sourceType,
        patch.prompt ?? cur.prompt,
        patch.style ?? cur.style,
        patch.provider ?? cur.provider,
        JSON.stringify(patch.params ?? cur.params),
        id,
      );
    return this.get(id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM generations WHERE id = ?").run(id);
  }
}
