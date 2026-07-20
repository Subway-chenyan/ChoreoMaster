const EXPORT_PROGRESS_REPORT_INTERVAL_MS = 250;

export function createThrottledProgressReporter(
  report: (progress: number) => void,
  now: () => number = () => performance.now(),
): (progress: number) => void {
  let lastReportedAt = now();

  return (progress: number): void => {
    const currentTime = now();
    if (currentTime - lastReportedAt < EXPORT_PROGRESS_REPORT_INTERVAL_MS) return;
    lastReportedAt = currentTime;
    report(progress);
  };
}
