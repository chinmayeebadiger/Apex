import {
  Changeset,
  CostEstimate,
  CostEstimateSchema,
  ResourceEstimate,
} from './schemas.js';
import {
  GetProductsCommand,
  PricingClient,
  PricingClientConfig,
} from '@aws-sdk/client-pricing';

export interface CostEstimatorOptions {
  region?: string;
  pricingClient?: PricingClient;
}

const MONTHLY_HOURS = 730;

const serviceCodeByResourceType: Record<string, string> = {
  'AWS::Lambda::Function': 'AWSLambda',
  'AWS::DynamoDB::Table': 'AmazonDynamoDB',
  'AWS::S3::Bucket': 'AmazonS3',
  'AWS::ApiGateway::RestApi': 'AmazonApiGateway',
  'AWS::ApiGatewayV2::Api': 'AmazonApiGateway',
};

const pricingRegionNameByCode: Record<string, string> = {
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'us-east-1': 'US East (N. Virginia)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'EU (Ireland)',
};

const defaultMonthlyCostByResourceType: Record<string, { cost: number; basis: string }> = {
  'AWS::Lambda::Function': {
    cost: 0,
    basis: 'Estimate: Lambda has no standing monthly charge; usage charges depend on requests, duration, and memory.',
  },
  'AWS::DynamoDB::Table': {
    cost: 1.25,
    basis: 'Estimate: assumes a small on-demand table with light reads/writes and minimal storage.',
  },
  'AWS::S3::Bucket': {
    cost: 0.23,
    basis: 'Estimate: assumes 10 GB S3 Standard storage before request and data-transfer charges.',
  },
  'AWS::ApiGateway::RestApi': {
    cost: 3.5,
    basis: 'Estimate: assumes 1 million REST API requests per month before data-transfer charges.',
  },
  'AWS::ApiGatewayV2::Api': {
    cost: 1,
    basis: 'Estimate: assumes 1 million HTTP API requests per month before data-transfer charges.',
  },
};

export class CostEstimator {
  private readonly pricingClient: PricingClient;
  private readonly region: string;
  private readonly pricingCache = new Map<string, unknown>();

  constructor(options: CostEstimatorOptions = {}) {
    this.region = options.region ?? 'ap-south-1';
    const pricingConfig: PricingClientConfig = { region: 'us-east-1' };
    this.pricingClient = options.pricingClient ?? new PricingClient(pricingConfig);
  }

  async estimate(changeset: Changeset): Promise<CostEstimate> {
    const resourceEstimates: ResourceEstimate[] = [];

    for (const resource of changeset.resources) {
      if (resource.action === 'delete') {
        resourceEstimates.push({
          logicalId: resource.logicalId,
          monthlyCostUSD: 0,
          basis: 'Deletion: no new monthly cost is introduced.',
        });
        continue;
      }

      const heuristic = defaultMonthlyCostByResourceType[resource.resourceType];
      if (!heuristic) {
        resourceEstimates.push({
          logicalId: resource.logicalId,
          monthlyCostUSD: 0,
          basis: 'No estimate available for this resource type yet.',
        });
        continue;
      }

      await this.loadPricingMetadata(resource.resourceType);

      resourceEstimates.push({
        logicalId: resource.logicalId,
        monthlyCostUSD: heuristic.cost,
        basis: heuristic.basis,
      });
    }

    const totalMonthlyCostUSD = Number(
      resourceEstimates
        .reduce((total, estimate) => total + estimate.monthlyCostUSD, 0)
        .toFixed(2),
    );

    return CostEstimateSchema.parse({ resourceEstimates, totalMonthlyCostUSD });
  }

  private async loadPricingMetadata(resourceType: string): Promise<void> {
    const serviceCode = serviceCodeByResourceType[resourceType];
    if (!serviceCode) {
      return;
    }

    const cacheKey = `${serviceCode}:${this.region}`;
    if (this.pricingCache.has(cacheKey)) {
      return;
    }

    const location = pricingRegionNameByCode[this.region];
    const filters = location
      ? [{ Type: 'TERM_MATCH' as const, Field: 'location', Value: location }]
      : undefined;

    const response = await this.pricingClient.send(new GetProductsCommand({
      ServiceCode: serviceCode,
      Filters: filters,
      MaxResults: 1,
    }));

    this.pricingCache.set(cacheKey, response.PriceList ?? []);
  }
}

export const estimateChangesetCost = (
  changeset: Changeset,
  options?: CostEstimatorOptions,
): Promise<CostEstimate> => new CostEstimator(options).estimate(changeset);
