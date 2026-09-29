import { z } from "zod";
export declare const SOW_VERSION: "sow/v1";
export declare const TOTAL_BPS = 10000;
export declare const DeliverableSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    weightBps: z.ZodNumber;
}, z.core.$strip>;
export declare const SowSchema: z.ZodObject<{
    version: z.ZodLiteral<"sow/v1">;
    title: z.ZodString;
    buyer: z.ZodString;
    seller: z.ZodString;
    token: z.ZodString;
    amount: z.ZodString;
    deliveryDeadline: z.ZodNumber;
    reviewWindowSecs: z.ZodNumber;
    deliverables: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        weightBps: z.ZodNumber;
    }, z.core.$strip>>;
    exclusions: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type Deliverable = z.infer<typeof DeliverableSchema>;
export type Sow = z.infer<typeof SowSchema>;
export declare function parseSow(input: unknown): Sow;
