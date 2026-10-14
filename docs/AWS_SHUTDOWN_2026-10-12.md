# AWS Account Shutdown - 12 October 2026

Account: `437040615496`.

## Result

The audit checked 17 enabled AWS Regions, common persistent compute/networking services,
serverless workloads, scheduling, and several global services. No running EC2 instances
or active persistent compute workloads were found in the services checked.

Changes made:

- Disabled execution of all 13 Lambda functions in `ap-south-1` by setting reserved concurrency to zero, and verified each setting.
- Confirmed none of these functions had provisioned concurrency configurations.
- Disabled the default public execution endpoint for REST API `8596tnvff0` and redeployed its `prod` stage. A test request returned HTTP 403.
- Disabled the default public execution endpoint for HTTP API `5h82jq8y4k` and set stage throttling to zero.
- Set WebSocket API `gtfpskqrce` stage `prod` throttling rate and burst to zero. Existing connections are not explicitly disconnected; AWS may keep them until they close or expire.
- Disassociated and released Elastic IP `15.252.55.39`, allocation `eipalloc-01331fff3ef7974c5`, previously attached to the stopped Student OS instance. Verified no Elastic IP allocations remain in Mumbai.
- Checked all five S3 buckets for website configurations; none were configured.

The Apex frontend may still run locally, but its AWS backend is now paused and cannot
generate or deploy infrastructure until the shutdown settings are reversed.

## EC2 Instances

All three were already stopped and were left stopped:

| Region | Instance | Type |
|---|---|---|
| ap-south-1 | i-0afff807f96ce9503 | t3.small |
| us-east-1 | i-0dd3861f444310d89 | c8a.8xlarge |
| us-east-2 | i-05772aca90e5edf5f | c8a.8xlarge |

There were no EC2 autoscaling groups, ECS clusters, EKS clusters, load balancers, NAT
gateways, RDS databases, or active scheduling rules found by the corresponding scans.
Additional scans found no App Runner, SageMaker endpoints/notebooks, EMR, MSK, MQ,
ElastiCache, Redshift, OpenSearch, Kinesis, FSx, Elastic Beanstalk, Amplify, or Step
Functions resources in supported scanned regions.

## Data Preserved And Potential Remaining Charges

This shutdown does not mean the account has zero future charges. Preserved resources include:

- Three gp3 EBS volumes totaling 46 GiB, attached to the stopped EC2 instances.
- Five S3 buckets, including CDK deployment assets, templates, and demo content.
- Two DynamoDB tables, both using pay-per-request billing rather than provisioned capacity.
- CloudWatch logs and the CDK ECR repository.
- The Secrets Manager secret `anthropic-api-key`.
- One enabled customer-managed KMS key, `697690fc-67c6-444c-bc70-7310a7e5c08c`, used by the encrypted demo bucket. Four other keys are AWS-managed.

EBS and other retained storage can still be billed. Secrets Manager and customer-managed
KMS keys can also have standing charges. They were preserved to avoid destroying data or
making encrypted objects inaccessible. No buckets, tables, disks, secrets, or keys were deleted.

## Inventory And Original Settings

Generated reports are in `output/`:

- `aws-account-audit-2026-10-12.json`: initial 598 API checks, resource inventory, and errors.
- `aws-account-audit-2026-10-12-extra.json`: 221 supplemental API checks.
- `aws-lambda-shutdown-ap-south-1-2026-10-12.json`: original Lambda concurrency settings and verified shutdown results.
- `aws-endpoints-shutdown-2026-10-12.json`: original API/stage configurations and shutdown results.

The initial inventory can include the Elastic IP that was subsequently released. Use the
verified shutdown results, rather than assuming every item in that snapshot still exists.

Ten initial checks could not reach App Runner or Lightsail endpoints in Regions where the
corresponding service is not listed as supported in the AWS endpoint references. The supplemental
scan had no errors. This is a broad service audit, not an exhaustive inventory of every AWS product.

## Restoration Notes

All 13 functions originally had no reserved concurrency limit. Re-enable an individual
function with the following, substituting its exact function name from the report:

```bash
aws lambda delete-function-concurrency \
  --region ap-south-1 \
  --function-name FUNCTION_NAME
```

Restore REST/HTTP endpoint settings and stage throttles from the endpoint report before
using the project again. Re-enabling Lambda alone will not restore the disabled API endpoints.
Removing the zero WebSocket throttle requires restoring the original stage settings; the
original stage had no explicit throttle limits.

The released public IP is not reserved anymore and cannot be assumed recoverable. Starting
Student OS again may require a new address and any necessary DNS/configuration updates.

These direct shutdown changes create drift from the CDK/CloudFormation definitions. A normal
no-change CDK deployment is not guaranteed to undo them. The old Elastic IP must not be treated
as an existing resource when restoring Student OS.

## AWS References

- [Lambda reserved concurrency: zero stops event processing](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [Stopped EC2 instances still have EBS storage costs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html)
- [App Runner supported endpoints](https://docs.aws.amazon.com/general/latest/gr/apprunner.html)
- [Lightsail supported endpoints](https://docs.aws.amazon.com/general/latest/gr/lightsail.html)
