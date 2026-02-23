/// <reference types="@cloudflare/workers-types" />
import { env as workerEnv } from 'cloudflare:workers';
import { getSandbox, proxyTerminal, proxyToSandbox, type Sandbox } from '@cloudflare/sandbox';
import { exampleById, sessionById, type ExampleId, type SessionId } from './workshop';
import type { ExampleRunResult, SessionRunResult, TerminalBootstrapResult } from './types';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  AI: Ai;
  ASSETS: {
    fetch: (request: Request | URL | string, init?: RequestInit) => Promise<Response>;
  };
};

type ExampleRequestBody = {
  input?: string;
  prompt?: string;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const LOCAL_PREVIEW_PROXY_PREFIX = '/__sandbox_preview';
const env = workerEnv as unknown as Env;

function isLikelyPreviewHostname(hostname: string): boolean {
  return /^\d+-/.test(hostname) && hostname.endsWith('.localhost');
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
}

function splitHostAndPort(hostValue: string): { hostname: string; port?: string } {
  const [hostname, port] = hostValue.split(':');
  return { hostname, port };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const localPreviewProxyResponse = await handleLocalPreviewProxyRoute(request, url);
    if (localPreviewProxyResponse) return localPreviewProxyResponse;

    const hostHeader = request.headers.get('host') ?? '';
    const { hostname: hostHeaderName } = splitHostAndPort(hostHeader);
    const previewCandidate = isLikelyPreviewHostname(url.hostname) || isLikelyPreviewHostname(hostHeaderName);
    if (url.pathname === '/') {
      console.log(
        `[proxy-debug] root request urlHost=${url.host} hostHeader=${hostHeader} method=${request.method} referer=${request.headers.get('referer') ?? ''} accept=${request.headers.get('accept') ?? ''}`
      );
    }
    if (previewCandidate) {
      console.log(
        `[proxy-debug] incoming preview candidate urlHost=${url.host} hostHeader=${hostHeader} path=${url.pathname} method=${request.method}`
      );
    }

    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) {
      if (previewCandidate) {
        console.log(`[proxy-debug] proxyToSandbox matched host=${url.host} path=${url.pathname}`);
      }
      return proxyResponse;
    }

    if (!isLikelyPreviewHostname(url.hostname) && isLikelyPreviewHostname(hostHeaderName)) {
      const rewrittenUrl = new URL(request.url);
      rewrittenUrl.hostname = hostHeaderName;
      const { port } = splitHostAndPort(hostHeader);
      if (port) rewrittenUrl.port = port;

      const retryResponse = await proxyToSandbox(new Request(rewrittenUrl.toString(), request), env);
      if (retryResponse) {
        console.log(
          `[proxy-debug] proxyToSandbox matched after host-header rewrite host=${rewrittenUrl.host} path=${rewrittenUrl.pathname}`
        );
        return retryResponse;
      }
    }

    if (previewCandidate) {
      console.warn(
        `[proxy-debug] proxyToSandbox did not match urlHost=${url.host} hostHeader=${hostHeader} path=${url.pathname} accept=${request.headers.get('accept') ?? ''} sec-fetch-dest=${request.headers.get('sec-fetch-dest') ?? ''}; returning debug response`
      );
      return json(
        {
          ok: false,
          message: 'Preview-host request was not proxied to sandbox.',
          debug: {
            url: request.url,
            method: request.method,
            hostHeader,
            pathname: url.pathname,
            search: url.search,
            accept: request.headers.get('accept') ?? null,
            secFetchDest: request.headers.get('sec-fetch-dest') ?? null,
            referer: request.headers.get('referer') ?? null
          }
        },
        502
      );
    }


    if (url.pathname === '/ws/terminal') {
      return await handleTerminalWebSocket(request, url);
    }

    if (url.pathname === '/api/terminal/bootstrap') {
      return await handleTerminalBootstrap();
    }

    if (url.pathname.startsWith('/api/sessions/')) {
      return await handleSessionRequest(url);
    }

    if (url.pathname.startsWith('/api/examples/')) {
      return await handleExampleRequest(request, url);
    }

    return await serveSpaAssets(request);
  }
};

