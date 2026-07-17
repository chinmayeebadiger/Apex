import { z } from 'zod';
export declare const JsonValueSchema: z.ZodType<unknown>;
export declare const CloudFormationResourceSchema: z.ZodObject<{
    Type: z.ZodString;
    Properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
}, z.core.$strip>;
export declare const CloudFormationTemplateSchema: z.ZodObject<{
    Resources: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        Type: z.ZodString;
        Properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$strip>>>;
}, z.core.$loose>;
export declare const ChangeActionSchema: z.ZodEnum<{
    delete: "delete";
    create: "create";
    modify: "modify";
}>;
export declare const ChangeSchema: z.ZodObject<{
    logicalId: z.ZodString;
    resourceType: z.ZodString;
    action: z.ZodEnum<{
        delete: "delete";
        create: "create";
        modify: "modify";
    }>;
    properties: z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
}, z.core.$strip>;
export declare const ChangesetSchema: z.ZodObject<{
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
export declare const ResourceEstimateSchema: z.ZodObject<{
    logicalId: z.ZodString;
    monthlyCostUSD: z.ZodNumber;
    basis: z.ZodString;
}, z.core.$strip>;
export declare const CostEstimateSchema: z.ZodObject<{
    resourceEstimates: z.ZodArray<z.ZodObject<{
        logicalId: z.ZodString;
        monthlyCostUSD: z.ZodNumber;
        basis: z.ZodString;
    }, z.core.$strip>>;
    totalMonthlyCostUSD: z.ZodNumber;
}, z.core.$strip>;
export declare const SecurityFlagSchema: z.ZodObject<{
    logicalId: z.ZodString;
    severity: z.ZodEnum<{
        medium: "medium";
        high: "high";
    }>;
    message: z.ZodString;
}, z.core.$strip>;
export declare const SecurityScanSchema: z.ZodObject<{
    flags: z.ZodArray<z.ZodObject<{
        logicalId: z.ZodString;
        severity: z.ZodEnum<{
            medium: "medium";
            high: "high";
        }>;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const DiffResourceSchema: z.ZodObject<{
    logicalId: z.ZodString;
    resourceType: z.ZodString;
    action: z.ZodEnum<{
        delete: "delete";
        create: "create";
        modify: "modify";
    }>;
    properties: z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    color: z.ZodEnum<{
        green: "green";
        blue: "blue";
        red: "red";
    }>;
}, z.core.$strip>;
export declare const DiffRenderModelSchema: z.ZodObject<{
    summary: z.ZodString;
    resources: z.ZodArray<z.ZodObject<{
        logicalId: z.ZodString;
        resourceType: z.ZodString;
        action: z.ZodEnum<{
            delete: "delete";
            create: "create";
            modify: "modify";
        }>;
        properties: z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
        color: z.ZodEnum<{
            green: "green";
            blue: "blue";
            red: "red";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CloudFormationTemplate = z.infer<typeof CloudFormationTemplateSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type Changeset = z.infer<typeof ChangesetSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type ResourceEstimate = z.infer<typeof ResourceEstimateSchema>;
export type SecurityFlag = z.infer<typeof SecurityFlagSchema>;
export type SecurityScan = z.infer<typeof SecurityScanSchema>;
export type DiffRenderModel = z.infer<typeof DiffRenderModelSchema>;
