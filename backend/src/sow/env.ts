// Construction-time config checks shared by the routers: fail at startup, not at request time.
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function requireEnv(owner: string, name: string, value: string | undefined, valid: (v: string) => boolean): string {
  if (!value) throw new Error(`${owner}: missing required env ${name}`);
  if (!valid(value)) throw new Error(`${owner}: env ${name} is invalid`);
  return value;
}

export const isHttpUrl = (v: string) => /^https?:\/\//.test(v);
export const isAddress = (v: string) => ADDRESS_RE.test(v);