async function handleExampleRequest(request: Request, url: URL): Promise<Response> {
  if (url.pathname === '/api/examples/ai-generated-code/generate') {
    return await handleAiCodeGeneration(request);
  }

  const id = url.pathname.replace('/api/examples/', '') as ExampleId;
  const example = exampleById[id];

  if (!example) {
    return json(
      {
        ok: false,
        message: `Unknown example id: ${id}`
      },
      404
    );
  }

  try {
    const body = request.method === 'POST' ? ((await request.json()) as ExampleRequestBody) : undefined;
    const result = await runExample(id, body?.input, body?.prompt, request);
    return json(result);
  } catch (error) {
    return json(
      {
        ok: false,
        exampleId: id,
        message: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

async function handleAiCodeGeneration(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed' }, 405);
  }

  const body = (await request.json()) as ExampleRequestBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
    return json({ ok: false, message: 'Prompt is required.' }, 400);
  }

  const code = await generatePythonFromPrompt(prompt);
  return json({
    ok: true,
    prompt,
    code
  });
}

async function generatePythonFromPrompt(prompt: string): Promise<string> {
  const model = '@cf/zai-org/glm-4.7-flash' as unknown as keyof AiModels;
  const system = [
    'You generate Python scripts for an educational Cloudflare Sandbox workshop.',
    'Return only Python code, no markdown fences.',
    'Keep it short (15-40 lines), clear, safe, and runnable in a sandbox.',
    'Prefer standard library only unless user explicitly asks otherwise.',
    'Always print observable output for workshop participants.'
  ].join(' ');

  const aiResponse = await env.AI.run(model, {
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Create a Python script for this request:\n${prompt}\n\nReturn only raw Python code.`
      }
    ]
  });

  const raw =
    extractText(aiResponse) ??
    `# Fallback generated script
prompt = ${JSON.stringify(prompt)}
print('Prompt:', prompt)
print('Length:', len(prompt))`;

  return sanitizePython(raw);
}

async function generateDataAnalysisCode(question: string, csvStructure: string): Promise<string> {
  const model = '@cf/zai-org/glm-4.7-flash' as unknown as keyof AiModels;
  const system = [
    'You write production-quality Python data analysis scripts for Cloudflare Sandbox demos.',
    'Return only raw Python code with no markdown fences.',
    'Use pandas and optionally matplotlib/numpy.',
    'Read data from /workspace/data/input.csv.',
    'Answer the user question clearly in printed output.',
    'If a chart helps, save it to /workspace/data/chart.png.'
  ].join(' ');

  const aiResponse = await env.AI.run(model, {
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Dataset structure JSON:
${csvStructure}

Analysis question:
${question}

Generate complete Python code now.`
      }
    ]
  });

  const fallbackCode = buildDataAnalysisFallbackCode(question);

  return sanitizePython(extractText(aiResponse) ?? fallbackCode);
}

function extractText(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;

  if (typeof record.response === 'string') return record.response;

  const result = record.result as Record<string, unknown> | undefined;
  if (result && typeof result.response === 'string') return result.response;

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') return message.content;
  }

  return undefined;
}

