/**
 * Single source of truth for CloudFormation resource types the DeploymentRole
 * accepts for generated deployments. Keep in sync with supported workflows.
 * See docs/debug-plans/kms-deployment-role-access-denied.md
 */
export const SUPPORTED_RESOURCE_TYPES = [
  'AWS::S3::Bucket',
  'AWS::S3::BucketPolicy',
  'AWS::KMS::Key',
  'AWS::KMS::Alias',
  'AWS::ApplicationAutoScaling::ScalableTarget',
  'AWS::ApplicationAutoScaling::ScalingPolicy',
  'AWS::EC2::EIP',
  'AWS::EC2::InternetGateway',
  'AWS::EC2::NatGateway',
  'AWS::EC2::Route',
  'AWS::EC2::RouteTable',
  'AWS::EC2::SecurityGroup',
  'AWS::EC2::SecurityGroupEgress',
  'AWS::EC2::SecurityGroupIngress',
  'AWS::EC2::Subnet',
  'AWS::EC2::SubnetRouteTableAssociation',
  'AWS::EC2::VPC',
  'AWS::EC2::VPCGatewayAttachment',
  'AWS::ECS::Cluster',
  'AWS::ECS::Service',
  'AWS::ECS::TaskDefinition',
  'AWS::ElasticLoadBalancingV2::Listener',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup',
  'AWS::IAM::Policy',
  'AWS::IAM::Role',
  'AWS::Logs::LogGroup',
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
