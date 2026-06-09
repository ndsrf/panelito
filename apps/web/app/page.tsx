export default function HomePage() {
  return (
    <main className="flex min-h-[var(--app-height,100vh)] flex-col items-center justify-center gap-4 p-8">
      <div className="text-center space-y-3">
        <h1 className="text-5xl font-bold tracking-tight text-foreground">
          Panelito
        </h1>
        <p className="text-sm font-mono text-muted-foreground">
          v0.1.0 — Phase 1: Live Session Shell
        </p>
        <p className="text-muted-foreground max-w-sm text-sm mt-4">
          Project Multiverse scaffold is live. Run{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
            pnpm dev
          </code>{" "}
          to start the full local stack.
        </p>
      </div>
    </main>
  );
}
