import {
  CloudFormationTemplateSchema,
  SecurityFlag,
  SecurityScan,
  SecurityScanSchema,
} from './schemas.js';

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const containsWildcard = (value: unknown): boolean =>
  asArray(value as string | string[] | undefined).some((entry) => entry === '*');

const statementHasWildcard = (statement: unknown, fieldName: 'Action' | 'Resource'): boolean => {
  if (!statement || typeof statement !== 'object') {
    return false;
  }

  return containsWildcard((statement as Record<string, unknown>)[fieldName]);
};

const collectPolicyStatements = (properties: Record<string, unknown>): unknown[] => {
  const policyDocument = properties.PolicyDocument;
  if (!policyDocument || typeof policyDocument !== 'object') {
    return [];
  }

  return asArray((policyDocument as Record<string, unknown>).Statement);
};

const s3PublicAccessIsMissingOrPermissive = (properties: Record<string, unknown>): boolean => {
  const config = properties.PublicAccessBlockConfiguration;
  if (!config || typeof config !== 'object') {
    return true;
  }

  const typedConfig = config as Record<string, unknown>;
  return [
    'BlockPublicAcls',
    'BlockPublicPolicy',
    'IgnorePublicAcls',
    'RestrictPublicBuckets',
  ].some((key) => typedConfig[key] !== true);
};

export const scanTemplateSecurity = (templateInput: unknown): SecurityScan => {
  const template = CloudFormationTemplateSchema.parse(templateInput);
  const flags: SecurityFlag[] = [];

  for (const [logicalId, resource] of Object.entries(template.Resources)) {
    const properties = resource.Properties ?? {};

    if (resource.Type === 'AWS::IAM::Policy') {
      for (const statement of collectPolicyStatements(properties)) {
        if (statementHasWildcard(statement, 'Action')) {
          flags.push({
            logicalId,
            severity: 'high',
            message: 'IAM policy allows all actions with Action "*". Narrow this to the specific AWS APIs required.',
          });
        }

        if (statementHasWildcard(statement, 'Resource')) {
          flags.push({
            logicalId,
            severity: 'high',
            message: 'IAM policy applies to all resources with Resource "*". Scope it to specific ARNs where possible.',
          });
        }
      }
    }

    if (resource.Type === 'AWS::S3::Bucket') {
      if (s3PublicAccessIsMissingOrPermissive(properties)) {
        flags.push({
          logicalId,
          severity: 'high',
          message: 'S3 bucket does not fully block public access.',
        });
      }

      if (!properties.BucketEncryption) {
        flags.push({
          logicalId,
          severity: 'medium',
          message: 'S3 bucket does not explicitly enable encryption at rest.',
        });
      }
    }

    if (
      resource.Type === 'AWS::RDS::DBInstance' &&
      properties.StorageEncrypted !== true
    ) {
      flags.push({
        logicalId,
        severity: 'medium',
        message: 'RDS DB instance does not explicitly enable storage encryption.',
      });
    }

    if (
      resource.Type === 'AWS::RDS::DBCluster' &&
      properties.StorageEncrypted !== true
    ) {
      flags.push({
        logicalId,
        severity: 'medium',
        message: 'RDS DB cluster does not explicitly enable storage encryption.',
      });
    }

    if (resource.Type === 'AWS::EC2::SecurityGroup') {
      for (const rule of asArray(properties.SecurityGroupIngress)) {
        if (!rule || typeof rule !== 'object') {
          continue;
        }

        const cidr = (rule as Record<string, unknown>).CidrIp;
        if (cidr === '0.0.0.0/0') {
          flags.push({
            logicalId,
            severity: 'high',
            message: 'Security group allows inbound traffic from 0.0.0.0/0 (open to the internet).',
          });
          break;
        }
      }
    }
  }

  return SecurityScanSchema.parse({ flags });
};
