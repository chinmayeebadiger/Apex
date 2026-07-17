"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateChangesetCost = exports.CostEstimator = void 0;
const schemas_js_1 = require("./schemas.js");
const client_pricing_1 = require("@aws-sdk/client-pricing");
const MONTHLY_HOURS = 730;
const serviceCodeByResourceType = {
    'AWS::Lambda::Function': 'AWSLambda',
    'AWS::DynamoDB::Table': 'AmazonDynamoDB',
    'AWS::S3::Bucket': 'AmazonS3',
    'AWS::ApiGateway::RestApi': 'AmazonApiGateway',
    'AWS::ApiGatewayV2::Api': 'AmazonApiGateway',
};
const pricingRegionNameByCode = {
    'ap-south-1': 'Asia Pacific (Mumbai)',
    'us-east-1': 'US East (N. Virginia)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'EU (Ireland)',
};
const defaultMonthlyCostByResourceType = {
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
class CostEstimator {
    pricingClient;
    region;
    pricingCache = new Map();
    constructor(options = {}) {
        this.region = options.region ?? 'ap-south-1';
        const pricingConfig = { region: 'us-east-1' };
        this.pricingClient = options.pricingClient ?? new client_pricing_1.PricingClient(pricingConfig);
    }
    async estimate(changeset) {
        const resourceEstimates = [];
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
        const totalMonthlyCostUSD = Number(resourceEstimates
            .reduce((total, estimate) => total + estimate.monthlyCostUSD, 0)
            .toFixed(2));
        return schemas_js_1.CostEstimateSchema.parse({ resourceEstimates, totalMonthlyCostUSD });
    }
    async loadPricingMetadata(resourceType) {
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
            ? [{ Type: 'TERM_MATCH', Field: 'location', Value: location }]
            : undefined;
        const response = await this.pricingClient.send(new client_pricing_1.GetProductsCommand({
            ServiceCode: serviceCode,
            Filters: filters,
            MaxResults: 1,
        }));
        this.pricingCache.set(cacheKey, response.PriceList ?? []);
    }
}
exports.CostEstimator = CostEstimator;
const estimateChangesetCost = (changeset, options) => new CostEstimator(options).estimate(changeset);
exports.estimateChangesetCost = estimateChangesetCost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdEVzdGltYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3RFc3RpbWF0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBS3NCO0FBQ3RCLDREQUlpQztBQU9qQyxNQUFNLGFBQWEsR0FBRyxHQUFHLENBQUM7QUFFMUIsTUFBTSx5QkFBeUIsR0FBMkI7SUFDeEQsdUJBQXVCLEVBQUUsV0FBVztJQUNwQyxzQkFBc0IsRUFBRSxnQkFBZ0I7SUFDeEMsaUJBQWlCLEVBQUUsVUFBVTtJQUM3QiwwQkFBMEIsRUFBRSxrQkFBa0I7SUFDOUMsd0JBQXdCLEVBQUUsa0JBQWtCO0NBQzdDLENBQUM7QUFFRixNQUFNLHVCQUF1QixHQUEyQjtJQUN0RCxZQUFZLEVBQUUsdUJBQXVCO0lBQ3JDLFdBQVcsRUFBRSx1QkFBdUI7SUFDcEMsV0FBVyxFQUFFLGtCQUFrQjtJQUMvQixXQUFXLEVBQUUsY0FBYztDQUM1QixDQUFDO0FBRUYsTUFBTSxnQ0FBZ0MsR0FBb0Q7SUFDeEYsdUJBQXVCLEVBQUU7UUFDdkIsSUFBSSxFQUFFLENBQUM7UUFDUCxLQUFLLEVBQUUsMEdBQTBHO0tBQ2xIO0lBQ0Qsc0JBQXNCLEVBQUU7UUFDdEIsSUFBSSxFQUFFLElBQUk7UUFDVixLQUFLLEVBQUUsd0ZBQXdGO0tBQ2hHO0lBQ0QsaUJBQWlCLEVBQUU7UUFDakIsSUFBSSxFQUFFLElBQUk7UUFDVixLQUFLLEVBQUUsdUZBQXVGO0tBQy9GO0lBQ0QsMEJBQTBCLEVBQUU7UUFDMUIsSUFBSSxFQUFFLEdBQUc7UUFDVCxLQUFLLEVBQUUsdUZBQXVGO0tBQy9GO0lBQ0Qsd0JBQXdCLEVBQUU7UUFDeEIsSUFBSSxFQUFFLENBQUM7UUFDUCxLQUFLLEVBQUUsdUZBQXVGO0tBQy9GO0NBQ0YsQ0FBQztBQUVGLE1BQWEsYUFBYTtJQUNQLGFBQWEsQ0FBZ0I7SUFDN0IsTUFBTSxDQUFTO0lBQ2YsWUFBWSxHQUFHLElBQUksR0FBRyxFQUFtQixDQUFDO0lBRTNE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aEIsVUFBVSxFQUFFLENBQUM7U0FDZCxDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsU0FBUyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzVELENBQUM7Q0FDRjtBQTVFRCxzQ0E0RUM7QUFFTSxNQUFNLHFCQUFxQixHQUFHLENBQ25DLFNBQW9CLEVBQ3BCLE9BQThCLEVBQ1AsRUFBRSxDQUFDLElBQUksYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUg5RCxRQUFBLHFCQUFxQix5QkFHeUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBDaGFuZ2VzZXQsXG4gIENvc3RFc3RpbWF0ZSxcbiAgQ29zdEVzdGltYXRlU2NoZW1hLFxuICBSZXNvdXJjZUVzdGltYXRlLFxufSBmcm9tICcuL3NjaGVtYXMuanMnO1xuaW1wb3J0IHtcbiAgR2V0UHJvZHVjdHNDb21tYW5kLFxuICBQcmljaW5nQ2xpZW50LFxuICBQcmljaW5nQ2xpZW50Q29uZmlnLFxufSBmcm9tICdAYXdzLXNkay9jbGllbnQtcHJpY2luZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29zdEVzdGltYXRvck9wdGlvbnMge1xuICByZWdpb24/OiBzdHJpbmc7XG4gIHByaWNpbmdDbGllbnQ/OiBQcmljaW5nQ2xpZW50O1xufVxuXG5jb25zdCBNT05USExZX0hPVVJTID0gNzMwO1xuXG5jb25zdCBzZXJ2aWNlQ29kZUJ5UmVzb3VyY2VUeXBlOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJzogJ0FXU0xhbWJkYScsXG4gICdBV1M6OkR5bmFtb0RCOjpUYWJsZSc6ICdBbWF6b25EeW5hbW9EQicsXG4gICdBV1M6OlMzOjpCdWNrZXQnOiAnQW1hem9uUzMnLFxuICAnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJzogJ0FtYXpvbkFwaUdhdGV3YXknLFxuICAnQVdTOjpBcGlHYXRld2F5VjI6OkFwaSc6ICdBbWF6b25BcGlHYXRld2F5Jyxcbn07XG5cbmNvbnN0IHByaWNpbmdSZWdpb25OYW1lQnlDb2RlOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAnYXAtc291dGgtMSc6ICdBc2lhIFBhY2lmaWMgKE11bWJhaSknLFxuICAndXMtZWFzdC0xJzogJ1VTIEVhc3QgKE4uIFZpcmdpbmlhKScsXG4gICd1cy13ZXN0LTInOiAnVVMgV2VzdCAoT3JlZ29uKScsXG4gICdldS13ZXN0LTEnOiAnRVUgKElyZWxhbmQpJyxcbn07XG5cbmNvbnN0IGRlZmF1bHRNb250aGx5Q29zdEJ5UmVzb3VyY2VUeXBlOiBSZWNvcmQ8c3RyaW5nLCB7IGNvc3Q6IG51bWJlcjsgYmFzaXM6IHN0cmluZyB9PiA9IHtcbiAgJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbic6IHtcbiAgICBjb3N0OiAwLFxuICAgIGJhc2lzOiAnRXN0aW1hdGU6IExhbWJkYSBoYXMgbm8gc3RhbmRpbmcgbW9udGhseSBjaGFyZ2U7IHVzYWdlIGNoYXJnZXMgZGVwZW5kIG9uIHJlcXVlc3RzLCBkdXJhdGlvbiwgYW5kIG1lbW9yeS4nLFxuICB9LFxuICAnQVdTOjpEeW5hbW9EQjo6VGFibGUnOiB7XG4gICAgY29zdDogMS4yNSxcbiAgICBiYXNpczogJ0VzdGltYXRlOiBhc3N1bWVzIGEgc21hbGwgb24tZGVtYW5kIHRhYmxlIHdpdGggbGlnaHQgcmVhZHMvd3JpdGVzIGFuZCBtaW5pbWFsIHN0b3JhZ2UuJyxcbiAgfSxcbiAgJ0FXUzo6UzM6OkJ1Y2tldCc6IHtcbiAgICBjb3N0OiAwLjIzLFxuICAgIGJhc2lzOiAnRXN0aW1hdGU6IGFzc3VtZXMgMTAgR0IgUzMgU3RhbmRhcmQgc3RvcmFnZSBiZWZvcmUgcmVxdWVzdCBhbmQgZGF0YS10cmFuc2ZlciBjaGFyZ2VzLicsXG4gIH0sXG4gICdBV1M6OkFwaUdhdGV3YXk6OlJlc3RBcGknOiB7XG4gICAgY29zdDogMy41LFxuICAgIGJhc2lzOiAnRXN0aW1hdGU6IGFzc3VtZXMgMSBtaWxsaW9uIFJFU1QgQVBJIHJlcXVlc3RzIHBlciBtb250aCBiZWZvcmUgZGF0YS10cmFuc2ZlciBjaGFyZ2VzLicsXG4gIH0sXG4gICdBV1M6OkFwaUdhdGV3YXlWMjo6QXBpJzoge1xuICAgIGNvc3Q6IDEsXG4gICAgYmFzaXM6ICdFc3RpbWF0ZTogYXNzdW1lcyAxIG1pbGxpb24gSFRUUCBBUEkgcmVxdWVzdHMgcGVyIG1vbnRoIGJlZm9yZSBkYXRhLXRyYW5zZmVyIGNoYXJnZXMuJyxcbiAgfSxcbn07XG5cbmV4cG9ydCBjbGFzcyBDb3N0RXN0aW1hdG9yIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwcmljaW5nQ2xpZW50OiBQcmljaW5nQ2xpZW50O1xuICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lvbjogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHByaWNpbmdDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB1bmtub3duPigpO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IENvc3RFc3RpbWF0b3JPcHRpb25zID0ge30pIHtcbiAgICB0aGlzLnJlZ2lvbiA9IG9wdGlvbnMucmVnaW9uID8/ICdhcC1zb3V0aC0xJztcbiAgICBjb25zdCBwcmljaW5nQ29uZmlnOiBQcmljaW5nQ2xpZW50Q29uZmlnID0geyByZWdpb246ICd1cy1lYXN0LTEnIH07XG4gICAgdGhpcy5wcmljaW5nQ2xpZW50ID0gb3B0aW9ucy5wcmljaW5nQ2xpZW50ID8/IG5ldyBQcmljaW5nQ2xpZW50KHByaWNpbmdDb25maWcpO1xuICB9XG5cbiAgYXN5bmMgZXN0aW1hdGUoY2hhbmdlc2V0OiBDaGFuZ2VzZXQpOiBQcm9taXNlPENvc3RFc3RpbWF0ZT4ge1xuICAgIGNvbnN0IHJlc291cmNlRXN0aW1hdGVzOiBSZXNvdXJjZUVzdGltYXRlW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgY2hhbmdlc2V0LnJlc291cmNlcykge1xuICAgICAgaWYgKHJlc291cmNlLmFjdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgcmVzb3VyY2VFc3RpbWF0ZXMucHVzaCh7XG4gICAgICAgICAgbG9naWNhbElkOiByZXNvdXJjZS5sb2dpY2FsSWQsXG4gICAgICAgICAgbW9udGhseUNvc3RVU0Q6IDAsXG4gICAgICAgICAgYmFzaXM6ICdEZWxldGlvbjogbm8gbmV3IG1vbnRobHkgY29zdCBpcyBpbnRyb2R1Y2VkLicsXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaGV1cmlzdGljID0gZGVmYXVsdE1vbnRobHlDb3N0QnlSZXNvdXJjZVR5cGVbcmVzb3VyY2UucmVzb3VyY2VUeXBlXTtcbiAgICAgIGlmICghaGV1cmlzdGljKSB7XG4gICAgICAgIHJlc291cmNlRXN0aW1hdGVzLnB1c2goe1xuICAgICAgICAgIGxvZ2ljYWxJZDogcmVzb3VyY2UubG9naWNhbElkLFxuICAgICAgICAgIG1vbnRobHlDb3N0VVNEOiAwLFxuICAgICAgICAgIGJhc2lzOiAnTm8gZXN0aW1hdGUgYXZhaWxhYmxlIGZvciB0aGlzIHJlc291cmNlIHR5cGUgeWV0LicsXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5sb2FkUHJpY2luZ01ldGFkYXRhKHJlc291cmNlLnJlc291cmNlVHlwZSk7XG5cbiAgICAgIHJlc291cmNlRXN0aW1hdGVzLnB1c2goe1xuICAgICAgICBsb2dpY2FsSWQ6IHJlc291cmNlLmxvZ2ljYWxJZCxcbiAgICAgICAgbW9udGhseUNvc3RVU0Q6IGhldXJpc3RpYy5jb3N0LFxuICAgICAgICBiYXNpczogaGV1cmlzdGljLmJhc2lzLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdG90YWxNb250aGx5Q29zdFVTRCA9IE51bWJlcihcbiAgICAgIHJlc291cmNlRXN0aW1hdGVzXG4gICAgICAgIC5yZWR1Y2UoKHRvdGFsLCBlc3RpbWF0ZSkgPT4gdG90YWwgKyBlc3RpbWF0ZS5tb250aGx5Q29zdFVTRCwgMClcbiAgICAgICAgLnRvRml4ZWQoMiksXG4gICAgKTtcblxuICAgIHJldHVybiBDb3N0RXN0aW1hdGVTY2hlbWEucGFyc2UoeyByZXNvdXJjZUVzdGltYXRlcywgdG90YWxNb250aGx5Q29zdFVTRCB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZFByaWNpbmdNZXRhZGF0YShyZXNvdXJjZVR5cGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlcnZpY2VDb2RlID0gc2VydmljZUNvZGVCeVJlc291cmNlVHlwZVtyZXNvdXJjZVR5cGVdO1xuICAgIGlmICghc2VydmljZUNvZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3NlcnZpY2VDb2RlfToke3RoaXMucmVnaW9ufWA7XG4gICAgaWYgKHRoaXMucHJpY2luZ0NhY2hlLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhdGlvbiA9IHByaWNpbmdSZWdpb25OYW1lQnlDb2RlW3RoaXMucmVnaW9uXTtcbiAgICBjb25zdCBmaWx0ZXJzID0gbG9jYXRpb25cbiAgICAgID8gW3sgVHlwZTogJ1RFUk1fTUFUQ0gnIGFzIGNvbnN0LCBGaWVsZDogJ2xvY2F0aW9uJywgVmFsdWU6IGxvY2F0aW9uIH1dXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wcmljaW5nQ2xpZW50LnNlbmQobmV3IEdldFByb2R1Y3RzQ29tbWFuZCh7XG4gICAgICBTZXJ2aWNlQ29kZTogc2VydmljZUNvZGUsXG4gICAgICBGaWx0ZXJzOiBmaWx0ZXJzLFxuICAgICAgTWF4UmVzdWx0czogMSxcbiAgICB9KSk7XG5cbiAgICB0aGlzLnByaWNpbmdDYWNoZS5zZXQoY2FjaGVLZXksIHJlc3BvbnNlLlByaWNlTGlzdCA/PyBbXSk7XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGVzdGltYXRlQ2hhbmdlc2V0Q29zdCA9IChcbiAgY2hhbmdlc2V0OiBDaGFuZ2VzZXQsXG4gIG9wdGlvbnM/OiBDb3N0RXN0aW1hdG9yT3B0aW9ucyxcbik6IFByb21pc2U8Q29zdEVzdGltYXRlPiA9PiBuZXcgQ29zdEVzdGltYXRvcihvcHRpb25zKS5lc3RpbWF0ZShjaGFuZ2VzZXQpO1xuIl19