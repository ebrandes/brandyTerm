// JSON with binary data: typed arrays travel as `{ "$b64": "..." }` at any depth. Pure (browser-safe).
import { fromB64, toB64 } from './crypto.ts'

const TAG = '$b64'

export function stringifyBinary(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    // toJSON (Buffer) already ran when the replacer sees `v`: look at the original
    const orig = this[key]
    if (ArrayBuffer.isView(orig)) return { [TAG]: toB64(new Uint8Array(orig.buffer, orig.byteOffset, orig.byteLength)) }
    return v
  })
}

/** Parses JSON, turning tags back into Uint8Array. A malformed tag throws (the frame is invalid). */
export function parseBinary(text: string): unknown {
  return JSON.parse(text, (_k, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v) || !Object.hasOwn(v, TAG)) return v
    const s = (v as Record<string, unknown>)[TAG]
    if (Object.keys(v).length !== 1 || typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
      throw new Error('binário inválido')
    }
    return fromB64(s)
  })
}
