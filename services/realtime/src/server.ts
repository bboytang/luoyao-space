import { WebSocketServer, type WebSocket } from "ws";
import { InMemoryDeviceSessionOwnership } from "../../device-runtime/src/session-boundary";
import { attachRealtimeConnection } from "./connection-factory";
import { createRealtimePipeline, createDefaultRealtimeProviderFactories } from "./provider-registry";
import { loadRealtimeConfig } from "./config";

const config = loadRealtimeConfig();
const port = config.port;
const host = config.host;

const factories = createDefaultRealtimeProviderFactories();
const pipelineConfig = {
  vad: { provider: config.providers.vad },
  asr: { provider: config.providers.asr },
  llm: {
    provider: config.providers.llm,
    options: config.openai,
  },
  tts: { provider: config.providers.tts },
};
const pipeline = createRealtimePipeline(pipelineConfig, factories);
const ownership = new InMemoryDeviceSessionOwnership();

const server = new WebSocketServer({ host, port });

server.on("connection", (socket: WebSocket, request) => {
  attachRealtimeConnection(socket, request, pipeline, config, ownership);
});

server.on("listening", () => {
  console.log(`Luoyao realtime server listening on ws://${host}:${port}`);
});

server.on("error", (error) => {
  console.error("Realtime server error", error);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