function sanitizePython(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.includes('```')) return trimmed;

  const withoutFences = trimmed
    .replace(/^```python\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  return withoutFences || trimmed;
}

function stripBlockingPatterns(code: string): string {
  let output = code;
  output = output.replace(/^\s*plt\.show\(\)\s*$/gm, '# plt.show() removed for non-interactive sandbox run');
  output = output.replace(/^\s*input\(.+\)\s*$/gm, '# input(...) removed for non-interactive sandbox run');
  output = output.replace(/^\s*time\.sleep\(.+\)\s*$/gm, '# time.sleep(...) removed to avoid long blocking runs');
  return output;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function inferCsvValueType(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'string';
  if (/^-?\d+$/.test(normalized)) return 'int64';
  if (/^-?\d+\.\d+$/.test(normalized)) return 'float64';
  if (/^(true|false)$/i.test(normalized)) return 'bool';
  return 'string';
}

function buildCsvStructure(csv: string): string {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return JSON.stringify({ rows: 0, columns: [], dtypes: {}, sample: [] });
  }

  const columns = lines[0].split(',').map((column) => column.trim());
  const records = lines.slice(1).map((line) => line.split(',').map((cell) => cell.trim()));

  const sample = records.slice(0, 3).map((row) =>
    Object.fromEntries(columns.map((column, idx) => [column, row[idx] ?? '']))
  );

  const dtypes = Object.fromEntries(
    columns.map((column, idx) => {
      const firstPopulated = records.map((row) => row[idx] ?? '').find((value) => value.trim().length > 0) ?? '';
      return [column, inferCsvValueType(firstPopulated)];
    })
  );

  return JSON.stringify({
    rows: records.length,
    columns,
    dtypes,
    sample
  });
}

function buildDataAnalysisFallbackCode(question: string): string {
  return `import pandas as pd

df = pd.read_csv('/workspace/data/input.csv')
print("Analysis question:", ${JSON.stringify(question)})
print("Rows:", len(df))
print("Columns:", list(df.columns))

numeric_df = df.select_dtypes(include=['number'])
if numeric_df.empty:
  print("No numeric columns found. Showing sample rows:")
  print(df.head(10).to_string(index=False))
else:
  summary = numeric_df.describe().transpose().sort_values(by='mean', ascending=False)
  print("Numeric summary (sorted by mean):")
  print(summary.to_string())

if 'region' in df.columns:
  numeric_cols = [c for c in df.columns if c != 'region' and pd.api.types.is_numeric_dtype(df[c])]
  if numeric_cols:
    grouped = df.groupby('region', dropna=False)[numeric_cols].mean().sort_values(by=numeric_cols[0], ascending=False)
    print("")
    print("Average metrics by region:")
    print(grouped.to_string())
  else:
    print("No numeric metrics available to aggregate by region.")
`;
}

function buildDataAnalysisExecutionFallbackCode(question: string): string {
  return `import csv
from collections import defaultdict

question = ${JSON.stringify(question)}
print("Analysis question:", question)

with open('/workspace/data/input.csv', newline='') as f:
  reader = csv.DictReader(f)
  rows = list(reader)

print("Rows:", len(rows))
print("Columns:", reader.fieldnames or [])

if not rows:
  print("No data rows found.")
  raise SystemExit(0)

numeric_columns = []
for name in (reader.fieldnames or []):
  values = []
  for row in rows:
    raw = (row.get(name) or "").strip()
    if not raw:
      continue
    try:
      values.append(float(raw))
    except ValueError:
      values = []
      break
  if values:
    numeric_columns.append((name, values))

if numeric_columns:
  print("Numeric column means:")
  means = []
  for name, values in numeric_columns:
    mean = sum(values) / len(values)
    means.append((name, mean))
    print(f"- {name}: {mean:.4f}")
  means.sort(key=lambda item: item[1], reverse=True)
  print("Top mean column:", means[0][0])
else:
  print("No numeric columns detected.")

if 'region' in (reader.fieldnames or []):
  grouped = defaultdict(lambda: defaultdict(list))
  for row in rows:
    region = row.get('region', 'unknown')
    for name, _ in numeric_columns:
      raw = (row.get(name) or "").strip()
      if not raw:
        continue
      try:
        grouped[region][name].append(float(raw))
      except ValueError:
        pass
  if grouped:
    print("")
    print("Averages by region:")
    for region, metrics in grouped.items():
      parts = []
      for name, values in metrics.items():
        if values:
          parts.append(f"{name}={sum(values)/len(values):.3f}")
      print(f"- {region}: " + (", ".join(parts) if parts else "no numeric metrics"))
`;
}

async function generateChartArtifact(sandbox: Sandbox): Promise<void> {
  const chartScript = `import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('/workspace/data/input.csv')
numeric = df.select_dtypes(include=['number'])

plt.figure(figsize=(8, 4.5))

if numeric.shape[1] >= 2:
  x_col = numeric.columns[0]
  y_col = numeric.columns[1]
  if 'region' in df.columns:
    for _, row in df.iterrows():
      plt.scatter(row[x_col], row[y_col])
      plt.annotate(str(row['region']), (row[x_col], row[y_col]), fontsize=8, alpha=0.8)
    plt.title(f'{y_col} vs {x_col} by region')
    plt.xlabel(x_col)
    plt.ylabel(y_col)
  else:
    plt.plot(numeric[x_col], numeric[y_col], marker='o')
    plt.title(f'{y_col} vs {x_col}')
    plt.xlabel(x_col)
    plt.ylabel(y_col)
elif numeric.shape[1] == 1:
  col = numeric.columns[0]
  numeric[col].plot(kind='bar')
  plt.title(f'{col} by row')
  plt.xlabel('row')
  plt.ylabel(col)
else:
  counts = df.count()
  counts.plot(kind='bar')
  plt.title('Non-empty values by column')
  plt.xlabel('column')
  plt.ylabel('count')

plt.tight_layout()
plt.savefig('/workspace/data/chart.png', dpi=140)
print('Saved chart to /workspace/data/chart.png')
`;

  await sandbox.writeFile('/workspace/data/chart.py', chartScript);
  await withTimeout(
    sandbox.exec('python3 /workspace/data/chart.py', { timeout: 20000 }),
    25000,
    'Chart generation'
  );
}

function normalizeLocalPreviewUrl(exposedUrl: string, requestUrl: string): string {
  const request = new URL(requestUrl);
  const preview = new URL(exposedUrl);
  const requestIsLocal = isLocalHostname(request.hostname);
  const previewIsLocal = isLocalHostname(preview.hostname);
  if (!requestIsLocal || !previewIsLocal) return exposedUrl;

  // Keep sandbox preview host and align protocol/port with current server origin.
  preview.protocol = request.protocol;
  if (request.port) preview.port = request.port;
  return preview.toString();
}

function forcePreviewIndexUrl(previewUrl: string): string {
  const url = new URL(previewUrl);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/index.html';
  }
  return url.toString();
}

function buildLocalPreviewFallbackUrl(previewUrl: string, requestUrl: string): string | undefined {
  const request = new URL(requestUrl);
  const preview = new URL(previewUrl);

  if (!isLocalHostname(request.hostname) || !isLocalHostname(preview.hostname)) return undefined;

  const fallback = new URL(request.origin);
  const encodedHost = encodeURIComponent(preview.host);
  fallback.pathname = `${LOCAL_PREVIEW_PROXY_PREFIX}/${encodedHost}${preview.pathname}`;
  fallback.search = preview.search;
  return fallback.toString();
}

async function handleLocalPreviewProxyRoute(
  request: Request,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith(`${LOCAL_PREVIEW_PROXY_PREFIX}/`)) return null;

  const rest = url.pathname.slice(`${LOCAL_PREVIEW_PROXY_PREFIX}/`.length);
  const slashIndex = rest.indexOf('/');
  const encodedHost = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const proxiedPath = slashIndex === -1 ? '/index.html' : rest.slice(slashIndex);
  const previewHost = decodeURIComponent(encodedHost);

  const proxyTarget = new URL(request.url);
  proxyTarget.host = previewHost;
  proxyTarget.pathname = proxiedPath || '/index.html';
  proxyTarget.search = url.search;

  const proxyResponse = await proxyToSandbox(new Request(proxyTarget.toString(), request), env);
  if (proxyResponse) return proxyResponse;

  return json(
    {
      ok: false,
      message: 'Local preview fallback route did not resolve through proxyToSandbox.',
      debug: {
        requestUrl: request.url,
        previewHost,
        proxiedPath,
        proxyTarget: proxyTarget.toString()
      }
    },
    502
  );
}

async function runExample(
  id: ExampleId,
  input: string | undefined,
  prompt: string | undefined,
  request: Request
): Promise<ExampleRunResult> {
  switch (id) {
    case 'ai-generated-code':
      return await runAiGeneratedCode(input);
    case 'data-analysis':
      return await runDataAnalysis(input, prompt);
    case 'interactive-dev':
      return await runInteractiveDevPreview(request);
    case 'ci-testing':
      return await runCiTesting();
    case 'security-untrusted':
      return await runUntrustedCode(input);
  }
}

async function handleSessionRequest(url: URL): Promise<Response> {
  const id = url.pathname.replace('/api/sessions/', '') as SessionId;
  const session = sessionById[id];

  if (!session) {
    return json({ ok: false, message: `Unknown session id: ${id}` }, 404);
  }

  try {
    const result = await runSession(id, url);
    return json(result);
  } catch (error) {
    return json(
      {
        ok: false,
        sessionId: id,
        message: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

async function runSession(id: SessionId, url: URL): Promise<SessionRunResult> {
  switch (id) {
    case 'fundamentals':
      return await runSessionFundamentals();
    case 'executing-code': {
      const result = await runAiGeneratedCode(`print("hello from python")
print("sandbox fundamentals are reusable")`);
      return {
        ok: result.ok,
        sessionId: id,
        sandboxId: result.sandboxId,
        summary: sessionById[id].resultSummary,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode
      };
    }
    case 'data-workflows': {
      const result = await runDataAnalysis(undefined, 'What trends stand out by region?');
      return {
        ok: result.ok,
        sessionId: id,
        sandboxId: result.sandboxId,
        summary: sessionById[id].resultSummary,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode,
        details: result.details
      };
    }
    case 'preview-workflows': {
      const fakeRequest = new Request(url.toString());
      const result = await runInteractiveDevPreview(fakeRequest);
      return {
        ok: result.ok,
        sessionId: id,
        sandboxId: result.sandboxId,
        summary: sessionById[id].resultSummary,
        previewUrl: result.previewUrl,
        details: result.details,
        exitCode: result.exitCode
      };
    }
    case 'automation-ci': {
      const result = await runCiTesting();
      return {
        ok: result.ok,
        sessionId: id,
        sandboxId: result.sandboxId,
        summary: sessionById[id].resultSummary,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode
      };
    }
  }
}

async function runSessionFundamentals(): Promise<SessionRunResult> {
  const sandboxId = 'workshop-session-fundamentals';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });
  const command = `echo "Session 1: Sandbox Fundamentals" && uname -a && echo "cwd: $(pwd)" && ls -1 /workspace | head -20`;
  const result = await sandbox.exec(command);

  return {
    ok: result.success,
    sessionId: 'fundamentals',
    sandboxId,
    summary: sessionById.fundamentals.resultSummary,
    output: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

async function handleTerminalBootstrap(): Promise<Response> {
  const sandboxId = 'workshop-terminal';
  const terminalSessionId = 'live-terminal';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  let session;
  try {
    session = await sandbox.getSession(terminalSessionId);
  } catch {
    session = await sandbox.createSession({
      id: terminalSessionId,
      cwd: '/workspace',
      env: {
        WORKSHOP: 'thinking-in-sandboxes'
      }
    });
    await session.exec(
      `echo "Connected to Cloudflare Sandbox PTY session" && echo "Try: pwd, ls, python3 --version"`
    );
  }

  const response: TerminalBootstrapResult = {
    ok: true,
    sandboxId,
    sessionId: terminalSessionId,
    summary: 'Terminal session ready.'
  };

  return json(response);
}

async function handleTerminalWebSocket(request: Request, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ ok: false, message: 'WebSocket upgrade required.' }, 426);
  }

  const sandboxId = url.searchParams.get('id');
  const sessionId = url.searchParams.get('session');
  const cols = positiveInt(url.searchParams.get('cols')) ?? 120;
  const rows = positiveInt(url.searchParams.get('rows')) ?? 30;

  if (!sandboxId) {
    return json({ ok: false, message: 'Missing required query param: id' }, 400);
  }

  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });
  const targetSession = sessionId ?? 'default';

  if (sessionId) {
    try {
      await sandbox.getSession(sessionId);
    } catch {
      await sandbox.createSession({ id: sessionId, cwd: '/workspace' });
    }
  }

  return await proxyTerminal(sandbox, targetSession, request, { cols, rows });
}

async function runAiGeneratedCode(input: string | undefined): Promise<ExampleRunResult> {
  const sandboxId = 'workshop-ai-generated-code';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  const context = await sandbox.createCodeContext({
    language: 'python',
    envVars: { WORKSHOP: 'thinking-in-sandboxes' }
  });

  const code =
    input?.trim() ||
    `numbers = [4, 8, 15, 16, 23, 42]
print("count:", len(numbers))
print("sum:", sum(numbers))`;

  const run = await sandbox.runCode(code, { context });
  const logLines = [...run.logs.stdout, ...run.logs.stderr];
  const resultLines = run.results.flatMap((result) => {
    const lines: string[] = [];
    if (result.text) lines.push(result.text);
    if (result.markdown) lines.push(result.markdown);
    if (result.json) lines.push(JSON.stringify(result.json));
    return lines;
  });
  const combinedOutput = [...logLines, ...resultLines].join('\n');

  return {
    ok: !run.error,
    exampleId: 'ai-generated-code',
    sandboxId,
    summary: run.error
      ? (exampleById['ai-generated-code'].messages?.failureSummary ?? 'Code execution returned an interpreter error.')
      : (exampleById['ai-generated-code'].messages?.successSummary ?? 'Code executed in isolated context.'),
    output: combinedOutput,
    stderr: run.error ? JSON.stringify(run.error, null, 2) : undefined,
    exitCode: run.error ? 1 : 0,
    details: run.results
  };
}

async function runDataAnalysis(
  input: string | undefined,
  prompt: string | undefined
): Promise<ExampleRunResult> {
  const sandboxId = 'workshop-data-analysis';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });
  const question = prompt?.trim() || 'Which region has the strongest revenue and user efficiency trends?';

  const csv =
    input?.trim() ||
    `region,revenue,users
us-east,1200,34
us-west,980,27
eu-central,1430,42
apac,870,24`;

  await sandbox.mkdir('/workspace/data', { recursive: true });
  await sandbox.writeFile('/workspace/data/input.csv', `${csv}\n`);

  const csvStructure = buildCsvStructure(csv);

  let generatedCode = '';
  let usedAiFallback = false;
  try {
    generatedCode = await withTimeout(
      generateDataAnalysisCode(question, csvStructure),
      35000,
      'Workers AI analysis code generation'
    );
  } catch {
    usedAiFallback = true;
    generatedCode = buildDataAnalysisFallbackCode(question);
  }
  const runnableCode = stripBlockingPatterns(generatedCode);
  await sandbox.writeFile('/workspace/data/analyze.py', runnableCode);

  let result;
  let usedExecutionFallback = false;
  try {
    result = await withTimeout(
      sandbox.exec('python3 /workspace/data/analyze.py', { timeout: 45000 }),
      50000,
      'Analysis script execution'
    );
  } catch {
    usedExecutionFallback = true;
    const emergencyCode = buildDataAnalysisExecutionFallbackCode(question);
    await sandbox.writeFile('/workspace/data/analyze-fallback.py', emergencyCode);
    result = await sandbox.exec('python3 /workspace/data/analyze-fallback.py', { timeout: 15000 });
  }

  let chartGenerationMessage = 'Chart generation skipped.';
  try {
    await generateChartArtifact(sandbox);
    chartGenerationMessage = 'Chart visualization saved to /workspace/data/chart.png';
  } catch (error) {
    chartGenerationMessage = `Chart generation failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  let chartDataUri: string | undefined;
  let chartBytes: number | undefined;
  try {
    const chartFile = await sandbox.readFile('/workspace/data/chart.png');
    chartBytes =
      chartFile.encoding === 'base64'
        ? Math.floor((chartFile.content.length * 3) / 4)
        : chartFile.content.length;
    const chartBase64 =
      chartFile.encoding === 'base64' ? chartFile.content : btoa(chartFile.content);
    chartDataUri = `data:image/png;base64,${chartBase64}`;
  } catch {
    // Chart is optional for this flow.
  }

  return {
    ok: result.success,
    exampleId: 'data-analysis',
    sandboxId,
    summary: result.success
      ? usedAiFallback
        ? usedExecutionFallback
          ? 'Analysis completed with AI and execution fallbacks (timeout recovery).'
          : 'Pandas analysis completed in sandbox using fallback script (AI timeout).'
        : usedExecutionFallback
          ? 'Analysis completed using execution fallback script (timeout recovery).'
          : 'AI-generated pandas analysis completed in sandbox.'
      : (exampleById['data-analysis'].messages?.failureSummary ??
        'AI-generated analysis failed. Review stderr output.'),
    output: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    details: {
      question,
      generatedCode: runnableCode,
      usedAiFallback,
      usedExecutionFallback,
      csvStructure,
      chartGenerationMessage,
      chartBytes,
      chartDataUri
    }
  };
}

