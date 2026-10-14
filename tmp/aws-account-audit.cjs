const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const exec = promisify(execFile);

async function aws(args) {
  const { stdout } = await exec('aws', [...args, '--output', 'json'], {
    env: { ...process.env, AWS_PAGER: '' },
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const checks = [
  ['ec2', ['ec2', 'describe-instances'], 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,Type:InstanceType}'],
  ['elasticIps', ['ec2', 'describe-addresses'], 'Addresses'],
  ['natGateways', ['ec2', 'describe-nat-gateways'], 'NatGateways[?State!=`deleted`].{Id:NatGatewayId,State:State}'],
  ['vpcEndpoints', ['ec2', 'describe-vpc-endpoints'], 'VpcEndpoints[].{Id:VpcEndpointId,Type:VpcEndpointType,State:State}'],
  ['ebsVolumes', ['ec2', 'describe-volumes'], 'Volumes[].{Id:VolumeId,Size:Size,State:State,Type:VolumeType}'],
  ['snapshots', ['ec2', 'describe-snapshots', '--owner-ids', 'self'], 'Snapshots[].{Id:SnapshotId,Size:VolumeSize}'],
  ['loadBalancers', ['elbv2', 'describe-load-balancers'], 'LoadBalancers[].{Arn:LoadBalancerArn,Name:LoadBalancerName}'],
  ['classicLoadBalancers', ['elb', 'describe-load-balancers'], 'LoadBalancerDescriptions[].LoadBalancerName'],
  ['autoScaling', ['autoscaling', 'describe-auto-scaling-groups'], 'AutoScalingGroups[].{Name:AutoScalingGroupName,Min:MinSize,Desired:DesiredCapacity}'],
  ['ecsClusters', ['ecs', 'list-clusters'], 'clusterArns'],
  ['eksClusters', ['eks', 'list-clusters'], 'clusters'],
  ['rdsInstances', ['rds', 'describe-db-instances'], 'DBInstances[].{Id:DBInstanceIdentifier,Status:DBInstanceStatus,Cluster:DBClusterIdentifier}'],
  ['rdsClusters', ['rds', 'describe-db-clusters'], 'DBClusters[].{Id:DBClusterIdentifier,Status:Status,Engine:Engine}'],
  ['lambdaFunctions', ['lambda', 'list-functions'], 'Functions[].FunctionName'],
  ['lambdaEventSources', ['lambda', 'list-event-source-mappings'], 'EventSourceMappings[].{Id:UUID,State:State}'],
  ['lightsailInstances', ['lightsail', 'get-instances'], 'instances[].{Name:name,State:state.name}'],
  ['lightsailContainers', ['lightsail', 'get-container-services'], 'containerServices[].{Name:containerServiceName,State:state,Disabled:isDisabled}'],
  ['openSearch', ['opensearch', 'list-domain-names'], 'DomainNames[].DomainName'],
  ['elasticache', ['elasticache', 'describe-cache-clusters'], 'CacheClusters[].{Id:CacheClusterId,Status:CacheClusterStatus}'],
  ['elasticacheServerless', ['elasticache', 'describe-serverless-caches'], 'ServerlessCaches[].{Name:ServerlessCacheName,Status:Status}'],
  ['redshift', ['redshift', 'describe-clusters'], 'Clusters[].{Id:ClusterIdentifier,Status:ClusterStatus}'],
  ['sagemakerEndpoints', ['sagemaker', 'list-endpoints'], 'Endpoints[].{Name:EndpointName,Status:EndpointStatus}'],
  ['sagemakerNotebooks', ['sagemaker', 'list-notebook-instances'], 'NotebookInstances[].{Name:NotebookInstanceName,Status:NotebookInstanceStatus}'],
  ['emrClusters', ['emr', 'list-clusters', '--active'], 'Clusters[].{Id:Id,State:Status.State}'],
  ['appRunner', ['apprunner', 'list-services'], 'ServiceSummaryList[].{Arn:ServiceArn,Status:Status}'],
  ['batchCompute', ['batch', 'describe-compute-environments'], 'computeEnvironments[].{Name:computeEnvironmentName,State:state}'],
  ['eventRules', ['events', 'list-rules'], 'Rules[?State!=`DISABLED`].{Name:Name,ManagedBy:ManagedBy,Schedule:ScheduleExpression}'],
  ['schedulerGroups', ['scheduler', 'list-schedule-groups'], 'ScheduleGroups[].Name'],
  ['dynamoTables', ['dynamodb', 'list-tables'], 'TableNames'],
  ['efs', ['efs', 'describe-file-systems'], 'FileSystems[].{Id:FileSystemId,Bytes:SizeInBytes.Value}'],
  ['secrets', ['secretsmanager', 'list-secrets'], 'SecretList[].{Name:Name,Arn:ARN}'],
  ['kmsKeys', ['kms', 'list-keys'], 'Keys[].KeyId'],
  ['ecrRepos', ['ecr', 'describe-repositories'], 'repositories[].repositoryName'],
  ['logGroups', ['logs', 'describe-log-groups'], 'logGroups[].{Name:logGroupName,Bytes:storedBytes}'],
  ['cloudFormation', ['cloudformation', 'list-stacks'], 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].{Name:StackName,Status:StackStatus}'],
];

const extraChecks = [
  ['restApis', ['apigateway', 'get-rest-apis'], 'items[].{Id:id,Name:name,Disabled:disableExecuteApiEndpoint}'],
  ['v2Apis', ['apigatewayv2', 'get-apis'], 'Items[].{Id:ApiId,Name:Name,Protocol:ProtocolType,Disabled:DisableExecuteApiEndpoint}'],
  ['schedules', ['scheduler', 'list-schedules'], 'Schedules[?State==`ENABLED`].{Name:Name,Group:GroupName}'],
  ['beanstalk', ['elasticbeanstalk', 'describe-environments'], 'Environments[].{Id:EnvironmentId,Name:EnvironmentName,Status:Status}'],
  ['msk', ['kafka', 'list-clusters-v2'], 'ClusterInfoList[].{Arn:ClusterArn,State:State}'],
  ['mq', ['mq', 'list-brokers'], 'BrokerSummaries[].{Id:BrokerId,State:BrokerState}'],
  ['kinesis', ['kinesis', 'list-streams'], 'StreamNames'],
  ['fsx', ['fsx', 'describe-file-systems'], 'FileSystems[].{Id:FileSystemId,Status:Lifecycle}'],
  ['openSearchServerless', ['opensearchserverless', 'list-collections'], 'collectionSummaries'],
  ['redshiftServerless', ['redshift-serverless', 'list-workgroups'], 'workgroups[].{Name:workgroupName,Status:status}'],
  ['amplify', ['amplify', 'list-apps'], 'apps[].{Id:appId,Name:name}'],
  ['stepFunctions', ['stepfunctions', 'list-state-machines'], 'stateMachines[].{Arn:stateMachineArn,Name:name}'],
  ['glueJobs', ['glue', 'get-jobs'], 'Jobs[].Name'],
];

async function main() {
  const identity = await aws(['sts', 'get-caller-identity']);
  if (identity.Account !== '437040615496') throw new Error('Unexpected AWS account');
  const regions = await aws(['ec2', 'describe-regions', '--query', 'Regions[].RegionName']);
  const extra = process.argv.includes('--extra');
  const selected = extra ? extraChecks : checks;
  const jobs = regions.flatMap(region => selected.map(([service, args, query]) => ({ region, service, args, query })));
  if (!extra) jobs.push(
    { region: 'global', service: 's3Buckets', args: ['s3api', 'list-buckets'], query: 'Buckets[].Name' },
    { region: 'global', service: 'cloudFront', args: ['cloudfront', 'list-distributions'], query: 'DistributionList.Items[].{Id:Id,Enabled:Enabled}' },
    { region: 'global', service: 'route53', args: ['route53', 'list-hosted-zones'], query: 'HostedZones[].{Id:Id,Name:Name}' },
  );
  const resources = [];
  const errors = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 18 }, async () => {
    while (cursor < jobs.length) {
      const { region, service, args, query } = jobs[cursor++];
      try {
        const data = await aws([...args, ...(region === 'global' ? [] : ['--region', region]), '--query', query]);
        if (data && (!Array.isArray(data) || data.length)) {
          resources.push({ region, service, data });
          console.log(JSON.stringify({ region, service, count: Array.isArray(data) ? data.length : 1 }));
        }
      } catch (error) {
        errors.push({ region, service, message: String(error.stderr || error.message).trim().slice(0, 600) });
      }
    }
  }));
  const report = { checkedAt: new Date().toISOString(), account: identity.Account, regions, resources, errors };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync(`output/aws-account-audit-2026-10-12${extra ? '-extra' : ''}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completedChecks: jobs.length, nonemptyServices: resources.length, errors: errors.length }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
