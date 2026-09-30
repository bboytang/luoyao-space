import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { DomAvatarRenderer } from "../../../runtimes/avatar/src/dom-renderer";
import { BrowserPcmCapture, BrowserPcmPlayback } from "./browser-audio";
import { RealtimeClient } from "./realtime-client";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Luoyao Space app root is missing");

const shell = document.createElement("section");
shell.className = "luoyao-space";
const avatarRoot = document.createElement("div");
avatarRoot.className = "avatar-root";
const controls = document.createElement("div");
controls.className = "controls";

const renderer = new DomAvatarRenderer({ root: avatarRoot });
const runtime = new AvatarRuntime({ renderer });

function button(label: string, action: () => void): void {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  controls.appendChild(element);
}

button("待机", () => runtime.setActivity("idle"));
button("倾听", () => runtime.setActivity("listening"));
button("思考", () => runtime.setActivity("thinking"));
button("说话", () => runtime.setSpeaking(true));
button("温暖", () => runtime.applyEmotion({
  emotion: "warm",
  intensity: 0.8,
  expression: "soft_smile",
}));
button("好奇", () => runtime.applyEmotion({
  emotion: "curious",
  intensity: 0.8,
  expression: "curious",
}));

const title = document.createElement("h1");
title.textContent = "Luoyao Space";
const subtitle = document.createElement("p");
subtitle.textContent = "动态角色运行时预览";

shell.append(title, subtitle, avatarRoot, controls, realtimePanel);
app.appendChild(shell);

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; background: #11131a; }
  .luoyao-space { min-height: 100vh; box-sizing: border-box; display: grid; justify-items: center; align-content: center; gap: 12px; padding: 32px; }
  h1, p { margin: 0; }
  p { opacity: .7; }
  .avatar-root { min-height: 300px; display: grid; place-items: center; }
  .realtime-panel { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 720px; align-items: center; }\n  .realtime-panel input { min-width: 280px; border: 1px solid #3b3f4a; border-radius: 999px; padding: 8px 14px; background: #1c2029; color: inherit; }\n  .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 520px; }
  button { border: 1px solid #3b3f4a; border-radius: 999px; padding: 8px 14px; background: #1c2029; color: inherit; cursor: pointer; }
  button:hover { background: #272c37; }
`;
document.head.appendChild(style);

window.addEventListener("pagehide", () => {\n  void realtimeClient?.close();\n  runtime.dispose();\n});
