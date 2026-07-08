import { parseChangeset } from '../src/parser.js';
import { ChangesetSchema } from '../src/schemas.js';

const s3Bucket = (bucketName: string) => ({
  Type: 'AWS::S3::Bucket',
  Properties: {
    BucketName: bucketName,
    VersioningConfiguration: { Status: 'Enabled' },
  },
});

describe('parseChangeset', () => {
  test('treats every resource as create when previous template is missing', () => {
    const changeset = parseChangeset({
      Resources: {
        Bucket: s3Bucket('new-bucket'),
        Function: {
          Type: 'AWS::Lambda::Function',
          Properties: { Runtime: 'nodejs20.x' },
        },
      },
    });

    expect(ChangesetSchema.parse(changeset)).toEqual(changeset);
    expect(changeset.resources).toEqual([
      expect.objectContaining({ logicalId: 'Bucket', action: 'create' }),
      expect.objectContaining({ logicalId: 'Function', action: 'create' }),
    ]);
  });

  test('detects shallow property modifications', () => {
    const previousTemplate = {
      Resources: {
        Bucket: s3Bucket('old-bucket'),
      },
    };

    const nextTemplate = {
      Resources: {
        Bucket: s3Bucket('new-bucket'),
      },
    };

    const changeset = parseChangeset(nextTemplate, previousTemplate);

    expect(changeset.resources).toEqual([
      expect.objectContaining({
        logicalId: 'Bucket',
        resourceType: 'AWS::S3::Bucket',
        action: 'modify',
      }),
    ]);
  });

  test('detects resource deletions', () => {
    const previousTemplate = {
      Resources: {
        Bucket: s3Bucket('old-bucket'),
        Table: {
          Type: 'AWS::DynamoDB::Table',
          Properties: { BillingMode: 'PAY_PER_REQUEST' },
        },
      },
    };

    const nextTemplate = {
      Resources: {
        Bucket: s3Bucket('old-bucket'),
      },
    };

    const changeset = parseChangeset(nextTemplate, previousTemplate);

    expect(changeset.resources).toEqual([
      expect.objectContaining({
        logicalId: 'Table',
        resourceType: 'AWS::DynamoDB::Table',
        action: 'delete',
      }),
    ]);
  });
});
