export async function triggerN8nWebhook(url: string, payload: Record<string, any>): Promise<void> {
  if (!url) {
    return
  }
  try {
    // @ts-ignore fetch is available in the Node runtime
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('Failed to call n8n webhook', err)
  }
}
