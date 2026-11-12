import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { App as CapApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar } from "@capacitor/status-bar";

const DATA_SIMS = "simulators";
const DATA_DOWNLOADED = "downloaded.json";
const DATA_IMPORTED = "imported.json";

async function fileExists(path) {
  try {
    await Filesystem.stat({ path, directory: Directory.Data });
    return true;
  } catch { return false; }
}
async function readJSON(path) {
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: "utf8" });
    return JSON.parse(r.data);
  } catch { return null; }
}
async function writeJSON(path, obj) {
  await Filesystem.writeFile({
    path, directory: Directory.Data,
    data: JSON.stringify(obj), encoding: "utf8",
  });
}

async function loadBundled() {
  const r = await fetch("simulators.json", { cache: "no-store" });
  return r.json();
}
async function loadMerged() {
  const bundled = await loadBundled();
  const downloaded = await readJSON(DATA_DOWNLOADED);
  const imported = await readJSON(DATA_IMPORTED);
  const map = new Map();
  (bundled.simulators || []).forEach(s => map.set(s.id, s));
  (downloaded?.simulators || []).forEach(s => map.set(s.id, s));
  (imported?.simulators || []).forEach(s => map.set(s.id, s));
  return { version: Math.max(bundled.version || 1, downloaded?.version || 1, imported?.version || 1), simulators: [...map.values()] };
}