async function runInteractiveDevPreview(request: Request): Promise<ExampleRunResult> {
  const sandboxId = 'workshop-interactive-dev';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  await sandbox.mkdir('/workspace/preview', { recursive: true });
  await sandbox.writeFile(
    '/workspace/preview/index.html',
    `<!doctype html>
<html><head><meta charset="utf-8" /><title>Sandbox Preview</title></head>
<body style="font-family: ui-monospace, monospace; padding: 2rem;">
<h1>Interactive Preview Running</h1>
<p>This page is served from a Cloudflare Sandbox process.</p>
</body></html>`
  );

  try {
    await sandbox.getProcess('preview-server');
  } catch {
    const process = await sandbox.startProcess('python3 -m http.server 8080 --directory /workspace/preview', {
      processId: 'preview-server'
    });
    await process.waitForPort(8080);
  }

  const requestUrl = new URL(request.url);
  const isLocalHost = isLocalHostname(requestUrl.hostname);
  const currentPort = requestUrl.port;
  const exposedHostname = isLocalHost
    ? currentPort
      ? `${requestUrl.hostname}:${currentPort}`
      : requestUrl.hostname
    : requestUrl.host;

  const exposed = await sandbox.exposePort(8080, {
    name: 'workshop-preview',
    hostname: exposedHostname,
    token: 'previewv1'
  });
  const rawPreviewUrl =
    'exposedAt' in exposed && typeof exposed.exposedAt === 'string' ? exposed.exposedAt : exposed.url;
  const directPreviewUrl = forcePreviewIndexUrl(normalizeLocalPreviewUrl(rawPreviewUrl, request.url));
  const localFallbackPreviewUrl = buildLocalPreviewFallbackUrl(directPreviewUrl, request.url);

  return {
    ok: true,
    exampleId: 'interactive-dev',
    sandboxId,
    summary:
      exampleById['interactive-dev'].messages?.successSummary ??
      'Preview server started in sandbox and exposed through URL.',
    previewUrl: directPreviewUrl,
    details: {
      directPreviewUrl,
      localFallbackPreviewUrl
    },
    exitCode: 0
  };
}

