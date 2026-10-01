import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { negotiateDeviceSession, type DeviceSessionHelloV2 } from "./device-session";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import { jsonCodec } from "../../../runtimes/realtime-device/src/json-codec";
import { isControlMessage, type RealtimeControlMessage } from "../../../runtimes/realtime-device/src/protocol";
import { DeviceSessionClient } from "../../../runtimes/realtime-device/src/device-session-client";
import { MemoryRealtimeTransport } from "../../../runtimes/realtime-device/src/memory-transport";

const fixture = JSON.parse(readFileSync(new URL("./m2-wire-fixtures.json", import.meta.url), "utf8"));
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

describe("M2 cross-language wire fixtures", () => {
  it("negotiates the iOS voice and headless v2 examples exactly", () => {
    const identity = {
      principal: fixture.trustedServerContext.principal,
      authorizedDevice: fixture.trustedServerContext.authorizedDevice,
      transportSessionId: "transport-1",
      connectionId: "connection-1",
      serverCapabilities: fixture.serverCapabilities,
    };
    expect(negotiateDeviceSession(fixture.voice.hello, identity)).toEqual(fixture.voice.accepted);
    expect(jsonCodec.decodeControl(JSON.stringify(fixture.voice.accepted))).toEqual(fixture.voice.accepted);
    expect(negotiateDeviceSession(fixture.headless.hello, {
      ...identity, authorizedDevice: fixture.headless.authorizedDevice,
      transportSessionId: "transport-2",
      connectionId: "connection-2",
    })).toEqual(fixture.headless.accepted);
    expect(negotiateDeviceSession(fixture.unsupportedVersion.hello, identity)).toEqual(fixture.unsupportedVersion.rejected);
    expect(jsonCodec.decodeControl(JSON.stringify(fixture.unsupportedVersion.rejected))).toEqual(fixture.unsupportedVersion.rejected);
  });

  it("round-trips documented text controls as JSON messages", () => {
    for (const message of fixture.clientControls as RealtimeControlMessage[]) {
      expect(isControlMessage(message)).toBe(true);
      expect(JSON.parse(jsonCodec.encodeControl(message))).toEqual(message);
    }
    for (const message of fixture.serverControls) {
      expect(jsonCodec.decodeControl(JSON.stringify(message))).toEqual(message);
    }
    expect(JSON.parse(jsonCodec.encodeControl(fixture.voice.hello))).toEqual(fixture.voice.hello);
  });

  it("matches the exact PCM16 binary header and rejects malformed lengths", () => {
    const valid = fixture.binaryAudio.valid;
    expect(binaryAudioCodec.decodeAudio(fromHex(valid.hex))).toEqual({
      kind: "audio", codec: valid.codec, sampleRate: valid.sampleRateHz,
      channels: valid.channels, sequence: valid.sequence, payload: fromHex(valid.payloadHex),
    });
    expect(Buffer.from(binaryAudioCodec.encodeAudio({
      kind: "audio", codec: valid.codec, sampleRate: valid.sampleRateHz,
      channels: valid.channels, sequence: valid.sequence, payload: fromHex(valid.payloadHex),
    })).toString("hex")).toBe(valid.hex);
    for (const malformed of fixture.binaryAudio.malformed) {
      expect(() => binaryAudioCodec.decodeAudio(fromHex(malformed.hex))).toThrow();
    }
  });

  it("drives the accepted client through fixture control and playback messages", async () => {
    const transport = new MemoryRealtimeTransport();
    const played: unknown[] = [];
    let playbackIdle = false;
    const client = new DeviceSessionClient({
      transport, hello: fixture.voice.hello as DeviceSessionHelloV2,
      input: { start: async () => {}, stop: async () => {} },
      output: {
        play: async (frame) => { played.push(frame); },
        waitForIdle: async () => { playbackIdle = true; },
        stop: async () => {},
      },
    });
    const connecting = client.connect();
    await Promise.resolve();
    expect(client.getState()).toBe("awaiting_admission");
    expect(transport.sentDeviceHellos).toEqual([fixture.voice.hello]);
    await transport.receiveDeviceSession(fixture.voice.accepted);
    await connecting;
    expect(client.getState()).toBe("accepted");

    await client.startListening();
    await transport.receiveMessage(fixture.serverControls[0]);
    await transport.receiveMessage(fixture.serverControls[1]);
    await transport.receiveMessage(fixture.serverControls[2]);
    const audio = fixture.binaryAudio.valid;
    await transport.receiveAudio(binaryAudioCodec.decodeAudio(fromHex(audio.hex)));
    await transport.receiveMessage(fixture.serverControls[3]);
    expect(played).toHaveLength(1);
    expect(playbackIdle).toBe(true);

    const interrupt = client.interruptResponse();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(transport.sentMessages).toEqual(fixture.clientControls.slice(0, 2));
    await transport.receiveMessage(fixture.serverControls[5]);
    await interrupt;
    await client.stopListening();
    await client.abort();
    expect(transport.sentMessages).toEqual(fixture.clientControls);
    await client.close();
  });

  it("surfaces the fixture machine-readable rejection before becoming operational", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({
      transport, hello: fixture.unsupportedVersion.hello as DeviceSessionHelloV2,
    });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(fixture.unsupportedVersion.rejected);
    await expect(connecting).rejects.toMatchObject({ reason: "unsupported_version", supportedVersions: [2] });
    expect(client.getState()).toBe("rejected");
    await expect(client.startListening()).rejects.toThrow(/not accepted/);
  });

  it("treats disconnect as termination and reconnect as a new transport session", async () => {
    const firstTransport = new MemoryRealtimeTransport();
    const first = new DeviceSessionClient({ transport: firstTransport, hello: fixture.headless.hello as DeviceSessionHelloV2 });
    const firstConnect = first.connect();
    await Promise.resolve();
    await firstTransport.receiveDeviceSession(fixture.headless.accepted);
    expect((await firstConnect).transportSessionId).toBe(fixture.headless.accepted.transportSessionId);
    await firstTransport.close();
    expect(first.getState()).toBe("terminated");
    await expect(first.connect()).rejects.toThrow(/new client/);

    const secondTransport = new MemoryRealtimeTransport();
    const second = new DeviceSessionClient({ transport: secondTransport, hello: fixture.headless.hello as DeviceSessionHelloV2 });
    const secondConnect = second.connect();
    await Promise.resolve();
    await secondTransport.receiveDeviceSession(fixture.reconnect.accepted);
    expect((await secondConnect).transportSessionId).toBe(fixture.reconnect.accepted.transportSessionId);
    expect(fixture.reconnect.accepted.transportSessionId).not.toBe(fixture.headless.accepted.transportSessionId);
    await second.close();
  });
});
