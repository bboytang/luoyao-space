const deviceIdKey = "luoyao.referenceDeviceId.v2";

/** Stable declaration only: server authorization must bind it to a trusted principal. */
export function getOrCreateWebDeviceId(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.getItem(deviceIdKey);
  if (existing?.trim()) return existing;
  const deviceId = `web-${generate()}`;
  storage.setItem(deviceIdKey, deviceId);
  return deviceId;
}

/** Probe actual adapters before v2 hello; no microphone frames are sent or processed. */
export async function probeBrowserAudioAvailability(
  playback: { prepare(): Promise<boolean> },
): Promise<{ input: boolean; output: boolean }> {
  const output = await playback.prepare();
  if (!output || typeof AudioContext !== "function" || typeof AudioWorkletNode !== "function" ||
      typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return { input: false, output };
  }

  let input = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let worklet: AudioWorkletNode | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    context = new AudioContext({ sampleRate: 24_000 });
    await context.resume();
    if (context.state !== "running") return { input: false, output };
    await context.audioWorklet.addModule(new URL("./pcm-capture-worklet.ts", import.meta.url));
    worklet = new AudioWorkletNode(context, "luoyao-pcm-capture", {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1,
      channelCountMode: "explicit", channelInterpretation: "speakers",
      processorOptions: { frameSamples: 480 },
    });
    input = stream.getAudioTracks().some((track) => track.readyState === "live");
  } catch {
    // Permission, worklet load/construction, or device failure means input is unavailable.
  } finally {
    worklet?.port.close();
    worklet?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => {});
  }
  return { input, output };
}
