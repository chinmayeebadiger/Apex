const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const exec = promisify(execFile);
async function aws(args) {
  const { stdout } = await exec('aws', [...args, '--output', 'json'], {
    env: { ...process.env, AWS_PAGER: '' }, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
async function main() {
  const identity = await aws(['sts', 'get-caller-identity']);
  if (identity.Account !== '437040615496') throw new Error('Unexpected account');
  const region = 'ap-south-1';
  const records = [];
  const save = () => {
    fs.mkdirSync('output', { recursive: true });
    fs.writeFileSync('output/aws-endpoints-shutdown-2026-10-12.json', JSON.stringify(records, null, 2));
  };
  const rest = await aws(['apigateway', 'get-rest-apis', '--region', region]);
  for (const api of rest.items || []) {
    const stages = await aws(['apigateway', 'get-stages', '--region', region, '--rest-api-id', api.id]);
    const record = { type: 'REST', api, stages, disabled: false };
    records.push(record); save();
    await aws(['apigateway', 'update-rest-api', '--region', region, '--rest-api-id', api.id,
      '--patch-operations', JSON.stringify([{ op: 'replace', path: '/disableExecuteApiEndpoint', value: 'true' }])]);
    for (const stage of stages.item || []) {
      await aws(['apigateway', 'create-deployment', '--region', region, '--rest-api-id', api.id,
        '--stage-name', stage.stageName, '--description', 'Account shutdown: disable public execution endpoint']);
    }
    record.disabled = true; save();
    console.log(JSON.stringify({ api: api.id, disabled: true }));
  }
  const v2 = await aws(['apigatewayv2', 'get-apis', '--region', region]);
  for (const api of v2.Items || []) {
    const stages = await aws(['apigatewayv2', 'get-stages', '--region', region, '--api-id', api.ApiId]);
    const record = { type: api.ProtocolType, api, stages, disabled: false };
    records.push(record); save();
    if (api.ProtocolType === 'HTTP') {
      await aws(['apigatewayv2', 'update-api', '--region', region, '--api-id', api.ApiId, '--disable-execute-api-endpoint']);
    }
    for (const stage of stages.Items || []) {
      await aws(['apigatewayv2', 'update-stage', '--region', region, '--api-id', api.ApiId,
        '--stage-name', stage.StageName,
        '--default-route-settings', JSON.stringify({ ThrottlingBurstLimit: 0, ThrottlingRateLimit: 0 })]);
    }
    record.disabled = true; save();
    console.log(JSON.stringify({ api: api.ApiId, disabled: true }));
  }
  const buckets = await aws(['s3api', 'list-buckets', '--query', 'Buckets[].Name']);
  for (const bucket of buckets) {
    let website;
    try {
      website = await aws(['s3api', 'get-bucket-website', '--bucket', bucket]);
    } catch (error) {
      if (String(error.stderr).includes('NoSuchWebsiteConfiguration')) continue;
      throw error;
    }
    let publicAccessBlock;
    try {
      publicAccessBlock = await aws(['s3api', 'get-public-access-block', '--bucket', bucket]);
    } catch (error) {
      if (!String(error.stderr).includes('NoSuchPublicAccessBlockConfiguration')) throw error;
      publicAccessBlock = null;
    }
    const record = { type: 'S3Website', bucket, website, publicAccessBlock, disabled: false };
    records.push(record); save();
    await aws(['s3api', 'delete-bucket-website', '--bucket', bucket]);
    await aws(['s3api', 'put-public-access-block', '--bucket', bucket,
      '--public-access-block-configuration', JSON.stringify({ BlockPublicAcls: true, IgnorePublicAcls: true,
        BlockPublicPolicy: true, RestrictPublicBuckets: true })]);
    record.disabled = true; save();
    console.log(JSON.stringify({ bucket, websiteDisabled: true }));
  }
}
main().catch(error => { console.error(error.stderr || error.message); process.exitCode = 1; });
