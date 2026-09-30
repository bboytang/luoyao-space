import type { AudioFrame } from "./protocol";
import { TransportProtocolError, type TransportCodec } from "./transport";
import { jsonCodec } from "./json-codec";

const MAGIC = new Uint8Array([0x4c, 0x59, 0x41, 0x31]);
const HEADER_BYTES = 18;
const CODEC_OPUS = 1;
const CODEC_PCM_S16LE = 2;

function codecId(codec: AudioFrame["codec"]): number {
  return codec === "opus" ? CODEC_OPUS : CODEC_PCM_S16LE;
}

function codecName(id: number): AudioFrame["codec"] {
  if (id === CODEC_OPUS) return "opus";
  if (id === CODEC_PCM_S16LE) return "pcm_s16le";
  throw new TransportProtocolError("Unsupported audio codec");
}

function asUint8Array(data: Uint8Array): Uint8Array {
  return data;
}

export const binaryAudioCodec: TransportCodec = {
  decodeControl: jsonCodec.decodeControl,
  encodeControl: jsonCodec.encodeControl,

  decodeAudio(data: Uint8Array): AudioFrame {
    if (data.byteLength < HEADER_BYTES) {
      throw new TransportProtocolError("Audio frame is too short");
    }

    for (let i = 0; i < MAGIC.length; i += 1) {
      if (data[i] !== MAGIC[i]) {
        throw new TransportProtocolError("Invalid audio frame magic");
      }
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const codec = codecName(view.getUint8(4));
    const sampleRate = view.getUint32(5, false);
    const channels = view.getUint8(9);
    const sequence = view.getUint32(10, false);
    const payloadLength = view.getUint32(14, false);

    if (sampleRate <= 0 || channels <= 0 || payloadLength !== data.byteLength - HEADER_BYTES) {
      throw new TransportProtocolError("Invalid audio frame header");
    }

    return {
      kind: "audio",
      codec,
      sampleRate,
      channels,
      sequence,
      payload: data.slice(HEADER_BYTES),
    };
  },

  encodeAudio(frame: AudioFrame): Uint8Array {
    if (
      !Number.isInteger(frame.sampleRate) ||
      frame.sampleRate <= 0 ||
      !Number.isInteger(frame.channels) ||
      frame.channels <= 0 ||
      !Number.isInteger(frame.sequence) ||
      frame.sequence < 0
    ) {
      throw new TransportProtocolError("Invalid audio frame metadata");
    }

    const payload = asUint8Array(frame.payload);
    const output = new Uint8Array(HEADER_BYTES + payload.byteLength);
    output.set(MAGIC, 0);
    const view = new DataView(output.buffer);
    view.setUint8(4, codecId(frame.codec));
    view.setUint32(5, frame.sampleRate, false);
    view.setUint8(9, frame.channels);
    view.setUint32(10, frame.sequence, false);
    view.setUint32(14, payload.byteLength, false);
    output.set(payload, HEADER_BYTES);
    return output;
  },
};