async function resolveSrc(file) {
  const dataPath = `${DATA_SIMS}/${file}`;
  if (await fileExists(dataPath)) {
    const uri = await Filesystem.getUri({ path: dataPath, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri.uri);
  }
  return `simulators/${file}`;
}

async function render() {
  const merged = await loadMerged();
  const importedData = await readJSON(DATA_IMPORTED);
  const importedIds = new Set((importedData?.simulators || []).map(s => s.id));
  
  const list = document.getElementById("sim-list");
  list.innerHTML = "";
  if (!merged.simulators.length) {
    list.innerHTML = `<p style="text-align:center;opacity:.6">لا توجد محاكيات.</p>`;
    return;
  }
  
  for (const sim of merged.simulators) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-emoji">${sim.emoji || "📄"}</div>
      <div class="card-body">
        <p class="card-title">${sim.title}</p>
        <p class="card-desc">${sim.description || ""}</p>
      </div>`;
      
    // إضافة زر الحذف فقط للملفات المستوردة
    if (importedIds.has(sim.id)) {
      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.innerHTML = "🗑️";
      delBtn.onclick = (e) => {
        e.stopPropagation(); // يمنع فتح المحاكي عند الضغط على الحذف
        deleteSimulator(sim);
      };
      card.appendChild(delBtn);
    }

    card.addEventListener("click", async () => {
      const src = await resolveSrc(sim.file);
      const url = `viewer.html?src=${encodeURIComponent(src)}&title=${encodeURIComponent(sim.title)}`;
      window.location.href = url;
    });
    list.appendChild(card);
  }
}

async function deleteSimulator(sim) {
  if (!confirm(`هل أنت متأكد من حذف "${sim.title}"؟`)) return;
  
  let imported = await readJSON(DATA_IMPORTED);
  if (imported) {
    imported.simulators = imported.simulators.filter(s => s.id !== sim.id);
    await writeJSON(DATA_IMPORTED, imported);
  }
  
  try {
    await Filesystem.deleteFile({ path: `${DATA_SIMS}/${sim.file}`, directory: Directory.Data });
  } catch(e) {}
  
  toast("🗑️ تم الحذف");
  await render();
}

async function checkForUpdates() {
  if (!REMOTE_SIMULATORS_URL || REMOTE_SIMULATORS_URL.includes("YOUR_USERNAME")) return;
  try {
    const res = await fetch(REMOTE_SIMULATORS_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const remote = await res.json();
    const downloaded = await readJSON(DATA_DOWNLOADED);
    const localIds = new Set((downloaded?.simulators || []).map(s => s.id));
    const hasNew = (remote.simulators || []).some(s => !localIds.has(s.id));
    const banner = document.getElementById("update-banner");
    const btn = document.getElementById("update-btn");
    if (hasNew || (remote.version || 0) > (downloaded?.version || 0)) {
      banner.hidden = false;
      btn.classList.add("has-update");
      btn.onclick = () => runUpdate(remote);
    } else {
      banner.hidden = true;
    }
  } catch (e) { console.warn("update check failed", e); }
}

async function runUpdate(remote) {
  const btn = document.getElementById("update-btn");
  btn.textContent = "⏳ جاري التحديث…";
  btn.classList.remove("has-update");
  try {
    const baseUrl = REMOTE_SIMULATORS_URL.replace(/\/[^/]*$/, "/");
    for (const sim of remote.simulators || []) {
      const url = baseUrl + "simulators/" + sim.file;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const html = await res.text();
      await Filesystem.writeFile({ path: `${DATA_SIMS}/${sim.file}`, directory: Directory.Data, data: html, encoding: "utf8" });
    }
    await writeJSON(DATA_DOWNLOADED, remote);
    toast("✅ تم التحديث");
    document.getElementById("update-banner").hidden = true;
    await render();
  } catch (e) { toast("❌ فشل التحديث"); }
}

async function importSimulator(file) {
  const text = await file.text();
  await Filesystem.mkdir({ path: DATA_SIMS, directory: Directory.Data, recursive: true }).catch(() => {});
  const safeName = "imported-" + Date.now() + "-" + file.name.replace(/[^a-z0-9.\-]/gi, "_");
  await Filesystem.writeFile({ path: `${DATA_SIMS}/${safeName}`, directory: Directory.Data, data: text, encoding: "utf8" });
  
  const imported = (await readJSON(DATA_IMPORTED)) || { version: 1, simulators: [] };
  imported.simulators.push({
    id: "user-" + Date.now(),
    title: file.name.replace(/\.html?$/i, ""),
    description: "محاكي مستورد من الجهاز",
    emoji: "📥",
    file: safeName,
  });
  await writeJSON(DATA_IMPORTED, imported);
  toast("✅ تم استيراد المحاكي");
  await render();
}

async function resetUserData() {
  try { await Filesystem.deleteFile({ path: DATA_DOWNLOADED, directory: Directory.Data }); } catch {}
  try { await Filesystem.deleteFile({ path: DATA_IMPORTED, directory: Directory.Data }); } catch {}
  try {
    const list = await Filesystem.readdir({ path: DATA_SIMS, directory: Directory.Data });
    for (const f of list.files) {
      await Filesystem.deleteFile({ path: `${DATA_SIMS}/${f.name}`, directory: Directory.Data }).catch(() => {});
    }
  } catch {}
  toast("↺ تمت إعادة التعيين");
  await render();
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

document.addEventListener("DOMContentLoaded", async () => {
  await render();
  await checkForUpdates();

  document.getElementById("settings-btn").onclick = () => {
    document.getElementById("settings-overlay").hidden = false;
  };
  document.getElementById("close-settings").onclick = () => {
    document.getElementById("settings-overlay").hidden = true;
  };
  
  // زر الاستيراد العائم (+)
  document.getElementById("fab-import").onclick = () => {
    document.getElementById("import-file").click();
  };

  document.getElementById("import-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (f) await importSimulator(f);
    e.target.value = "";
  };
  
  document.getElementById("reset-btn").onclick = async () => {
    if (confirm("حذف كل المحاكيات المستوردة والمحدَّثة؟")) {
      await resetUserData();
      document.getElementById("settings-overlay").hidden = true;
    }
  };

  CapApp.addListener("backButton", ({ canGoBack }) => {
    if (!canGoBack) CapApp.exitApp();
  });

  try { await SplashScreen.hide(); } catch {}
  try { await StatusBar.setStyle({ style: "default" }); } catch {}
});
