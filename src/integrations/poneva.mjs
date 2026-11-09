export function getPonevaStatus(config) {
  const credentialsPresent = Boolean(config.ponevaStore && config.ponevaApiToken);
  return {
    credentialsPresent,
    connected: false,
    status: credentialsPresent ? 'API CONTRACT REQUIRED' : 'NOT CONFIGURED',
    storeConfigured: Boolean(config.ponevaStore),
    tokenConfigured: Boolean(config.ponevaApiToken),
    message: credentialsPresent
      ? 'Poneva credentials are present, but no sales/orders reporting endpoint has been verified. No request is sent until the account-specific API contract is confirmed.'
      : 'Add PONEVA_STORE and PONEVA_API_TOKEN when the account credentials are available.',
    supportedWorkflow: 'Poneva CSV reconciliation can be added once the export columns or reporting API are confirmed.'
  };
}
