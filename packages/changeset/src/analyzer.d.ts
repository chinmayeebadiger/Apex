import { CostEstimatorOptions } from './costEstimator.js';
import { z } from 'zod';
export declare const TemplateAnalysisSchema: z.ZodObject<{
    changeset: z.ZodObject<{
        resources: z.ZodArray<z.ZodObject<{
            logicalId: z.ZodString;
            resourceType: z.ZodString;
            action: z.ZodEnum<{
                delete: "delete";
                create: "create";
                modify: "modify";
            }>;
            properties: z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    costEstimate: z.ZodObject<{
        resourceEstimates: z.ZodArray<z.ZodObject<{
            logicalId: z.ZodString;
            monthlyCostUSD: z.ZodNumber;
            basis: z.ZodString;
        }, z.core.$strip>>;
        totalMonthlyCostUSD: z.ZodNumber;
    }, z.core.$strip>;
    securityScan: z.ZodObject<{
        flags: z.ZodArray<z.ZodObject<{
            logicalId: z.ZodString;
            severity: z.ZodEnum<{
                medium: "medium";
                high: "high";
            }>;
            message: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type TemplateAnalysis = z.infer<typeof TemplateAnalysisSchema>;
export interface AnalyzeTemplateOptions {
    previousTemplate?: unknown;
    costEstimator?: CostEstimatorOptions;
}
export declare const analyzeTemplate: (templateInput: unknown, options?: AnalyzeTemplateOptions) => Promise<TemplateAnalysis>;
