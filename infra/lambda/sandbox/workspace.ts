import * as fs from 'fs';
import * as path from 'path';

const RELATIVE_IMPORT_PATTERN = /from ['"](\.\.?\/[^'"]+)['"]/g;

export const resolveSandboxEntryPoint = (
  code: string,
  files?: Record<string, string>,
): string => {
  if (files?.['bin/app.ts']) {
    return 'bin/app.ts';
  }

  if (files?.['app.ts']) {
    return 'app.ts';
  }

  return 'app.ts';
};

const resolveImportCandidates = (
  entryRelative: string,
  importPath: string,
): string[] => {
  const entryDir = path.posix.dirname(entryRelative);
  const resolved = path.posix.normalize(path.posix.join(entryDir, importPath));

  return [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}/index.ts`,
  ];
};

/**
 * Defensive guard for *generated-code* relative imports (e.g. `from '../lib/my-stack'`).
 *
 * Unrelated to the historical CDK-CLI failure where `.bin/cdk` / `.bin/ts-node`
 * symlinks broke `require("../lib")` inside those packages. That bug is fixed by
 * invoking `aws-cdk/bin/cdk` and `ts-node/dist/bin.js` directly from the layer.
 *
 * This helper only rejects LLM output that imports companion files that were not
 * provided in the optional `files` map. Legitimate single-file self-contained
 * stacks (package imports only: `aws-cdk-lib`, `constructs`) return [].
 */
export const detectMissingRelativeImports = (
  code: string,
  files?: Record<string, string>,
): string[] => {
  const entryRelative = resolveSandboxEntryPoint(code, files);
  const availablePaths = new Set(Object.keys(files ?? {}));
  availablePaths.add(entryRelative);

  const missing: string[] = [];

  for (const match of code.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const importPath = match[1];
    const candidates = resolveImportCandidates(entryRelative, importPath);

    if (!candidates.some((candidate) => availablePaths.has(candidate))) {
      missing.push(importPath);
    }
  }

  return [...new Set(missing)];
};

export const writeWorkspaceFiles = (
  tmpDir: string,
  code: string,
  layerNodeModules: string,
  files?: Record<string, string>,
): string => {
  const writtenPaths = new Set<string>();

  if (files) {
    for (const [relativePath, fileContent] of Object.entries(files)) {
      const target = path.join(tmpDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fileContent);
      writtenPaths.add(relativePath);
    }
  }

  const entryRelative = resolveSandboxEntryPoint(code, files);

  if (!writtenPaths.has(entryRelative)) {
    const entryPath = path.join(tmpDir, entryRelative);
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, code);
  }

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
        include: ['**/*.ts'],
      },
      null,
      2,
    ),
  );

  return entryRelative;
};
