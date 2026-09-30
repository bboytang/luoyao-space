import { WebSocketServer, type WebSocket } from "ws";
import { RealtimeSessionService } from "./session-service";
import { WebSocketSessionConnection } from "./websocket-session-connection";
import { createDemoRealtimePipeline } from "./demo-pipeline";

const port = Number(process.env.REALTIME_PORT ?? 8787);
const host = process.env.REALTIME_HOST ?? "127.0.0.1";

const server = new WebSocketServer({ host, port });

server.on("connection", (socket: WebSocket) => {
  const connection = new WebSocketSessionConnection(socket);
  new RealtimeSessionService(connection, createDemoRealtimePipeline());
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
