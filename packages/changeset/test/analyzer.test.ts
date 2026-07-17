import { analyzeTemplate, TemplateAnalysisSchema } from '../src/analyzer.js';

const pricingClient = {
  send: jest.fn().mockResolvedValue({ PriceList: [] }),
};

describe('analyzeTemplate', () => {
  test('returns changeset, cost estimate, and security scan for a template', async () => {
    const analysis = await analyzeTemplate({
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              IgnorePublicAcls: true,
              RestrictPublicBuckets: true,
            },
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [{
                ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
              }],
            },
          },
        },
      },
    }, {
      costEstimator: {
        pricingClient: pricingClient as never,
      },
    });

    expect(TemplateAnalysisSchema.parse(analysis)).toEqual(analysis);
    expect(analysis.changeset.resources).toEqual([
      expect.objectContaining({
        logicalId: 'Bucket',
        resourceType: 'AWS::S3::Bucket',
        action: 'create',
      }),
    ]);
    expect(analysis.costEstimate.totalMonthlyCostUSD).toBe(0.23);
    expect(analysis.securityScan.flags).toEqual([]);
  });
});
