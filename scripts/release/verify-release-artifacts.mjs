import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyBuilderOutput } from './verify-builder-output.mjs';

export function createWindowsSignatureInvocation({
  installerPath,
  scriptPath,
  version,
  expectedPublisher,
  allowUnsigned = false,
  platform = process.platform,
}) {
  if (platform !== 'win32') {
    throw new Error('Windows signature verification requires Windows');
  }
  const publisherName = expectedPublisher?.trim();
  if (!allowUnsigned && !publisherName) {
    throw new Error('expectedPublisher is required for production signature verification');
  }
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-InstallerPath',
    installerPath,
    '-ExpectedVersion',
    version,
  ];
  if (allowUnsigned) {
    args.push('-AllowUnsigned');
  }
  if (publisherName) {
    args.push('-ExpectedPublisher', publisherName);
  }
  return {
    command: 'powershell.exe',
    args,
    options: {
      encoding: 'utf8',
      shell: false,
    },
  };
}

function runWindowsSignature(options) {
  const invocation = createWindowsSignatureInvocation(options);
  const result = spawnSync(invocation.command, invocation.args, invocation.options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || `exit code ${result.status}`;
    throw new Error(`Windows signature verification failed: ${detail}`);
  }
}

export async function verifyReleaseArtifacts({
  root = process.cwd(),
  allowUnsigned = false,
  env = process.env,
  verifyBuilder = verifyBuilderOutput,
  runSignature = runWindowsSignature,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const packageJson = JSON.parse(await readFile(path.join(resolvedRoot, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const expectedPublisher = env.COSSTAGE_WINDOWS_PUBLISHER_NAME?.trim();
  if (!allowUnsigned && !expectedPublisher) {
    throw new Error(
      'COSSTAGE_WINDOWS_PUBLISHER_NAME is required for production artifact verification',
    );
  }

  const result = await verifyBuilder({
    releaseDir: path.join(resolvedRoot, 'release'),
    version,
  });
  await runSignature({
    installerPath: result.installerPath,
    scriptPath: path.join(resolvedRoot, 'scripts/release/verify-windows-signature.ps1'),
    version,
    expectedPublisher,
    allowUnsigned,
  });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--allow-unsigned')) {
    throw new Error('usage: node verify-release-artifacts.mjs [--allow-unsigned]');
  }
  const allowUnsigned = args[0] === '--allow-unsigned';
  const result = await verifyReleaseArtifacts({ allowUnsigned });
  console.log(`release artifacts ${path.basename(result.installerPath)} are valid`);
}
