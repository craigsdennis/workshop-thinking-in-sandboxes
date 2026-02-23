import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Badge } from '@cloudflare/kumo/components/badge';
import { Button } from '@cloudflare/kumo/components/button';
import { Input, Textarea } from '@cloudflare/kumo/components/input';
import { Surface } from '@cloudflare/kumo/components/surface';
import type { ExampleRunResult, SessionRunResult } from './types';
import { examples, sessions, type ExampleDefinition, type SessionDefinition } from './workshop';

const TerminalLab = lazy(async () => {
  const mod = await import('./TerminalLab');
  return { default: mod.TerminalLab };
});

type RunnerState<T> = {
  loading: boolean;
  data?: T;
  error?: string;
};

function WorkshopFrame({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="page-shell">
      <header className="hero-grid">
        <div className="hero-lines" aria-hidden="true" />
        <div className="hero-content">
          <p className="mono-kicker">Thinking in Sandboxes</p>
          <h1>Sandbox Workshop</h1>
          <p>
            Explore workshop sessions and hands-on examples focused on practical sandbox workflows.
          </p>
          <div className="badge-row">
            <Badge variant="secondary">Educational</Badge>
            <Badge variant="beta">Sandbox Patterns</Badge>
          </div>
        </div>
      </header>

      <div className="workshop-layout">
        <aside className="left-nav">
          <div className="nav-title">Sessions</div>
          <nav>
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={session.slug}
                className={`route-link ${location.pathname === session.slug ? 'route-link-active' : ''}`}
              >
                {session.title}
              </Link>
            ))}
          </nav>

          <div className="nav-title nav-separator">Exercises</div>
          <nav>
            {examples.map((example) => (
              <Link
                key={example.id}
                to={example.slug}
                className={`route-link ${location.pathname === example.slug ? 'route-link-active' : ''}`}
              >
                {example.title}
              </Link>
            ))}
          </nav>
        </aside>
        <main>{children}</main>
      </div>

      <footer className="sticky-footer">
        <p>
          Build with 🧡 on{' '}
          <a href="https://workers.cloudflare.com" target="_blank" rel="noreferrer">
            Cloudflare Workers
          </a>{' '}
          and{' '}
          <a href="https://sandbox.cloudflare.com" target="_blank" rel="noreferrer">
            Sandboxes
          </a>
        </p>
        <p>
          <a href="https://github.com/craigsdennis/workshop-thinking-in-sandboxes" target="_blank" rel="noreferrer">
            👀 the code
          </a>
        </p>
      </footer>
    </div>
  );
}

function ResultCard({
  title,
  summary,
  sandboxId,
  exitCode,
  previewUrl,
  output,
  stderr,
  details
}: {
  title: string;
  summary: string;
  sandboxId: string;
  exitCode?: number;
  previewUrl?: string;
  output?: string;
  stderr?: string;
  details?: unknown;
}) {
  const detailRecord =
    details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined;
  const generatedCode =
    detailRecord && typeof detailRecord.generatedCode === 'string'
      ? detailRecord.generatedCode
      : undefined;
  const chartDataUri =
    detailRecord && typeof detailRecord.chartDataUri === 'string'
      ? detailRecord.chartDataUri
      : undefined;
  const chartGenerationMessage =
    detailRecord && typeof detailRecord.chartGenerationMessage === 'string'
      ? detailRecord.chartGenerationMessage
      : undefined;
  const chartBytes =
    detailRecord && typeof detailRecord.chartBytes === 'number' ? detailRecord.chartBytes : undefined;
  const directPreviewUrl =
    detailRecord && typeof detailRecord.directPreviewUrl === 'string'
      ? detailRecord.directPreviewUrl
      : undefined;
  const localFallbackPreviewUrl =
    detailRecord && typeof detailRecord.localFallbackPreviewUrl === 'string'
      ? detailRecord.localFallbackPreviewUrl
      : undefined;

  return (
    <div className="result-panel">
      <h3>{title}</h3>
      <p>{summary}</p>
      {previewUrl ? (
        <p>
          Preview URL:{' '}
          <a href={previewUrl} target="_blank" rel="noreferrer">
            {previewUrl}
          </a>
        </p>
      ) : null}
      {directPreviewUrl ? (
        <p>
          Direct Preview URL:{' '}
          <a href={directPreviewUrl} target="_blank" rel="noreferrer">
            {directPreviewUrl}
          </a>
        </p>
      ) : null}
      {localFallbackPreviewUrl ? (
        <p>
          Local Fallback URL:{' '}
          <a href={localFallbackPreviewUrl} target="_blank" rel="noreferrer">
            {localFallbackPreviewUrl}
          </a>
        </p>
      ) : null}
      <p>
        Sandbox: <code>{sandboxId}</code>
      </p>
      <p>
        Exit code: <code>{String(exitCode ?? 'n/a')}</code>
      </p>
      {chartGenerationMessage ? <p>{chartGenerationMessage}</p> : null}
      {typeof chartBytes === 'number' ? <p>Read with <code>readFile</code>: {chartBytes} bytes</p> : null}
      {generatedCode ? <pre>{generatedCode}</pre> : null}
      {chartDataUri ? <img className="analysis-chart" src={chartDataUri} alt="Generated analysis chart" /> : null}
      {output ? <pre>{output}</pre> : null}
      {stderr ? <pre>{stderr}</pre> : null}
    </div>
  );
}

