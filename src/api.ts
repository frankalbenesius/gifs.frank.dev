export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Gif {
  id: string;
  ownerId: string;
  ownerName: string;
  owned: boolean;
  tags: string[];
  groupIds: string[];
  createdAt: number;
  sizeBytes: number;
  fileUrl: string;
  posterUrl: string;
}

export interface Group {
  id: string;
  name: string;
  role: "member" | "manager";
  memberCount: number;
}

export interface Member {
  id: string;
  displayName: string;
  email?: string;
  role: "member" | "manager";
}

export interface Invite {
  token: string;
  expiresAt: number;
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
  emailConfigured: boolean;
}> {
  const result = await api<{
    user: User | null;
    csrf: string;
    emailConfigured: boolean;
  }>("/api/session");
  csrfToken = result.csrf;
  return { user: result.user, emailConfigured: result.emailConfigured };
}

export function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  data?: object,
): RequestInit {
  return { method, body: data ? JSON.stringify(data) : undefined };
}
