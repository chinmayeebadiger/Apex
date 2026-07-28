/**
 * Single source of truth for CloudFormation resource types the DeploymentRole
 * can create. Keep in sync with infra/lib/infra-stack.ts DeploymentRole policy.
 * See docs/debug-plans/kms-deployment-role-access-denied.md
 */
export const SUPPORTED_RESOURCE_TYPES = [
  'AWS::S3::Bucket',
  'AWS::S3::BucketPolicy',
  'AWS::KMS::Key',
  'AWS::KMS::Alias',
  'AWS::CDK::Metadata',
] as const;

const supportedSet = new Set<string>(SUPPORTED_RESOURCE_TYPES);

export const collectResourceTypes = (template: unknown): string[] => {
  if (typeof template !== 'object' || template === null) {
    return [];
  }

  const resources = (template as { Resources?: Record<string, { Type?: string }> }).Resources;
  if (!resources || typeof resources !== 'object') {
    return [];
  }

  const types = new Set<string>();
  for (const resource of Object.values(resources)) {
    if (resource?.Type) {
      types.add(resource.Type);
    }
  }

  return [...types].sort();
};

export const findUnsupportedResourceTypes = (template: unknown): string[] =>
  collectResourceTypes(template).filter((type) => !supportedSet.has(type));

export const buildDeployabilityErrorMessage = (unsupportedTypes: string[]): string => {
  const supported = SUPPORTED_RESOURCE_TYPES.filter((type) => type !== 'AWS::CDK::Metadata').join(', ');
  const unsupported = unsupportedTypes.join(', ');
  return `Deploy not attempted: ${unsupported} ${unsupportedTypes.length === 1 ? 'is' : 'are'} not supported by the deployment role. Supported today: ${supported}.`;
};