function SessionPage({ session }: { session: SessionDefinition }) {
  const [state, setState] = useState<RunnerState<SessionRunResult>>({ loading: false });

  async function runSessionDemo() {
    setState({ loading: true });
    try {
      const response = await fetch(`/api/sessions/${session.id}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as SessionRunResult;
      setState({ loading: false, data });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <Surface as="section" className="exercise-panel">
      <div className="exercise-header">
        <h2>{session.title}</h2>
        <p>{session.focus}</p>
      </div>

      <p className="exercise-prompt">Demo: {session.demo}</p>
      <p className="exercise-prompt">Hands-on: {session.handsOn}</p>
      {session.useCases && session.useCases.length > 0 ? (
        <div className="exercise-prompt">
          <strong>Example use cases:</strong>
          <ul>
            {session.useCases.map((useCase) => (
              <li key={useCase}>{useCase}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="action-row">
        <Button variant="primary" onClick={runSessionDemo} loading={state.loading}>
          {state.loading ? 'Running session...' : 'Run session demo'}
        </Button>
      </div>

      {session.includesTerminal ? (
        <Suspense fallback={<div className="result-panel">Loading terminal...</div>}>
          <TerminalLab />
        </Suspense>
      ) : null}

      {state.error ? <pre className="error-panel">{state.error}</pre> : null}
      {state.data ? (
        <ResultCard
          title="Session Output"
          summary={state.data.summary}
          sandboxId={state.data.sandboxId}
          exitCode={state.data.exitCode}
          previewUrl={state.data.previewUrl}
          output={state.data.output}
          stderr={state.data.stderr}
          details={state.data.details}
        />
      ) : null}
    </Surface>
  );
}

function ExamplePage({ example }: { example: ExampleDefinition }) {
  const [input, setInput] = useState(example.defaultInput);
  const [prompt, setPrompt] = useState('Transform this text and show simple statistics.');
  const [analysisQuestion, setAnalysisQuestion] = useState(
    'Which region has the best revenue per user, and can you visualize it?'
  );
  const [generatedCode, setGeneratedCode] = useState(example.defaultInput);
  const [state, setState] = useState<RunnerState<ExampleRunResult>>({ loading: false });
  const [generating, setGenerating] = useState(false);
  const isAiGeneratedCode = example.id === 'ai-generated-code';
  const isDataAnalysis = example.id === 'data-analysis';

  useEffect(() => {
    setInput(example.defaultInput);
    setGeneratedCode(example.defaultInput);
  }, [example.defaultInput, example.id]);

  async function runExample() {
    setState({ loading: true });

    try {
      const endpoint = `/api/examples/${example.id}`;
      const payloadInput = isAiGeneratedCode ? generatedCode : input;
      const payload =
        isAiGeneratedCode
          ? { input: payloadInput }
          : isDataAnalysis
            ? { input: payloadInput, prompt: analysisQuestion }
            : { input: payloadInput };
      const response =
        example.method === 'GET'
          ? await fetch(endpoint)
          : await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload)
            });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed (${response.status})`);
      }

      const data = (await response.json()) as ExampleRunResult;
      setState({ loading: false, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ loading: false, error: message });
    }
  }

  async function generatePython() {
    setGenerating(true);
    try {
      const response = await fetch('/api/examples/ai-generated-code/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { ok: boolean; code: string };
      setGeneratedCode(data.code);
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Surface as="section" className="exercise-panel">
      <div className="exercise-header">
        <h2>{example.title}</h2>
        <p>{example.workshopGoal}</p>
      </div>

      <p className="exercise-prompt">{example.prompt}</p>

      <div className="controls">
        <Input
          label="Example API"
          value={`/api/examples/${example.id}`}
          readOnly
          aria-label="Example API route"
        />
        {isAiGeneratedCode ? (
          <>
            <Textarea
              label="User Prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              rows={4}
            />
            <div className="action-row">
              <Button variant="secondary" onClick={generatePython} loading={generating}>
                {generating ? 'Generating...' : 'Generate Python'}
              </Button>
            </div>
            <Textarea
              label="Generated Python (editable)"
              value={generatedCode}
              onChange={(event) => setGeneratedCode(event.currentTarget.value)}
              rows={12}
            />
          </>
        ) : null}
        {example.method === 'POST' && !isAiGeneratedCode ? (
          <>
            {isDataAnalysis ? (
              <Textarea
                label="Analysis Question"
                value={analysisQuestion}
                onChange={(event) => setAnalysisQuestion(event.currentTarget.value)}
                rows={3}
              />
            ) : null}
            <Textarea
              label="Sandbox Input"
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              rows={10}
            />
          </>
        ) : null}
      </div>

      <div className="action-row">
        <Button variant="primary" onClick={runExample} loading={state.loading}>
          {state.loading ? 'Running in sandbox...' : 'Run exercise'}
        </Button>
      </div>

      {state.error ? <pre className="error-panel">{state.error}</pre> : null}

      {state.data ? (
        <ResultCard
          title="Exercise Result"
          summary={state.data.summary}
          sandboxId={state.data.sandboxId}
          exitCode={state.data.exitCode}
          previewUrl={state.data.previewUrl}
          output={state.data.output}
          stderr={state.data.stderr}
          details={state.data.details}
        />
      ) : null}
    </Surface>
  );
}

export function App() {
  return (
    <WorkshopFrame>
      <Routes>
        <Route path="/" element={<Navigate to={sessions[0].slug} replace />} />
        {sessions.map((session) => (
          <Route key={session.id} path={session.slug} element={<SessionPage session={session} />} />
        ))}
        {examples.map((example) => (
          <Route key={example.id} path={example.slug} element={<ExamplePage example={example} />} />
        ))}
        <Route path="*" element={<Navigate to={sessions[0].slug} replace />} />
      </Routes>
    </WorkshopFrame>
  );
}
