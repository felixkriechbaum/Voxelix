/** Little-endian, platform-independent (de)serialization for voxel chunk arrays. */

export function u16ToBase64(arr: Uint16Array): string {
  const bytes = new Uint8Array(arr.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < arr.length; i++) view.setUint16(i * 2, arr[i], true);
  return bytesToBase64(bytes);
}

export function base64ToU16(b64: string): Uint16Array {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint16Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
