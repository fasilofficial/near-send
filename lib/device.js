export function getOrCreateDeviceId() {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.localStorage.getItem('locshare-device-id');
  if (existing) {
    return existing;
  }

  const id = createDeviceId();
  window.localStorage.setItem('locshare-device-id', id);
  return id;
}

function createDeviceId() {
  const cryptoObj = window.crypto || window.msCrypto;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateDeviceName() {
  if (typeof window === 'undefined') {
    return 'Web Device';
  }

  const existing = window.localStorage.getItem('locshare-device-name');
  if (existing) {
    return existing;
  }

  const platform = navigator.platform || 'Device';
  const randomSuffix = Math.floor(Math.random() * 900 + 100);
  const name = `${platform}-${randomSuffix}`;
  window.localStorage.setItem('locshare-device-name', name);
  return name;
}

export function persistDeviceName(name) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem('locshare-device-name', name);
}
