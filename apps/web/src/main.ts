import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { DomAvatarRenderer } from "../../../runtimes/avatar/src/dom-renderer";
import { BrowserPcmCapture, BrowserPcmPlayback } from "./browser-audio";
import { RealtimeClient, type RealtimeClientState } from "./realtime-client";
import { getOrCreateWebDeviceId, probeBrowserAudioAvailability } from "./web-device";
import { AvatarLipSyncDriver } from "./avatar-lip-sync";
import { AvatarRenderLoop } from "./avatar-render-loop";
import { AppLifecycle } from "./app-lifecycle";
import { PcmVoiceActivityDetector } from "../../../runtimes/realtime-device/src/voice-activity";
import { RealtimeBargeInController } from "./realtime-barge-in";
import { RealtimeBargeInInput } from "./realtime-barge-in-input";

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
let cleanupPromise: Promise<void> | undefined;
let sessionGeneration = 0;
let pageDisposed = false;

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
const deviceIdentity = document.createElement("span");
deviceIdentity.className = "device-identity";

const bargeInDetector = new PcmVoiceActivityDetector();
const bargeInController = new RealtimeBargeInController(
  bargeInDetector,
  {
    isResponseActive: () => !!realtimeClient?.canUseVoice() &&
      ((realtimeClient.canUseAvatar() && runtime.getState().speaking) || playback.isPlaying()),
    interruptResponse: async () => {
      await realtimeClient?.interruptResponse();
    },
  },
  {
    onInterruptError: (error) => {
      realtimeStatus.textContent =
        error instanceof Error ? error.message : "自动打断失败";
    },
  },
);
const realtimeInput = new RealtimeBargeInInput(capture, bargeInController);
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
try {
  deviceIdentity.textContent = `参考设备 ID: ${getOrCreateWebDeviceId()}`;
} catch {
  deviceIdentity.textContent = "无法持久保存参考设备 ID；实时连接不可用";
  connectButton.disabled = true;
}
realtimePanel.append(
  realtimeUrl,
  connectButton,
  listenButton,
  stopButton,
  abortButton,
  realtimeStatus,
  deviceIdentity,
);

function setRealtimeUiState(state: RealtimeClientState | "probing" | "cleanup", voiceAvailable = false): void {
  if (state === "probing" || state === "cleanup" || state === "transport_connecting" || state === "awaiting_admission") {
    connectButton.textContent = state === "awaiting_admission" ? "等待设备接入…" : "连接中…";
    connectButton.disabled = true;
    listenButton.disabled = true;
    stopButton.disabled = true;
    abortButton.disabled = true;
    realtimeStatus.textContent = state === "cleanup" ? "正在结束设备会话…" :
      state === "probing" ? "正在检查设备能力…" :
      state === "awaiting_admission" ? "等待服务端接入确认…" : "连接中…";
    return;
  }

  if (state === "accepted") {
    connectButton.textContent = "断开";
    connectButton.disabled = false;
    listenButton.disabled = !voiceAvailable;
    stopButton.disabled = true;
    abortButton.disabled = !voiceAvailable;
    realtimeStatus.textContent = voiceAvailable ? "设备已接入，实时语音可用" : "设备已接入，实时语音未协商";
    return;
  }

  connectButton.textContent = "连接实时服务";
  connectButton.disabled = false;
  listenButton.disabled = true;
  stopButton.disabled = true;
  abortButton.disabled = true;
  realtimeStatus.textContent = state === "rejected" ? "设备接入被拒绝" : "未连接";
}

function endSession(client: RealtimeClient): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  setRealtimeUiState("cleanup");
  // Defer the first close so a synchronous state callback cannot race assignment.
  cleanupPromise = Promise.resolve().then(async () => {
    await client.close().catch(() => {});
    await realtimeInput.stop().catch(() => {});
    await playback.stop().catch(() => {});
  }).finally(() => {
    if (realtimeClient === client) realtimeClient = undefined;
    cleanupPromise = undefined;
    setRealtimeUiState("terminated");
  });
  return cleanupPromise;
}

