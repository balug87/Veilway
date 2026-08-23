type Props = { text: string };

export function LoadingScreen({ text }: Props) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm text-center">
        <p className="font-display text-3xl tracking-[-0.03em] text-fg">Veilway</p>
        <div className="mx-auto mt-8 h-px w-24 overflow-hidden bg-border">
          <div className="h-full w-1/2 animate-pulse bg-fg" />
        </div>
        <p className="mt-6 text-sm text-muted">{text}</p>
        <p className="mt-2 text-xs text-subtle">Charting streets from OpenStreetMap</p>
      </div>
    </div>
  );
}
