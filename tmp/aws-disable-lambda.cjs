const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const exec = promisify(execFile);
async function aws(args) {
  const { stdout } = await exec('aws', [...args, '--output', 'json'], {
    env: { ...process.env, AWS_PAGER: '' }, timeout: 45000,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
async function main() {
  const identity = await aws(['sts', 'get-caller-identity']);
  if (identity.Account !== '437040615496') throw new Error('Unexpected account');
  const region = process.argv[2];
  if (!region) throw new Error('Region required');
  const names = await aws(['lambda', 'list-functions', '--region', region, '--query', 'Functions[].FunctionName']);
  const results = [];
  // Keep each function's original concurrency settings for restoration.
  for (const name of names) {
    try {
      const original = await aws(['lambda', 'get-function-concurrency', '--region', region, '--function-name', name]);
      const provisioned = await aws(['lambda', 'list-provisioned-concurrency-configs', '--region', region, '--function-name', name]);
      const record = { region, name, original, provisioned, disabled: false };
      results.push(record);
      fs.mkdirSync('output', { recursive: true });
      const save = () => fs.writeFileSync(`output/aws-lambda-shutdown-${region}-2026-10-12.json`, JSON.stringify(results, null, 2));
      save();
      for (const config of provisioned.ProvisionedConcurrencyConfigs || []) {
        await aws(['lambda', 'delete-provisioned-concurrency-config', '--region', region, '--function-name', name,
          '--qualifier', config.FunctionArn.split(':').at(-1)]);
      }
      await aws(['lambda', 'put-function-concurrency', '--region', region, '--function-name', name,
        '--reserved-concurrent-executions', '0']);
      const verified = await aws(['lambda', 'get-function-concurrency', '--region', region, '--function-name', name]);
      if (verified.ReservedConcurrentExecutions !== 0) throw new Error('Concurrency verification failed');
      record.disabled = true;
      save();
      console.log(JSON.stringify({ name, disabled: true }));
    } catch (error) {
      console.error(JSON.stringify({ name, error: error.stderr || error.message }));
      process.exitCode = 1;
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
