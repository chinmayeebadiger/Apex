import { scanTemplateSecurity } from '../src/securityScanner.js';
import { SecurityScanSchema } from '../src/schemas.js';

describe('scanTemplateSecurity', () => {
  test('flags wildcard IAM actions and resources', () => {
    const scan = scanTemplateSecurity({
      Resources: {
        UnsafePolicy: {
          Type: 'AWS::IAM::Policy',
          Properties: {
            PolicyDocument: {
              Statement: [{
                Effect: 'Allow',
                Action: '*',
                Resource: '*',
              }],
            },
          },
        },
      },
    });

    expect(SecurityScanSchema.parse(scan)).toEqual(scan);
    expect(scan.flags).toEqual([
      expect.objectContaining({
        logicalId: 'UnsafePolicy',
        severity: 'high',
        message: expect.stringContaining('Action "*"'),
      }),
      expect.objectContaining({
        logicalId: 'UnsafePolicy',
        severity: 'high',
        message: expect.stringContaining('Resource "*"'),
      }),
    ]);
  });

  test('does not flag a clean IAM policy and encrypted private S3 bucket', () => {
    const scan = scanTemplateSecurity({
      Resources: {
        SafePolicy: {
          Type: 'AWS::IAM::Policy',
          Properties: {
            PolicyDocument: {
              Statement: [{
                Effect: 'Allow',
                Action: ['s3:GetObject'],
                Resource: ['arn:aws:s3:::example-bucket/*'],
              }],
            },
          },
        },
        SafeBucket: {
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
    });

    expect(scan.flags).toEqual([]);
  });
});
