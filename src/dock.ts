import { invoke } from "@tauri-apps/api/core";

type Rect = { x: number; y: number; w: number; h: number };

type Answer = { text: string; provider: string; model: string; latencyMs: number };

type ProviderInfo = {
  id: string;
  name: string;
  hasKey: boolean;
  isActive: boolean;
  model: string;
};

export type Dock = {
  zone: () => Rect;
  left: () => number;
  dragging: () => boolean;
  greet: () => void;
  refresh: () => void;
};

type Hooks = {
  speak: (text: string) => void;
  think: (on: boolean) => void;
  refreshZones: () => void;
  openSettings: () => void;
};

const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const MARGIN = 16;
const STORE_KEY = "octo.dock.width";
const GREETING = "Merhaba! Ben Octo. Bana bir şey yaz, kollarımla fareyi kovalarken sohbet edelim.";

const isTauri = "__TAURI_INTERNALS__" in window;

function clampWidth(value: number): number {
  const room = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, innerWidth - 200));
  return Math.max(MIN_WIDTH, Math.min(room, Math.round(value)));
}

export function initDock(hooks: Hooks): Dock {
  const dock = document.querySelector<HTMLElement>("#dock")!;
  const grip = document.querySelector<HTMLElement>("#dock-grip")!;
  const log = document.querySelector<HTMLElement>("#dock-log")!;
  const form = document.querySelector<HTMLFormElement>("#composer")!;
  const input = document.querySelector<HTMLTextAreaElement>("#composer-text")!;
  const send = document.querySelector<HTMLButtonElement>("#composer-send")!;
  const clear = document.querySelector<HTMLButtonElement>("#tool-clear")!;
  const chip = document.querySelector<HTMLButtonElement>("#tool-provider")!;
  const chipLabel = document.querySelector<HTMLElement>("#chip-label")!;
  const chipDot = document.querySelector<HTMLElement>("#chip-dot")!;
  const status = document.querySelector<HTMLElement>("#dock-status")!;

  const history: { role: string; text: string }[] = [];
  let width = clampWidth(Number(localStorage.getItem(STORE_KEY)) || 380);
  let dragged = false;
  let waiting = false;

  function applyWidth() {
    document.documentElement.style.setProperty("--dock-w", `${width}px`);
    hooks.refreshZones();
  }
  function zone(): Rect {
    return {
      x: innerWidth - MARGIN - dock.offsetWidth,
      y: MARGIN,
      w: dock.offsetWidth + (dragged ? 320 : 0),
      h: dock.offsetHeight,
    };
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function push(kind: string, text: string): HTMLElement {
    const bubble = document.createElement("div");
    bubble.className = `msg ${kind}`;
    bubble.textContent = text;
    log.append(bubble);
    scrollDown();
    return bubble;
  }

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(130, input.scrollHeight)}px`;
    send.disabled = waiting || !input.value.trim();
  }

  async function refreshProvider() {
    if (!isTauri) return;
    try {
      const list = await invoke<ProviderInfo[]>("api_providers");
      const active = list.find((p) => p.isActive);
      if (!active) {
        chipLabel.textContent = "API yok";
        chipDot.classList.remove("on");
        status.textContent = "ayarlar → API";
        return;
      }
      chipLabel.textContent = `${active.name.split(" ").pop()} · ${active.model}`;
      chipDot.classList.toggle("on", active.hasKey);
      status.textContent = active.hasKey ? "bağlı" : "anahtar bekleniyor";
    } catch {
      /* the chip keeps its last known state */
    }
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || waiting) return;

    input.value = "";
    grow();
    push("me", text);
    history.push({ role: "user", text });

    waiting = true;
    send.disabled = true;
    hooks.think(true);
    const thinking = push("octo thinking", "…");

    try {
      const answer = await invoke<Answer>("chat_send", { history });
      thinking.remove();
      history.push({ role: "octo", text: answer.text });
      push("octo", answer.text);
      hooks.speak(answer.text);
      status.textContent = `${answer.latencyMs} ms`;
    } catch (error) {
      thinking.remove();
      history.pop();
      push("sys", String(error));
      hooks.think(false);
    }

    waiting = false;
    grow();
  }

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragged = true;
    grip.classList.add("dragging");
    grip.setPointerCapture(event.pointerId);
    hooks.refreshZones();
  });

  grip.addEventListener("pointermove", (event) => {
    if (!dragged) return;
    width = clampWidth(innerWidth - event.clientX - MARGIN);
    applyWidth();
  });

  const stopDrag = () => {
    if (!dragged) return;
    dragged = false;
    grip.classList.remove("dragging");
    localStorage.setItem(STORE_KEY, String(width));
    hooks.refreshZones();
  };

  grip.addEventListener("pointerup", stopDrag);
  grip.addEventListener("pointercancel", stopDrag);
  grip.addEventListener("dblclick", () => {
    width = clampWidth(width > 460 ? 360 : 560);
    localStorage.setItem(STORE_KEY, String(width));
    applyWidth();
  });

  input.addEventListener("input", grow);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  clear.addEventListener("click", () => {
    history.length = 0;
    log.textContent = "";
    hooks.speak("");
    status.textContent = "";
  });

  chip.addEventListener("click", hooks.openSettings);

  addEventListener("resize", applyWidth);

  // The zone is reported by the caller once the dock handle exists; setting it here would recurse.
  document.documentElement.style.setProperty("--dock-w", `${width}px`);
  grow();
  void refreshProvider();

  return {
    zone,
    left: () => innerWidth - MARGIN - dock.offsetWidth,
    dragging: () => dragged,
    refresh: () => void refreshProvider(),
    greet() {
      if (log.childElementCount > 0) return;
      push("octo", GREETING);
      hooks.speak(GREETING);
    },
  };
}
