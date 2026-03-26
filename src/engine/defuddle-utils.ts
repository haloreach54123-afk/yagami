type WarnFn = (...args: unknown[]) => void;

interface DefuddleWarnFilterState {
  installed: boolean;
  activeScopes: number;
  suppressedCount: number;
  originalWarn: WarnFn;
}

const state: DefuddleWarnFilterState = {
  installed: false,
  activeScopes: 0,
  suppressedCount: 0,
  originalWarn: (...args: unknown[]) => {
    console.warn(...args);
  },
};

function hasInvalidUrlShape(value: unknown): value is { code?: unknown; input?: unknown } {
  return Boolean(value) && typeof value === "object";
}

function isDefuddleInvalidUrlWarning(args: unknown[]): boolean {
  const head = String(args[0] ?? "")
    .trim()
    .toLowerCase();

  if (!head.includes("failed to parse url")) return false;

  const details = args.find((value) => hasInvalidUrlShape(value));
  if (!details) return true;

  const code = String(details.code ?? "").trim();
  if (code && code !== "ERR_INVALID_URL") return false;

  const input = String(details.input ?? "").trim();
  if (!input) return true;

  return input.includes(",");
}

function ensureWarnFilterInstalled(): void {
  if (state.installed) return;

  state.originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (state.activeScopes > 0 && isDefuddleInvalidUrlWarning(args)) {
      state.suppressedCount += 1;
      return;
    }

    state.originalWarn(...args);
  };

  state.installed = true;
}

export async function withSuppressedDefuddleWarnings<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; suppressedCount: number }> {
  ensureWarnFilterInstalled();

  const startSuppressedCount = state.suppressedCount;
  state.activeScopes += 1;

  try {
    const value = await operation();
    return {
      value,
      suppressedCount: state.suppressedCount - startSuppressedCount,
    };
  } finally {
    state.activeScopes = Math.max(0, state.activeScopes - 1);
  }
}
