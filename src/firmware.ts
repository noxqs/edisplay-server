// Firmware flashing support: resolves the esp32-photoframe GitHub release, downloads the
// per-board merged binary, caches it on disk, and serves an ESP-Web-Tools manifest that points
// at our own (same-origin) bin URL so the browser flasher avoids cross-origin fetch issues.
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface Board {
  id: string;
  label: string;
  chipFamily: string;
}

export const BOARDS: Board[] = [
  { id: "seeedstudio_xiao_ee02", label: 'Seeed XIAO EE02 — 13.3" 6-color', chipFamily: "ESP32-S3" },
  { id: "seeedstudio_xiao_ee04", label: 'Seeed XIAO EE04 — 7.3" 6-color', chipFamily: "ESP32-S3" },
  { id: "seeedstudio_reterminal_e1002", label: 'reTerminal E1002 — 7.3" 6-color', chipFamily: "ESP32-S3" },
  { id: "waveshare_photopainter_73", label: 'Waveshare PhotoPainter — 7.3" 7-color', chipFamily: "ESP32-S3" },
];

const RELEASE_TTL = 60 * 60 * 1000;

interface ReleaseInfo {
  at: number;
  tag: string;
  assets: Record<string, string>; // board id -> download url
}

export class FirmwareCache {
  private readonly dir: string;
  private release?: ReleaseInfo;

  constructor(
    cacheDir: string,
    private readonly repo: string,
  ) {
    this.dir = path.join(cacheDir, "firmware");
  }

  boards(): Board[] {
    return BOARDS;
  }

  isBoard(id: string): boolean {
    return BOARDS.some((b) => b.id === id);
  }

  private async getRelease(): Promise<ReleaseInfo> {
    if (this.release && Date.now() - this.release.at < RELEASE_TTL) return this.release;
    const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "photoframe-server" },
    });
    if (!res.ok) throw new Error(`GitHub releases lookup failed: ${res.status}`);
    const r = (await res.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
    const assets: Record<string, string> = {};
    for (const b of BOARDS) {
      const a = r.assets.find((x) => x.name === `photoframe-firmware-${b.id}-merged.bin`);
      if (a) assets[b.id] = a.browser_download_url;
    }
    this.release = { at: Date.now(), tag: r.tag_name, assets };
    return this.release;
  }

  async tag(): Promise<string> {
    return (await this.getRelease()).tag;
  }

  /** Local path to the board's merged binary, downloading + caching it on first use. */
  async binPath(board: string): Promise<string> {
    const rel = await this.getRelease();
    const url = rel.assets[board];
    if (!url) throw new Error(`No firmware available for board ${board}`);
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${board}-${rel.tag}.bin`);
    if (!existsSync(file)) {
      const res = await fetch(url); // follows the release redirect to the CDN
      if (!res.ok) throw new Error(`Firmware download failed: ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    return file;
  }

  /** ESP-Web-Tools manifest pointing at our same-origin firmware.bin. */
  async manifest(board: string): Promise<object> {
    const rel = await this.getRelease();
    const b = BOARDS.find((x) => x.id === board)!;
    return {
      name: `ESP32 PhotoFrame — ${b.label}`,
      version: rel.tag,
      new_install_prompt_erase: true,
      new_install_improv_wait_time: 15,
      builds: [{ chipFamily: b.chipFamily, parts: [{ path: "firmware.bin", offset: 0 }] }],
    };
  }
}
