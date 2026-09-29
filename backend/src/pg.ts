// B1: PG's gas drip hook. index.ts sets it from createPgIntegration() once the ORG wallet is configured;
// until then KYC approval simply skips the drip.
let drip: (address: string) => Promise<unknown> = async () => undefined;

export function setGasDrip(fn: (address: string) => Promise<unknown>): void {
  drip = fn;
}

export function gasDripAddress(address: string): Promise<unknown> {
  return drip(address);
}
