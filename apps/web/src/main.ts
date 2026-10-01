import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { DomAvatarRenderer } from "../../../runtimes/avatar/src/dom-renderer";
import { BrowserPcmCapture, BrowserPcmPlayback } from "./browser-audio";
import { RealtimeClient } from "./realtime-client";
import { AvatarLipSyncDriver } from "./avatar-lip-sync";
import { AvatarRenderLoop } from "./avatar-render-loop";
import { AppLifecycle } from "./app-lifecycle";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Luoyao Space app root is missing");

const shell = document.createElement("section");
shell.className = "luoyao-space";
const avatarRoot = document.createElement("div");
avatarRoot.className = "avatar-root";
const controls = document.createElement("div");
controls.className = "controls";

const capture = new BrowserPcmCapture();
const playback = new BrowserPcmPlayback();
let realtimeClient: RealtimeClient | undefined;

const renderer = new DomAvatarRenderer({ root: avatarRoot });
const runtime = new AvatarRuntime({ renderer });
const lipSync = new AvatarLipSyncDriver(runtime, playback);
const renderLoop = new AvatarRenderLoop(
  {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  },
  lipSync,
  () => runtime.render(),
);
renderLoop.start();

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

const realtimePanel = document.createElement("div");
realtimePanel.className = "realtime-panel";
const realtimeUrl = document.createElement("input");
realtimeUrl.type = "url";
realtimeUrl.placeholder = "wss://你的实时服务地址";
realtimeUrl.setAttribute("aria-label", "Realtime WebSocket 地址");
const realtimeStatus = document.createElement("span");
realtimeStatus.textContent = "未连接";
const connectButton = document.createElement("button");
connectButton.type = "button";
connectButton.textContent = "连接实时服务";
const listenButton = document.createElement("button");
listenButton.type = "button";
listenButton.textContent = "开始说话";
listenButton.disabled = true;
const stopButton = document.createElement("button");
stopButton.type = "button";
stopButton.textContent = "停止监听";
stopButton.disabled = true;
const abortButton = document.createElement("button");
abortButton.type = "button";
abortButton.textContent = "打断回答";
abortButton.disabled = true;
realtimePanel.append(
  realtimeUrl,
  connectButton,
  listenButton,
  stopButton,
  abortButton,
  realtimeStatus,
);

function setRealtimeUiState(state: "connecting" | "connected" | "closed"): void {
  if (state === "connecting") {
    connectButton.textContent = "连接中…";
    connectButton.disabled = true;
    listenButton.disabled = true;
    stopButton.disabled = true;
    abortButton.disabled = true;
    realtimeStatus.textContent = "连接中…";
    return;
  }

  if (state === "connected") {
    connectButton.textContent = "断开";
    connectButton.disabled = false;
    listenButton.disabled = false;
    stopButton.disabled = true;
    abortButton.disabled = false;
    realtimeStatus.textContent = "已连接";
    return;
  }

  connectButton.textContent = "连接实时服务";
  connectButton.disabled = false;
  listenButton.disabled = true;
  stopButton.disabled = true;
  abortButton.disabled = true;
  realtimeStatus.textContent = "未连接";
}

connectButton.addEventListener("click", async () => {
  if (realtimeClient) {
    await realtimeClient.close();
    realtimeClient = undefined;
    setRealtimeUiState("closed");
    return;
  }

  const url = realtimeUrl.value.trim();
  if (!url) {
    realtimeStatus.textContent = "请先填写 WebSocket 地址";
    return;
  }

  try {
    realtimeStatus.textContent = "连接中…";
    realtimeClient = new RealtimeClient({
      url,
      avatar: runtime,
      input: capture,
      output: playback,
      onStateChange: (state) => {
        setRealtimeUiState(state);
        if (state === "closed") realtimeClient = undefined;
      },
    });
    await realtimeClient.connect();
  } catch (error) {
    await realtimeClient?.close().catch(() => undefined);
    realtimeClient = undefined;
    realtimeStatus.textContent = error instanceof Error ? error.message : "连接失败";
  }
});

listenButton.addEventListener("click", async () => {
  if (!realtimeClient) return;
  try {
    await realtimeClient.startListening();
    listenButton.disabled = true;
    stopButton.disabled = false;
    abortButton.disabled = false;
    realtimeStatus.textContent = "正在倾听";
  } catch (error) {
    realtimeStatus.textContent = error instanceof Error ? error.message : "麦克风启动失败";
  }
});

stopButton.addEventListener("click", async () => {
  if (!realtimeClient) return;
  await realtimeClient.stopListening();
  listenButton.disabled = false;
  stopButton.disabled = true;
  abortButton.disabled = false;
  realtimeStatus.textContent = "已停止";
});

abortButton.addEventListener("click", async () => {
  if (!realtimeClient) return;
  abortButton.disabled = true;
  try {
    await realtimeClient.abort();
    realtimeStatus.textContent = "已打断";
  } catch (error) {
    abortButton.disabled = false;
    realtimeStatus.textContent = error instanceof Error ? error.message : "打断失败";
  }
});

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
  .realtime-panel { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 720px; align-items: center; }
  .realtime-panel input { min-width: 280px; border: 1px solid #3b3f4a; border-radius: 999px; padding: 8px 14px; background: #1c2029; color: inherit; }
  .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 520px; }
  button { border: 1px solid #3b3f4a; border-radius: 999px; padding: 8px 14px; background: #1c2029; color: inherit; cursor: pointer; }
  button:hover { background: #272c37; }
`;
document.head.appendChild(style);

const lifecycle = new AppLifecycle({
  stopRenderLoop: () => renderLoop.stop(),
  closeRealtime: async () => {
    await realtimeClient?.close();
  },
  disposeRuntime: () => runtime.dispose(),
});

window.addEventListener("pagehide", () => {
  void lifecycle.dispose().catch(() => undefined);
});
