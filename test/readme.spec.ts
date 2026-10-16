import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const root = join(__dirname, '..');
const samplesDir = join(root, 'readme-samples');
const fenceOpening = /^```(typescript|ts)$/;
const uncompiledMarker = '<!-- fragment -->';
const importableFileHeader = /^\/\/ (\S+\.ts)$/;

interface Sample {
  readonly line: number;
  readonly fileName: string;
  readonly code: string;
}

function readmeSamples(): Sample[] {
  const lines = readFileSync(join(root, 'README.md'), 'utf8').split('\n');
  return lines.flatMap((line, index) => {
    if (!fenceOpening.test(line)) {
      return [];
    }
    if (lines[index - 1] === uncompiledMarker) {
      return [];
    }
    const code = lines.slice(index + 1, lines.indexOf('```', index + 1));
    const name = importableFileHeader.exec(code[0] ?? '')?.[1];
    return [
      {
        line: index + 2,
        fileName: join(samplesDir, name ?? `line-${index + 2}.ts`),
        code: code.join('\n'),
      },
    ];
  });
}

const nestStarterStrictOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2023,
  strict: true,
  isolatedModules: true,
  emitDecoratorMetadata: true,
  experimentalDecorators: true,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  types: ['node', 'jest'],
  paths: {
    '@vori/nestjs-secret-manager': [join(root, 'src/index.ts')],
    '@vori/nestjs-secret-manager/testing': [join(root, 'src/testing.ts')],
  },
};

function compile(samples: readonly Sample[]): readonly ts.Diagnostic[] {
  const sources = new Map(
    samples.map(({ fileName, code }) => [fileName, code]),
  );
  const host = ts.createCompilerHost(nestStarterStrictOptions);
  const { directoryExists, fileExists, readFile } = host;
  host.directoryExists = (path) =>
    path === samplesDir || (directoryExists?.call(host, path) ?? false);
  host.fileExists = (path) => sources.has(path) || fileExists.call(host, path);
  host.readFile = (path) => sources.get(path) ?? readFile.call(host, path);
  return ts.getPreEmitDiagnostics(
    ts.createProgram([...sources.keys()], nestStarterStrictOptions, host),
  );
}

function format(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  });
}

describe('README', () => {
  const samples = readmeSamples();
  let diagnostics: readonly ts.Diagnostic[];

  beforeAll(() => {
    diagnostics = compile(samples);
  }, 60_000);

  it.each(samples)('compiles the sample at line $line', ({ fileName }) => {
    expect(
      format(diagnostics.filter(({ file }) => file?.fileName === fileName)),
    ).toBe('');
  });

  it('compiles the package beneath the samples', () => {
    const sampleFiles = new Set(samples.map(({ fileName }) => fileName));
    expect(
      format(
        diagnostics.filter(
          ({ file }) => file === undefined || !sampleFiles.has(file.fileName),
        ),
      ),
    ).toBe('');
  });
});
