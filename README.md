# NearSend (loc-share) MVP

Local network file sharing web app for phones, tablets, and desktops.

No login. No cloud. No external transfer server.

## Features

- Device discovery on local network via WebSocket
- Receive mode / Send mode workflow
- Multi-device receiver selection
- Native file picker (files, images, videos)
- Real-time progress on sender and receiver
- Receiver-side download after transfer
- Mobile-first responsive UI

## Tech Stack

- Frontend: Next.js + React + Tailwind CSS
- Backend: Express + `ws`
- Transfer model:
  - Control channel: WebSocket (`/ws`)
  - File upload: HTTP (`/api/upload`)
  - Delivery progress: receiver chunk acknowledgements over WebSocket
- Storage: in-memory device + transfer state (MVP)

## Project Structure

```text
.
├── lib/
│   └── device.js
├── pages/
│   ├── _app.js
│   └── index.js
├── styles/
│   └── globals.css
├── server.js
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run development server

```bash
npm run dev
```

### 3. Open from devices on same Wi-Fi

Use your laptop LAN IP as host (example):

```text
http://192.168.1.117:3000
```

Important: open the same host URL on all devices.  
Do not use `localhost` on one device and LAN IP on another.

## User Flow (MVP)

1. Landing page shows device name + IP
2. Receiver enters **Receive Files** mode
3. Sender opens **Send Files** and selects available receivers
4. Sender chooses file type and picks file
5. Sender uploads file, server relays chunks, receiver acknowledges chunks
6. Both sides show live progress and completion

## API / Socket Events (MVP)

### HTTP

- `GET /api/me` -> returns detected IP
- `POST /api/upload` -> upload file with:
  - `file`
  - `senderId`
  - `receiverIds` (JSON array)

### WebSocket (`/ws`)

- Client -> server:
  - `register_device`
  - `set_mode`
  - `request_receivers`
  - `update_name`
  - `heartbeat`
  - `transfer_chunk_ack`
- Server -> client:
  - `welcome`
  - `device_registered`
  - `devices_update`
  - `transfer_registered`
  - `transfer_receive_start`
  - `transfer_receive_chunk`
  - `transfer_receive_complete`
  - `transfer_delivery_progress`
  - `transfer_receiver_status`
  - `transfer_complete`
  - `transfer_error`

## MVP Limitations

- In-memory only (state resets on restart)
- No encryption yet
- No resume/retry yet
- No folder transfer yet
- Not optimized for very large files yet

## Troubleshooting

- Devices not visible:
  - Ensure both are on same Wi-Fi
  - Ensure receiver is in **Receive Files** mode
  - Open the same LAN host URL on both devices
- Laptop shows loopback IP:
  - App resolves loopback to LAN IPv4 automatically; restart server if stale
- WebSocket errors in dev:
  - App socket uses `/ws` to avoid Next.js HMR socket collision

## Roadmap (Post-MVP)

- WebRTC peer-to-peer transfer
- Encryption
- QR connect
- Transfer history
- PWA install support
