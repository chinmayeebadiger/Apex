import { z } from 'zod';

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const CloudFormationResourceSchema = z.object({
  Type: z.string(),
  Properties: z.record(z.string(), JsonValueSchema).optional(),
});

export const CloudFormationTemplateSchema = z.object({
  Resources: z.record(z.string(), CloudFormationResourceSchema).default({}),
}).passthrough();

export const ChangeActionSchema = z.enum(['create', 'modify', 'delete']);

export const ChangeSchema = z.object({
  logicalId: z.string(),
  resourceType: z.string(),
  action: ChangeActionSchema,
  properties: z.record(z.string(), JsonValueSchema),
});

export const ChangesetSchema = z.object({
  resources: z.array(ChangeSchema),
});

export const ResourceEstimateSchema = z.object({
  logicalId: z.string(),
  monthlyCostUSD: z.number().nonnegative(),
  basis: z.string(),
});

export const CostEstimateSchema = z.object({
  resourceEstimates: z.array(ResourceEstimateSchema),
  totalMonthlyCostUSD: z.number().nonnegative(),
});

export const SecurityFlagSchema = z.object({
  logicalId: z.string(),
  severity: z.enum(['high', 'medium']),
  message: z.string(),
});

export const SecurityScanSchema = z.object({
  flags: z.array(SecurityFlagSchema),
});

export const DiffResourceSchema = ChangeSchema.extend({
  color: z.enum(['green', 'blue', 'red']),
});

export const DiffRenderModelSchema = z.object({
  summary: z.string(),
  resources: z.array(DiffResourceSchema),
});

export type CloudFormationTemplate = z.infer<typeof CloudFormationTemplateSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type Changeset = z.infer<typeof ChangesetSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type ResourceEstimate = z.infer<typeof ResourceEstimateSchema>;
export type SecurityFlag = z.infer<typeof SecurityFlagSchema>;
export type SecurityScan = z.infer<typeof SecurityScanSchema>;
export type DiffRenderModel = z.infer<typeof DiffRenderModelSchema>;