async function runCiTesting(): Promise<ExampleRunResult> {
  const sandboxId = 'workshop-ci-testing';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  await sandbox.mkdir('/workspace/ci', { recursive: true });
  await sandbox.writeFile(
    '/workspace/ci/math.js',
    `export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}`
  );

  await sandbox.writeFile(
    '/workspace/ci/math.test.js',
    `import test from 'node:test';
import assert from 'node:assert/strict';
import { add, multiply } from './math.js';

test('add works', () => {
  assert.equal(add(2, 3), 5);
});

test('multiply works', () => {
  assert.equal(multiply(3, 7), 21);
});`
  );

  const result = await sandbox.exec('node --test /workspace/ci/math.test.js');

  return {
    ok: result.success,
    exampleId: 'ci-testing',
    sandboxId,
    summary: result.success
      ? (exampleById['ci-testing'].messages?.successSummary ?? 'Tests passed in an isolated sandbox.')
      : (exampleById['ci-testing'].messages?.failureSummary ?? 'Test run failed in sandbox.'),
    output: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

async function runUntrustedCode(input: string | undefined): Promise<ExampleRunResult> {
  const sandboxId = 'workshop-security-untrusted';
  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  const code =
    input?.trim() ||
    `import os
print("sandbox cwd:", os.getcwd())
print("attempting sensitive operation simulation...")
print("entries in /:", len(os.listdir("/")))`;

  await sandbox.mkdir('/workspace/security', { recursive: true });
  await sandbox.writeFile('/workspace/security/untrusted.py', `${code}\n`);
  const result = await sandbox.exec('python3 /workspace/security/untrusted.py', { timeout: 2500 });

  return {
    ok: result.success,
    exampleId: 'security-untrusted',
    sandboxId,
    summary:
      exampleById['security-untrusted'].messages?.successSummary ??
      'Untrusted code executed inside sandbox boundary with timeout controls.',
    output: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

async function serveSpaAssets(request: Request): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);

  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const url = new URL(request.url);
  if (url.pathname.includes('.')) {
    return assetResponse;
  }

  const indexRequest = new Request(new URL('/index.html', request.url));
  return await env.ASSETS.fetch(indexRequest);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function positiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
