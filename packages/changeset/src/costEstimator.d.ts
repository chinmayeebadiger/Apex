import { Changeset, CostEstimate } from './schemas.js';
import { PricingClient } from '@aws-sdk/client-pricing';
export interface CostEstimatorOptions {
    region?: string;
    pricingClient?: PricingClient;
}
export declare class CostEstimator {
    private readonly pricingClient;
    private readonly region;
    private readonly pricingCache;
    constructor(options?: CostEstimatorOptions);
    estimate(changeset: Changeset): Promise<CostEstimate>;
    private loadPricingMetadata;
}
export declare const estimateChangesetCost: (changeset: Changeset, options?: CostEstimatorOptions) => Promise<CostEstimate>;