connectButton.addEventListener("click", async () => {
  if (pageDisposed || cleanupPromise) return;
  if (realtimeClient) {
    await endSession(realtimeClient);
    return;
  }

  const url = realtimeUrl.value.trim();
  if (!url) {
    realtimeStatus.textContent = "请先填写 WebSocket 地址";
    return;
  }

  let candidate: RealtimeClient | undefined;
  const generation = ++sessionGeneration;
  try {
    setRealtimeUiState("probing");
    const deviceId = getOrCreateWebDeviceId();
    deviceIdentity.textContent = `参考设备 ID: ${deviceId}`;
    const availableAudio = await probeBrowserAudioAvailability(playback);
    if (pageDisposed) {
      await playback.stop().catch(() => {});
      return;
    }
    const outputSupported = typeof AudioContext === "function";
    const inputSupported = outputSupported && typeof AudioWorkletNode === "function" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    candidate = new RealtimeClient({
      url,
      deviceId,
      availableAudio,
      avatar: runtime,
      input: inputSupported ? realtimeInput : undefined,
      output: outputSupported ? playback : undefined,
      onStateChange: (state) => {
        if (generation !== sessionGeneration) return;
        if ((state === "terminated" || state === "rejected") && candidate) {
          void endSession(candidate);
          return;
        }
        setRealtimeUiState(state);
      },
    });
    realtimeClient = candidate;
    await candidate.connect();
    if (generation !== sessionGeneration || realtimeClient !== candidate || !candidate.isOperational()) return;
    if (!candidate.canUseVoice()) await playback.stop();
    if (generation !== sessionGeneration || realtimeClient !== candidate || !candidate.isOperational()) return;
    setRealtimeUiState("accepted", candidate.canUseVoice());
  } catch (error) {
    if (candidate) await endSession(candidate);
    else {
      await playback.stop().catch(() => {});
      setRealtimeUiState("terminated");
    }
    if (generation !== sessionGeneration) return;
    realtimeStatus.textContent = error instanceof Error ? error.message : "连接失败";
  }
});

listenButton.addEventListener("click", async () => {
  const client = realtimeClient;
  const generation = sessionGeneration;
  if (!client || !client.isOperational()) return;
  try {
    await client.startListening();
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
    listenButton.disabled = true;
    stopButton.disabled = false;
    abortButton.disabled = false;
    realtimeStatus.textContent = "正在倾听";
  } catch (error) {
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
    realtimeStatus.textContent = error instanceof Error ? error.message : "麦克风启动失败";
  }
});

stopButton.addEventListener("click", async () => {
  const client = realtimeClient;
  const generation = sessionGeneration;
  if (!client || !client.isOperational()) return;
  try {
    await client.stopListening();
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
    listenButton.disabled = false;
    stopButton.disabled = true;
    abortButton.disabled = false;
    realtimeStatus.textContent = "已停止";
  } catch (error) {
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
    realtimeStatus.textContent = error instanceof Error ? error.message : "停止监听失败";
  }
});

abortButton.addEventListener("click", async () => {
  const client = realtimeClient;
  const generation = sessionGeneration;
  if (!client || !client.isOperational()) return;
  abortButton.disabled = true;
  try {
    await client.interruptResponse();
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
    realtimeStatus.textContent = "已打断";
  } catch (error) {
    if (generation !== sessionGeneration || realtimeClient !== client || !client.isOperational()) return;
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
  .device-identity { flex-basis: 100%; text-align: center; overflow-wrap: anywhere; font-size: 12px; opacity: .7; }
  .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 520px; }
  button { border: 1px solid #3b3f4a; border-radius: 999px; padding: 8px 14px; background: #1c2029; color: inherit; cursor: pointer; }
  button:hover { background: #272c37; }
`;
document.head.appendChild(style);

const lifecycle = new AppLifecycle({
  stopRenderLoop: () => renderLoop.stop(),
  closeRealtime: async () => {
    if (realtimeClient) await endSession(realtimeClient);
    else await cleanupPromise;
  },
  disposeRuntime: () => runtime.dispose(),
});

window.addEventListener("pagehide", () => {
  pageDisposed = true;
  sessionGeneration += 1;
  void lifecycle.dispose().catch(() => undefined);
});
