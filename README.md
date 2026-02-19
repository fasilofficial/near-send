# loc-share (MVP)

Local network file sharing web app with:

- Device discovery over WebSocket
- File upload over HTTP
- Real-time sender + receiver progress
- Mobile-first UI flow for send/receive modes

## Run

```bash
npm install
npm run dev
```

Open on devices in same Wi-Fi using your machine LAN IP:

```text
http://<your-lan-ip>:3000
```

## Stack

- Next.js (frontend)
- Tailwind CSS (UI)
- Express + ws (backend)
- In-memory state for devices/transfers

## MVP Flow Implemented

1. Landing page with device name + IP
2. Receive mode registration + waiting screen
3. Send mode receiver discovery + multi-select
4. File type selector + native file picker
5. Real-time progress on sender and receiver
6. Receiver download button on completion

## Notes

- Works best on same local network
- No login, no cloud, no external transfer service
- Current transfer storage is in-memory (MVP only)
