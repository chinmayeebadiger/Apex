import { execFileSync, ExecFileSyncOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface SandboxEvent {
  code: string;
}

interface SandboxSuccess {
  success: true;
  template: unknown;
}

interface SandboxFailure {
  success: false;
  error: string;
  stderr: string;
}

type SandboxResponse = SandboxSuccess | SandboxFailure;

const EXEC_TIMEOUT_MS = 50_000;
const DEFAULT_LAYER_NODE_MODULES = '/opt/nodejs/node_modules';
const layerNodeModules = process.env.SANDBOX_NODE_MODULES_PATH ?? DEFAULT_LAYER_NODE_MODULES;
const layerBin = path.join(layerNodeModules, '.bin');
const cdkCli = path.join(layerBin, 'cdk');
const tsNodeCli = path.join(layerBin, 'ts-node');

const EXEC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CDK_DEFAULT_ACCOUNT: '000000000000',
  CDK_DEFAULT_REGION: 'ap-south-1',
  NODE_PATH: [layerNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  PATH: [layerBin, process.env.PATH].filter(Boolean).join(path.delimiter),
};

const EXEC_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  timeout: EXEC_TIMEOUT_MS,
  stdio: 'pipe',
  encoding: 'utf-8',
  env: EXEC_ENV,
};

const getExecStderr = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string') {
      return stderr;
    }
  }

  return '';
};

const writeWorkspaceFiles = (tmpDir: string, code: string): void => {
  fs.writeFileSync(path.join(tmpDir, 'app.ts'), code);
  fs.symlinkSync(layerNodeModules, path.join(tmpDir, 'node_modules'), 'dir');

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ private: true }, null, 2),
  );

  fs.writeFileSync(
    path.join(tmpDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  );
};

const readFirstTemplate = (cdkOutDir: string): unknown => {
  const templateFile = fs
    .readdirSync(cdkOutDir)
    .find((fileName) => fileName.endsWith('.template.json'));

  if (!templateFile) {
    throw new Error('No CloudFormation template found in cdk.out');
  }

  const templateContents = fs.readFileSync(path.join(cdkOutDir, templateFile), 'utf-8');
  return JSON.parse(templateContents) as unknown;
};

export const handler = async (event: SandboxEvent): Promise<SandboxResponse> => {
  if (!event.code) {
    return {
      success: false,
      error: 'code is required',
      stderr: '',
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-sandbox-'));

  try {
    writeWorkspaceFiles(tmpDir, event.code);

    execFileSync(cdkCli, [
      'synth',
      '--app',
      `${tsNodeCli} app.ts`,
      '--output',
      './cdk.out',
      '--quiet',
    ], {
      ...EXEC_OPTIONS,
      cwd: tmpDir,
    });

    const template = readFirstTemplate(path.join(tmpDir, 'cdk.out'));

    return {
      success: true,
      template,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sandbox error';

    return {
      success: false,
      error: message,
      stderr: getExecStderr(error),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
