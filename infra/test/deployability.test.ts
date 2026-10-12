import {
  buildDeployabilityErrorMessage,
  collectResourceTypes,
  findUnsupportedResourceTypes,
  SUPPORTED_RESOURCE_TYPES,
} from '../lambda/shared/deployability';

describe('deployability', () => {
  test('collectResourceTypes returns sorted unique types', () => {
    const template = {
      Resources: {
        B: { Type: 'AWS::S3::Bucket' },
        K: { Type: 'AWS::KMS::Key' },
        B2: { Type: 'AWS::S3::Bucket' },
      },
    };

    expect(collectResourceTypes(template)).toEqual([
      'AWS::KMS::Key',
      'AWS::S3::Bucket',
    ]);
  });

  test('findUnsupportedResourceTypes flags Lambda and DynamoDB', () => {
    const template = {
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
        Fn: { Type: 'AWS::Lambda::Function' },
        Table: { Type: 'AWS::DynamoDB::Table' },
      },
    };

    expect(findUnsupportedResourceTypes(template)).toEqual([
      'AWS::DynamoDB::Table',
      'AWS::Lambda::Function',
    ]);
  });

  test('KMS key and alias are supported', () => {
    const template = {
      Resources: {
        Key: { Type: 'AWS::KMS::Key' },
        Alias: { Type: 'AWS::KMS::Alias' },
        Bucket: { Type: 'AWS::S3::Bucket' },
      },
    };

    expect(findUnsupportedResourceTypes(template)).toEqual([]);
  });

  test('accepts ECS services with networking, scaling, roles, and logs', () => {
    const types = [
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
    ];
    const Resources = Object.fromEntries(
      types.map((Type, index) => [`Resource${index}`, { Type }]),
    );

    expect(findUnsupportedResourceTypes({ Resources })).toEqual([]);
  });

  test('buildDeployabilityErrorMessage lists supported types', () => {
    const message = buildDeployabilityErrorMessage(['AWS::Lambda::Function']);

    expect(message).toContain('Deploy not attempted');
    expect(message).toContain('AWS::Lambda::Function');
    expect(message).toContain('AWS::S3::Bucket');
    expect(message).toContain('AWS::KMS::Key');
  });

  test('SUPPORTED_RESOURCE_TYPES includes CDK metadata pseudo-resource', () => {
    expect(SUPPORTED_RESOURCE_TYPES).toContain('AWS::CDK::Metadata');
  });
});
