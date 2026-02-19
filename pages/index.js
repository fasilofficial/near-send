import { useEffect, useMemo, useRef, useState } from "react";
import {
  getOrCreateDeviceId,
  getOrCreateDeviceName,
  persistDeviceName,
} from "@/lib/device";

const EMPTY_UPLOAD_STATE = {
  status: "idle",
  fileName: "",
  progress: 0,
  aggregateProgress: 0,
  receiverProgress: {},
  transferId: "",
  error: "",
};

function buildWsUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function formatBytes(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeBase64Chunk(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function HomePage() {
  const wsRef = useRef(null);
  const receiveBuffersRef = useRef({});
  const transferMetaRef = useRef({});
  const latestViewRef = useRef("landing");
  const latestDeviceNameRef = useRef("");

  const [connected, setConnected] = useState(false);
  const [ip, setIp] = useState("0.0.0.0");
  const [deviceId, setDeviceId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [view, setView] = useState("landing");
  const [receivers, setReceivers] = useState([]);
  const [selectedReceiverIds, setSelectedReceiverIds] = useState([]);
  const [pickerKind, setPickerKind] = useState("files");
  const [file, setFile] = useState(null);
  const [uploadState, setUploadState] = useState(EMPTY_UPLOAD_STATE);
  const [incomingTransfers, setIncomingTransfers] = useState({});

  useEffect(() => {
    latestViewRef.current = view;
  }, [view]);

  useEffect(() => {
    latestDeviceNameRef.current = deviceName;
  }, [deviceName]);

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
    setDeviceName(getOrCreateDeviceName());

    fetch("/api/me")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ip) {
          setIp(data.ip);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!deviceId || !deviceName) {
      return undefined;
    }

    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: "register_device",
          id: deviceId,
          name: latestDeviceNameRef.current || deviceName,
          mode: latestViewRef.current === "receive" ? "receive" : "idle",
        }),
      );
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.type === "welcome" && payload.ip) {
        setIp(payload.ip);
      }

      if (payload.type === "devices_update") {
        setReceivers(payload.receivers || []);
      }

      if (payload.type === "transfer_registered") {
        setUploadState((prev) => ({
          ...prev,
          transferId: payload.transferId,
          status: prev.status === "uploading" ? "uploading" : prev.status,
        }));
      }

      if (payload.type === "transfer_delivery_progress") {
        setUploadState((prev) => ({
          ...prev,
          status: "delivering",
          receiverProgress: {
            ...prev.receiverProgress,
            [payload.receiverId]: payload.receiverProgress,
          },
          aggregateProgress: payload.aggregateProgress,
        }));
      }

      if (payload.type === "transfer_receiver_status") {
        if (payload.status === "offline") {
          setUploadState((prev) => ({
            ...prev,
            error: "A selected receiver went offline during transfer.",
          }));
        }
      }

      if (payload.type === "transfer_complete") {
        setUploadState((prev) => ({
          ...prev,
          status: "completed",
          progress: 100,
          aggregateProgress: 100,
        }));
      }

      if (payload.type === "transfer_error") {
        setUploadState((prev) => ({
          ...prev,
          status: "error",
          error: payload.message || "Transfer failed.",
        }));
      }

      if (payload.type === "transfer_receive_start") {
        receiveBuffersRef.current[payload.transferId] = [];
        transferMetaRef.current[payload.transferId] = {
          mimeType: payload.mimeType,
        };

        setIncomingTransfers((prev) => ({
          ...prev,
          [payload.transferId]: {
            transferId: payload.transferId,
            fileName: payload.fileName,
            sender: payload.sender,
            size: payload.size,
            mimeType: payload.mimeType,
            progress: 0,
            status: "receiving",
            downloadUrl: "",
          },
        }));
      }

      if (payload.type === "transfer_receive_chunk") {
        const chunkBytes = decodeBase64Chunk(payload.chunk);
        const chunks = receiveBuffersRef.current[payload.transferId] || [];
        chunks.push(chunkBytes);
        receiveBuffersRef.current[payload.transferId] = chunks;

        setIncomingTransfers((prev) => ({
          ...prev,
          [payload.transferId]: {
            ...prev[payload.transferId],
            progress: payload.progress,
            status: "receiving",
          },
        }));

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "transfer_chunk_ack",
              transferId: payload.transferId,
              chunkSize: chunkBytes.byteLength,
            }),
          );
        }
      }

      if (payload.type === "transfer_receive_complete") {
        const chunks = receiveBuffersRef.current[payload.transferId] || [];
        const transfer = transferMetaRef.current[payload.transferId];
        const blob = new Blob(chunks, {
          type: transfer?.mimeType || "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);

        setIncomingTransfers((prev) => ({
          ...prev,
          [payload.transferId]: {
            ...prev[payload.transferId],
            progress: 100,
            status: "completed",
            downloadUrl: url,
          },
        }));
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 5000);

    return () => {
      clearInterval(heartbeat);
      ws.close();
    };
  }, [deviceId]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: "set_mode",
        mode: view === "receive" ? "receive" : "idle",
      }),
    );

    if (view === "send" || view === "send-file") {
      ws.send(JSON.stringify({ type: "request_receivers" }));
    }
  }, [view, connected]);

  const selectedReceivers = useMemo(
    () =>
      receivers.filter((receiver) => selectedReceiverIds.includes(receiver.id)),
    [receivers, selectedReceiverIds],
  );

  function updateName(nextName) {
    setDeviceName(nextName);
    persistDeviceName(nextName);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "update_name",
          name: nextName,
        }),
      );
    }
  }

  function toggleReceiver(id) {
    setSelectedReceiverIds((prev) =>
      prev.includes(id)
        ? prev.filter((receiverId) => receiverId !== id)
        : [...prev, id],
    );
  }

  function fileAcceptValue() {
    if (pickerKind === "images") {
      return "image/*";
    }
    if (pickerKind === "videos") {
      return "video/*";
    }
    return "*";
  }

  async function sendFile() {
    if (!file || selectedReceiverIds.length === 0) {
      return;
    }

    setUploadState({
      ...EMPTY_UPLOAD_STATE,
      status: "uploading",
      fileName: file.name,
    });

    const form = new FormData();
    form.append("file", file);
    form.append("senderId", deviceId);
    form.append("receiverIds", JSON.stringify(selectedReceiverIds));

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }

        const progress = Math.round((event.loaded / event.total) * 100);

        setUploadState((prev) => ({
          ...prev,
          status: "uploading",
          progress,
        }));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadState((prev) => ({
            ...prev,
            status: "delivering",
            progress: 100,
          }));
        } else {
          let message = "Upload failed.";
          try {
            message = JSON.parse(xhr.responseText).error || message;
          } catch (_) {
            // No-op.
          }

          setUploadState((prev) => ({
            ...prev,
            status: "error",
            error: message,
          }));
        }

        resolve();
      };

      xhr.onerror = () => {
        setUploadState((prev) => ({
          ...prev,
          status: "error",
          error: "Network error while uploading.",
        }));
        resolve();
      };

      xhr.send(form);
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_-10%,#bff4e8_0%,#effaf7_36%,#f8fafc_70%)] px-4 py-8 text-slate-900">
      <section className="mx-auto w-full max-w-md rounded-3xl bg-white/95 p-6 shadow-card ring-1 ring-slate-100 backdrop-blur">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
            NearSend
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Local File Share
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Fast transfer on the same Wi-Fi
          </p>
        </div>

        <div className="mb-6 space-y-2 rounded-2xl bg-slate-50 p-4">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Device
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            value={deviceName}
            onChange={(event) => updateName(event.target.value)}
          />
          {/* <p className="text-xs text-slate-500">IP: {ip}</p> */}
          <p className="text-xs text-slate-500">
            Status: {connected ? "Connected" : "Connecting..."}
          </p>
        </div>

        {view === "landing" && (
          <div className="space-y-3">
            <button className="primary-btn" onClick={() => setView("send")}>
              Send Files
            </button>
            <button
              className="secondary-btn"
              onClick={() => setView("receive")}
            >
              Receive Files
            </button>
          </div>
        )}

        {view === "receive" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm">
              <p className="font-semibold text-brand-700">
                Receiving Mode Enabled
              </p>
              <p className="mt-2 text-slate-700">
                Waiting for incoming files...
              </p>
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {Object.values(incomingTransfers).length === 0 && (
                <p className="text-sm text-slate-500">
                  No incoming transfers yet.
                </p>
              )}

              {Object.values(incomingTransfers).map((transfer) => (
                <article
                  key={transfer.transferId}
                  className="rounded-2xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-semibold">
                    Receiving from: {transfer.sender}
                  </p>
                  <p className="text-sm text-slate-600">{transfer.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(transfer.size || 0)}
                  </p>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-brand-500"
                      style={{ width: `${transfer.progress || 0}%` }}
                    />
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    {transfer.progress || 0}%
                  </p>

                  {transfer.status === "completed" && transfer.downloadUrl && (
                    <a
                      href={transfer.downloadUrl}
                      download={transfer.fileName}
                      className="mt-2 inline-flex rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Download
                    </a>
                  )}
                </article>
              ))}
            </div>

            <button
              className="secondary-btn"
              onClick={() => setView("landing")}
            >
              Back
            </button>
          </div>
        )}

        {view === "send" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Available Devices</h2>

            <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
              {receivers.length === 0 && (
                <p className="text-sm text-slate-500">No receivers found.</p>
              )}

              {receivers.map((receiver) => (
                <label
                  key={receiver.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedReceiverIds.includes(receiver.id)}
                      onChange={() => toggleReceiver(receiver.id)}
                    />
                    <span className="text-sm">{receiver.name}</span>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Ready
                  </span>
                </label>
              ))}
            </div>

            <button
              className="primary-btn disabled:cursor-not-allowed disabled:opacity-50"
              disabled={selectedReceiverIds.length === 0}
              onClick={() => setView("send-file")}
            >
              Next
            </button>

            <button
              className="secondary-btn"
              onClick={() => setView("landing")}
            >
              Back
            </button>
          </div>
        )}

        {view === "send-file" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Select File Type</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                className={`chip ${pickerKind === "files" ? "chip-active" : ""}`}
                onClick={() => setPickerKind("files")}
              >
                Files
              </button>
              <button
                className={`chip ${pickerKind === "images" ? "chip-active" : ""}`}
                onClick={() => setPickerKind("images")}
              >
                Images
              </button>
              <button
                className={`chip ${pickerKind === "videos" ? "chip-active" : ""}`}
                onClick={() => setPickerKind("videos")}
              >
                Videos
              </button>
            </div>

            <label className="secondary-btn cursor-pointer text-center">
              Browse Files
              <input
                type="file"
                className="hidden"
                accept={fileAcceptValue()}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>

            {file && (
              <div className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(file.size)}
                </p>
                <p className="text-xs text-slate-500">
                  To: {selectedReceivers.map((d) => d.name).join(", ")}
                </p>
              </div>
            )}

            <button
              className="primary-btn disabled:cursor-not-allowed disabled:opacity-50"
              onClick={sendFile}
              disabled={!file}
            >
              Send
            </button>

            {uploadState.status !== "idle" && (
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-sm font-semibold">{uploadState.fileName}</p>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Upload to server
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-slate-500"
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {uploadState.progress}%
                </p>

                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Delivery to receivers
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-brand-500"
                    style={{ width: `${uploadState.aggregateProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {uploadState.aggregateProgress}%
                </p>

                {selectedReceivers.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {selectedReceivers.map((receiver) => (
                      <p key={receiver.id} className="text-xs text-slate-600">
                        {receiver.name}:{" "}
                        {uploadState.receiverProgress[receiver.id] || 0}%
                      </p>
                    ))}
                  </div>
                )}

                <p className="mt-1 text-xs text-slate-600">
                  {uploadState.status === "uploading" && "Uploading file..."}
                  {uploadState.status === "delivering" &&
                    "Delivering to selected devices..."}
                  {uploadState.status === "completed" &&
                    "File sent successfully"}
                  {uploadState.status === "error" && uploadState.error}
                </p>
              </div>
            )}

            <button className="secondary-btn" onClick={() => setView("send")}>
              Back
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
