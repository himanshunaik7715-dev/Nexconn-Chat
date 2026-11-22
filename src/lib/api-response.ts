export type ApiResponse = {
  error?: string;
  fieldErrors?: Record<string, string>;
  [key: string]: unknown;
};

/** Read API JSON without surfacing a raw parser exception or logging response contents. */
export async function readApiResponse<T extends object = ApiResponse>(response: Response, action: string): Promise<T> {
  const body = await response.text();
  const status = `HTTP ${response.status}`;

  if (!body.trim()) {
    throw new Error(`${action} failed (${status}): the API server returned an empty response. Please retry; restart the Nexconn server if it continues.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`${action} failed (${status}): the API server returned an unreadable response. Check that the Nexconn API server is running.`);
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`${action} failed (${status}): the API server returned an unexpected response. Check that the Nexconn API server is running.`);
  }

  return payload as T;
}
