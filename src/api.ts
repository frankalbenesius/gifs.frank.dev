export interface User {
  id: string;
  email: string;
}

export interface Gif {
  id: string;
  createdAt: number;
  sizeBytes: number;
  fileUrl: string;
  posterUrl: string;
}

let csrfToken = "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (
    options.method &&
    !["GET", "HEAD"].includes(options.method.toUpperCase())
  ) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" && result !== null && "error" in result
        ? String(result.error)
        : "Something went wrong.";
    throw new ApiError(message, response.status);
  }
  return result as T;
}

export async function loadSession(): Promise<{
  user: User | null;
  signInConfigured: boolean;
}> {
  const result = await api<{
    user: User | null;
    csrf: string;
    signInConfigured: boolean;
  }>("/api/session");
  csrfToken = result.csrf;
  return { user: result.user, signInConfigured: result.signInConfigured };
}

export function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  data?: object,
): RequestInit {
  return { method, body: data ? JSON.stringify(data) : undefined };
}
