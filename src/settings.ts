import { invoke } from "@tauri-apps/api/core";

type Provider = {
  id: string;
  name: string;
  keyUrl: string;
  presets: string[];
  defaultModel: string;
  hasKey: boolean;
  hint: string;
  isActive: boolean;
  model: string;
};

type Probe = { ok: boolean; message: string; latencyMs: number };

const isTauri = "__TAURI_INTERNALS__" in window;

let providers: Provider[] = [];
let host: HTMLElement | null = null;
let draftKey = "";
let pending: string | null = null;
let confirmClear = false;
let lastProbe: Probe | null = null;
const fetchedModels: Record<string, string[]> = {};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error("API ayarları yalnızca masaüstü uygulamasında çalışır."));
  return invoke<T>(cmd, args);
}

function render(): void {
  if (!host) return;
  host.textContent = "";
  host.append(
    el("p", "api-note", "Anahtarlar Windows kimlik deposunda durur; dosyaya ve sayfa katmanına yazılmaz."),
  );

  const list = el("div", "prov-list");
  for (const provider of providers) list.append(providerRow(provider));
  host.append(list);

  const active = providers.find((p) => p.isActive) ?? providers[0];
  if (active) host.append(detail(active));
}

function providerRow(provider: Provider): HTMLButtonElement {
  const names = el("span", "prov-names");
  names.append(
    el("span", "prov-name", provider.name),
    el("span", "prov-sub", provider.hasKey ? `kayıtlı ${provider.hint}` : "anahtar yok"),
  );

  const button = el("button", `prov${provider.isActive ? " active" : ""}`);
  button.type = "button";
  button.append(
    el("span", `prov-dot${provider.hasKey ? " on" : ""}`),
    names,
    el("span", "prov-flag", provider.isActive ? "aktif" : ""),
  );

  button.addEventListener("click", () => {
    if (provider.isActive) return;
    draftKey = "";
    confirmClear = false;
    lastProbe = null;
    void select(provider.id);
  });
  return button;
}

function detail(provider: Provider): HTMLDivElement {
  const wrap = el("div", "api-detail");
  wrap.append(el("h3", "api-provider", provider.name));

  const keyField = el("div", "field");
  keyField.append(el("label", "field-label", "API anahtarı"));

  const keyInput = el("input", "field-input");
  keyInput.type = "password";
  keyInput.value = draftKey;
  keyInput.placeholder = provider.hasKey ? "yeni anahtar yapıştır" : "anahtarı yapıştır";
  keyInput.spellcheck = false;
  keyInput.autocomplete = "off";

  const eye = el("button", "mini", "göster");
  eye.type = "button";
  eye.addEventListener("click", () => {
    const shown = keyInput.type === "text";
    keyInput.type = shown ? "password" : "text";
    eye.textContent = shown ? "göster" : "gizle";
  });

  const keyRow = el("div", "field-row");
  keyRow.append(keyInput, eye);
  keyField.append(keyRow);

  const save = el("button", "btn primary", pending === "save" ? "kaydediliyor…" : "Kaydet");
  save.type = "button";
  save.disabled = pending !== null || !draftKey.trim();
  keyInput.addEventListener("input", () => {
    draftKey = keyInput.value;
    save.disabled = !draftKey.trim();
  });
  save.addEventListener("click", async () => {
    pending = "save";
    render();
    try {
      await call("api_save_key", { provider: provider.id, key: draftKey });
      draftKey = "";
      lastProbe = null;
    } catch (error) {
      lastProbe = { ok: false, message: String(error), latencyMs: 0 };
    }
    pending = null;
    await reload();
  });

  const clear = el("button", "btn", confirmClear ? "Emin misin?" : "Sil");
  clear.type = "button";
  clear.disabled = !provider.hasKey || pending !== null;
  clear.addEventListener("click", async () => {
    if (!confirmClear) {
      confirmClear = true;
      render();
      return;
    }
    confirmClear = false;
    await call("api_clear_key", { provider: provider.id }).catch(() => {});
    await reload();
  });

  const get = el("button", "btn link", "Anahtar al");
  get.type = "button";
  get.addEventListener("click", () => {
    call("open_key_page", { provider: provider.id }).catch(() => {
      window.open(provider.keyUrl, "_blank");
    });
  });

  const actions = el("div", "btn-row");
  actions.append(save, clear, get);
  wrap.append(keyField, actions);

  const modelField = el("div", "field");
  modelField.append(el("label", "field-label", "Model"));

  const datalist = el("datalist");
  datalist.id = `models-${provider.id}`;
  const seen = new Set<string>();
  for (const id of [...provider.presets, ...(fetchedModels[provider.id] ?? [])]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const option = el("option");
    option.value = id;
    datalist.append(option);
  }

  const modelInput = el("input", "field-input");
  modelInput.value = provider.model;
  modelInput.setAttribute("list", datalist.id);
  modelInput.spellcheck = false;
  modelInput.autocomplete = "off";
  modelInput.addEventListener("change", () => {
    void call("api_select", { model: modelInput.value }).catch(() => {});
  });
  modelField.append(modelInput, datalist);
  wrap.append(modelField);

  const testRow = el("div", "btn-row");
  const test = el("button", "btn", pending === "test" ? "test ediliyor…" : "Test et");
  test.type = "button";
  test.disabled = !provider.hasKey || pending !== null;
  test.addEventListener("click", async () => {
    pending = "test";
    render();
    try {
      lastProbe = await call<Probe>("api_test", { provider: provider.id });
      void loadModels(provider.id);
    } catch (error) {
      lastProbe = { ok: false, message: String(error), latencyMs: 0 };
    }
    pending = null;
    await reload();
  });
  testRow.append(test);

  if (lastProbe) {
    const label = lastProbe.latencyMs ? `${lastProbe.message} · ${lastProbe.latencyMs} ms` : lastProbe.message;
    testRow.append(el("span", `probe${lastProbe.ok ? " ok" : " bad"}`, label));
  }
  const count = fetchedModels[provider.id]?.length;
  if (count) testRow.append(el("span", "probe", `sağlayıcıdan ${count} model alındı`));
  wrap.append(testRow);

  return wrap;
}

async function reload(): Promise<void> {
  try {
    providers = await call<Provider[]>("api_providers");
  } catch {
    /* keep whatever is on screen */
    return;
  }
  render();
}

async function select(id: string): Promise<void> {
  await call("api_select", { provider: id }).catch(() => {});
  await reload();
  void loadModels(id).then(render);
}

async function loadModels(id: string): Promise<void> {
  if (fetchedModels[id]) return;
  try {
    fetchedModels[id] = await call<string[]>("api_models", { provider: id });
  } catch {
    /* presets stay usable when the provider refuses the list */
  }
}

export function renderSection(body: HTMLElement, name: string): void {
  host = body;
  body.dataset.section = name;
  body.textContent = "";

  if (name !== "api") {
    body.append(el("p", "api-note", "Bu bölüm henüz boş."));
    return;
  }

  call<Provider[]>("api_providers")
    .then((list) => {
      if (body.dataset.section !== "api") return;
      providers = list;
      render();
      const active = providers.find((p) => p.isActive);
      if (active?.hasKey) void loadModels(active.id).then(render);
    })
    .catch((error) => body.append(el("p", "api-note", String(error))));
}
