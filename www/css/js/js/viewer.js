import { App as CapApp } from "@capacitor/app";

const params = new URLSearchParams(location.search);
const src = params.get("src");
const title = params.get("title") || "محاكي";

if (src) {
  const frame = document.getElementById("sim-frame");
  frame.src = src;
  document.title = title;
}

CapApp.addListener("backButton", () => {
  window.location.href = "index.html";
});
