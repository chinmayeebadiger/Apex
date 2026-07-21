import { execFileSync, ExecFileSyncOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectMissingRelativeImports,
  writeWorkspaceFiles,
} from './workspace';

interface SandboxEvent {
  code: string;
  files?: Record<string, string>;
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
// Invoke real package entry files (not .bin symlinks). Lambda layer packaging can
// dereference or flatten .bin links so require("../lib") inside cdk/ts-node breaks;
// node <pkg>/bin/... keeps the script realpath under the package tree.
const cdkBin = path.join(layerNodeModules, 'aws-cdk', 'bin', 'cdk');
const tsNodeBin = path.join(layerNodeModules, 'ts-node', 'dist', 'bin.js');

const EXEC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CDK_DEFAULT_ACCOUNT: '000000000000',
  CDK_DEFAULT_REGION: 'ap-south-1',
  NODE_PATH: [layerNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
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

  const missingImports = detectMissingRelativeImports(event.code, event.files);
  if (missingImports.length > 0) {
    return {
      success: false,
      error: `Generated code imports missing files: ${missingImports.join(', ')}. Regenerate as a single self-contained app.ts or include the files map.`,
      stderr: '',
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-sandbox-'));

  try {
    const entryRelative = writeWorkspaceFiles(
      tmpDir,
      event.code,
      layerNodeModules,
      event.files,
    );

    execFileSync('node', [
      cdkBin,
      'synth',
      '--app',
      `node ${tsNodeBin} ${entryRelative}`,
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
