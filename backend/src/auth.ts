export const createAuthRouter = (db: any) => (req: any, res: any, next: any) => next();
export const createPgIntegration = (args: any) => ({ paymentsRouter: (req: any, res: any, next: any) => next() });
export const getCaller = (req: any) => "0x0";
export const requireApiKey = (req: any, res: any, next: any) => next();
export const gasDripAddress = (address: string) => {};
