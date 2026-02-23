export type SessionId =
  | 'fundamentals'
  | 'executing-code'
  | 'data-workflows'
  | 'preview-workflows'
  | 'automation-ci';

export type SessionDefinition = {
  id: SessionId;
  slug: string;
  title: string;
  focus: string;
  demo: string;
  handsOn: string;
  resultSummary: string;
  useCases?: string[];
  includesTerminal?: boolean;
};

export const sessions: SessionDefinition[] = [
  {
    id: 'fundamentals',
    slug: '/sessions/fundamentals',
    title: 'Session 1: Sandbox Fundamentals',
    focus:
      'What sandboxes solve, how they differ from VMs/serverless, and running a first command.',
    demo: 'Execute a simple shell command and inspect output.',
    handsOn: 'Launch a live PTY terminal connected to a sandbox session.',
    resultSummary: 'Executed a first shell command in an isolated sandbox.',
    useCases: [
      'Bootstrapping isolated environments for onboarding demos',
      'Running one-off shell diagnostics without touching host machines',
      'Teaching container filesystem and process basics safely'
    ],
    includesTerminal: true
  },
  {
    id: 'executing-code',
    slug: '/sessions/executing-code',
    title: 'Session 2: Executing Code Safely',
    focus: 'Run Node.js and Python scripts and inspect stdout/stderr/exit codes.',
    demo: 'Write and execute short scripts in a sandbox.',
    handsOn: 'Run script execution endpoint and inspect structured output.',
    resultSummary: 'Executed Python safely and captured output.',
    useCases: [
      'Evaluating AI-generated snippets before production adoption',
      'Running user-submitted code in a controlled boundary',
      'Validating script behavior with deterministic runtime output'
    ]
  },
  {
    id: 'data-workflows',
    slug: '/sessions/data-workflows',
    title: 'Session 3: Data and Analysis Workflows',
    focus: 'Load datasets, transform them, and return computed results.',
    demo: 'Analyze CSV data inside a sandbox.',
    handsOn: 'Run data analysis endpoint and inspect summary metrics.',
    resultSummary: 'Ran CSV analysis workflow in sandbox.',
    useCases: [
      'Ad hoc analytics on uploaded CSV files',
      'Generating charts and reading artifacts back from sandbox files',
      'Pairing Workers AI code generation with bounded execution'
    ]
  },
  {
    id: 'preview-workflows',
    slug: '/sessions/preview-workflows',
    title: 'Session 4: Interactive and Preview-Based Workflows',
    focus: 'Start HTTP services in sandbox containers and expose preview URLs.',
    demo: 'Run a local preview app in a sandbox.',
    handsOn: 'Launch preview endpoint and open the generated URL.',
    resultSummary: 'Started preview workflow and exposed an app URL.',
    useCases: [
      'Ephemeral app previews for pull requests',
      'Tooling UIs hosted inside per-task sandboxes',
      'Developer workflows that need clickable service URLs'
    ]
  },
  {
    id: 'automation-ci',
    slug: '/sessions/automation-ci',
    title: 'Session 5: Automation and CI Patterns',
    focus: 'Run isolated tests/builds and stream logs for automation flows.',
    demo: 'Execute a test workflow in an isolated environment.',
    handsOn: 'Run CI endpoint and inspect pass/fail output.',
    resultSummary: 'Ran test automation workflow in isolation.',
    useCases: [
      'Per-commit test execution in clean environments',
      'Secure build pipelines for untrusted repositories',
      'Background automation jobs with auditable logs'
    ]
  }
];

export const sessionById = Object.fromEntries(
  sessions.map((session) => [session.id, session])
) as Record<SessionId, SessionDefinition>;
