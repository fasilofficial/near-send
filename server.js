const http = require("http");
const os = require("os");
const express = require("express");
const next = require("next");
const multer = require("multer");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = Number(process.env.PORT || 3000);
const CHUNK_SIZE = 64 * 1024;

const devices = new Map();
const socketToDeviceId = new Map();
const transfers = new Map();

function getLocalIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  const ip = req.socket.remoteAddress || "";
  const lanIp = getServerLanIp();

  if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
    return lanIp || "127.0.0.1";
  }

  if (ip.startsWith("::ffff:")) {
    return ip.replace("::ffff:", "");
  }

  return ip || lanIp || "0.0.0.0";
}

function getServerLanIp() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return "";
}

function getReceiverList() {
  return [...devices.values()]
    .filter(
      (device) =>
        device.mode === "receive" &&
        device.status === "available" &&
        device.socket.readyState === 1,
    )
    .map((device) => ({
      id: device.id,
      name: device.name,
      ip: device.ip,
      status: device.status,
    }));
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function broadcastDeviceUpdate() {
  const receivers = getReceiverList();
  for (const device of devices.values()) {
    sendJson(device.socket, {
      type: "devices_update",
      receivers,
    });
  }
}

function parseReceiverIds(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean);
    }
  } catch (_) {
    return String(value)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
}

async function streamToReceivers({ transfer, senderSocket }) {
  const totalSize = transfer.size;

  for (const receiverId of transfer.receivers) {
    const receiverDevice = devices.get(receiverId);
    const receiverSocket = receiverDevice?.socket;

    if (!receiverSocket || receiverSocket.readyState !== 1) {
      transfer.receiverStatus[receiverId] = "offline";
      sendJson(senderSocket, {
        type: "transfer_receiver_status",
        transferId: transfer.id,
        receiverId,
        status: "offline",
      });
      continue;
    }

    sendJson(receiverSocket, {
      type: "transfer_receive_start",
      transferId: transfer.id,
      fileName: transfer.fileName,
      mimeType: transfer.mimeType,
      size: transfer.size,
      sender: transfer.senderName,
      senderId: transfer.senderId,
      receiverId,
    });

    let sentBytes = 0;
    for (
      let offset = 0;
      offset < transfer.buffer.length;
      offset += CHUNK_SIZE
    ) {
      const chunk = transfer.buffer.subarray(
        offset,
        Math.min(offset + CHUNK_SIZE, transfer.buffer.length),
      );
      sentBytes += chunk.length;

      sendJson(receiverSocket, {
        type: "transfer_receive_chunk",
        transferId: transfer.id,
        receiverId,
        chunk: chunk.toString("base64"),
        progress: Math.round((sentBytes / totalSize) * 100),
        chunkSize: chunk.length,
      });

      await new Promise((resolve) => setTimeout(resolve, 4));
    }

    transfer.receiverStatus[receiverId] = "completed";

    sendJson(receiverSocket, {
      type: "transfer_receive_complete",
      transferId: transfer.id,
      receiverId,
      fileName: transfer.fileName,
    });

    sendJson(senderSocket, {
      type: "transfer_receiver_status",
      transferId: transfer.id,
      receiverId,
      status: "completed",
    });
  }

  transfer.status = "completed";

  sendJson(senderSocket, {
    type: "transfer_complete",
    transferId: transfer.id,
    status: "completed",
  });
}

