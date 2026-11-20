export async function register() {
  // Only run on the server-side, not during edge builds
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupValidation } = await import('@/lib/stellar/config-validator');
    const { startMonitoring } = await import('@/lib/stellar/health-monitor');
    const { startEventSync } = await import('@/lib/blockchain/event-sync');

    // Validate Stellar network configuration before starting any dependent services.
    // runStartupValidation logs structured diagnostics and returns false on failure.
    // We continue startup so the app remains reachable, but Stellar-dependent
    // services will reject calls until the configuration is corrected.
    const stellarConfigValid = runStartupValidation();

    if (stellarConfigValid) {
      // Start the health monitor and event sync only when config is valid.
      // This prevents misleading error noise from services that cannot function
      // with an invalid or missing Stellar configuration.
      startMonitoring();
      startEventSync();
    }
  }
}
