export function webpBytes(...payload: number[]): ArrayBuffer {
  const header = [..."RIFF"].map((char) => char.charCodeAt(0));
  const size = [payload.length + 4, 0, 0, 0];
  const format = [..."WEBP"].map((char) => char.charCodeAt(0));
  return new Uint8Array([...header, ...size, ...format, ...payload]).buffer;
}
