export async function register() {
  // Only run on the server-side, not during edge builds
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMonitoring } = await import('@/lib/stellar/health-monitor');
    const { startEventSync } = await import('@/lib/blockchain/event-sync');

    // Start the existing health monitor
    startMonitoring();

    // Start our new event synchronization service
    startEventSync();
  }
}