app.prepare().then(() => {
  const expressApp = express();
  expressApp.use(express.json());

  expressApp.get("/api/me", (req, res) => {
    res.json({
      ip: getLocalIp(req),
    });
  });

  expressApp.post("/api/upload", upload.single("file"), async (req, res) => {
    const senderId = String(req.body.senderId || "");
    const receiverIds = parseReceiverIds(req.body.receiverIds);
    const senderDevice = devices.get(senderId);
    const senderSocket = senderDevice?.socket;

    if (!req.file) {
      res.status(400).json({ error: "Missing file payload." });
      return;
    }

    if (
      !senderId ||
      !senderDevice ||
      !senderSocket ||
      senderSocket.readyState !== 1
    ) {
      res
        .status(400)
        .json({ error: "Sender is not connected over WebSocket." });
      return;
    }

    if (receiverIds.length === 0) {
      res
        .status(400)
        .json({ error: "At least one receiver must be selected." });
      return;
    }

    const transferId = randomUUID();

    const transfer = {
      id: transferId,
      senderId,
      senderName: senderDevice.name,
      receivers: receiverIds,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || "application/octet-stream",
      size: req.file.size,
      progress: 0,
      status: "upload-complete",
      buffer: req.file.buffer,
      receiverStatus: Object.fromEntries(
        receiverIds.map((id) => [id, "pending"]),
      ),
      receiverAckBytes: Object.fromEntries(receiverIds.map((id) => [id, 0])),
    };

    transfers.set(transferId, transfer);

    sendJson(senderSocket, {
      type: "transfer_registered",
      transferId,
      fileName: transfer.fileName,
      size: transfer.size,
      receivers: receiverIds,
    });

    res.json({
      transferId,
      fileName: transfer.fileName,
      size: transfer.size,
      status: transfer.status,
    });

    streamToReceivers({ transfer, senderSocket }).catch((error) => {
      sendJson(senderSocket, {
        type: "transfer_error",
        transferId,
        message: error.message,
      });
    });
  });

  expressApp.all("*", (req, res) => handle(req, res));

  const server = http.createServer(expressApp);

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket, req) => {
    const ip = getLocalIp(req);

    sendJson(socket, {
      type: "welcome",
      ip,
    });

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }

      if (message.type === "register_device") {
        const id = String(message.id || randomUUID());
        const current = devices.get(id);

        if (current && current.socket !== socket) {
          current.socket.close();
        }

        devices.set(id, {
          id,
          name: String(message.name || "Unnamed Device"),
          mode: message.mode === "receive" ? "receive" : "idle",
          ip,
          status: "available",
          socket,
          lastSeenAt: Date.now(),
        });

        socketToDeviceId.set(socket, id);

        sendJson(socket, {
          type: "device_registered",
          id,
          ip,
        });

        broadcastDeviceUpdate();
        return;
      }

      const deviceId = socketToDeviceId.get(socket);
      if (!deviceId) {
        return;
      }

      const device = devices.get(deviceId);
      if (!device) {
        return;
      }

      if (message.type === "set_mode") {
        device.mode = message.mode === "receive" ? "receive" : "idle";
        device.lastSeenAt = Date.now();
        broadcastDeviceUpdate();
      }

      if (message.type === "request_receivers") {
        sendJson(socket, {
          type: "devices_update",
          receivers: getReceiverList(),
        });
      }

      if (message.type === "update_name") {
        device.name = String(message.name || device.name);
        device.lastSeenAt = Date.now();
        broadcastDeviceUpdate();
      }

      if (message.type === "heartbeat") {
        device.lastSeenAt = Date.now();
      }

      if (message.type === "transfer_chunk_ack") {
        const transfer = transfers.get(String(message.transferId || ""));
        if (!transfer || !transfer.receivers.includes(deviceId)) {
          return;
        }

        const chunkSize = Number(message.chunkSize || 0);
        if (chunkSize <= 0) {
          return;
        }

        const currentAck = Number(transfer.receiverAckBytes[deviceId] || 0);
        const nextAck = Math.min(currentAck + chunkSize, transfer.size);
        transfer.receiverAckBytes[deviceId] = nextAck;

        const receiverProgress =
          transfer.size === 0
            ? 100
            : Math.round((nextAck / transfer.size) * 100);
        const totalAckBytes = transfer.receivers.reduce(
          (sum, receiverId) =>
            sum + Number(transfer.receiverAckBytes[receiverId] || 0),
          0,
        );
        const fullTargetBytes = transfer.size * transfer.receivers.length;
        const aggregateProgress =
          fullTargetBytes === 0
            ? 100
            : Math.round((totalAckBytes / fullTargetBytes) * 100);

        const senderSocketRef = devices.get(transfer.senderId)?.socket;
        sendJson(senderSocketRef, {
          type: "transfer_delivery_progress",
          transferId: transfer.id,
          receiverId: deviceId,
          receiverProgress,
          aggregateProgress,
        });
      }
    });

    socket.on("close", () => {
      const deviceId = socketToDeviceId.get(socket);
      socketToDeviceId.delete(socket);
      if (!deviceId) {
        return;
      }

      devices.delete(deviceId);
      broadcastDeviceUpdate();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = request.url || "";

    if (!requestUrl.startsWith("/ws")) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientSocket) => {
      wss.emit("connection", clientSocket, request);
    });
  });

  setInterval(() => {
    const now = Date.now();
    let changed = false;

    for (const [id, device] of devices.entries()) {
      const stale = now - device.lastSeenAt > 20_000;
      if (stale || device.socket.readyState !== 1) {
        devices.delete(id);
        changed = true;
      }
    }

    if (changed) {
      broadcastDeviceUpdate();
    }
  }, 10_000);

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`loc-share listening on http://localhost:${PORT}`);
  });
});
