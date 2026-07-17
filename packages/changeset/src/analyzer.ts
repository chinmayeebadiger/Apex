import { estimateChangesetCost, CostEstimatorOptions } from './costEstimator.js';
import { parseChangeset } from './parser.js';
import {
  ChangesetSchema,
  CloudFormationTemplateSchema,
  CostEstimateSchema,
  SecurityScanSchema,
} from './schemas.js';
import { scanTemplateSecurity } from './securityScanner.js';
import { z } from 'zod';

export const TemplateAnalysisSchema = z.object({
  changeset: ChangesetSchema,
  costEstimate: CostEstimateSchema,
  securityScan: SecurityScanSchema,
});

export type TemplateAnalysis = z.infer<typeof TemplateAnalysisSchema>;

export interface AnalyzeTemplateOptions {
  previousTemplate?: unknown;
  costEstimator?: CostEstimatorOptions;
}

export const analyzeTemplate = async (
  templateInput: unknown,
  options: AnalyzeTemplateOptions = {},
): Promise<TemplateAnalysis> => {
  const template = CloudFormationTemplateSchema.parse(templateInput);
  const changeset = ChangesetSchema.parse(parseChangeset(template, options.previousTemplate));
  const costEstimate = CostEstimateSchema.parse(await estimateChangesetCost(changeset, options.costEstimator));
  const securityScan = SecurityScanSchema.parse(scanTemplateSecurity(template));

  return TemplateAnalysisSchema.parse({
    changeset,
    costEstimate,
    securityScan,
  });
};
