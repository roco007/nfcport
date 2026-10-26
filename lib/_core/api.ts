import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./auth";
import { getConfiguredApiHost } from "@/lib/api-host";
import { ApiError } from "./api-error";

function extractApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const response = payload as Record<string, unknown>;
  if (typeof response.error === "string" && response.error.trim()) {
    return response.error;
  }
  if (response.error && typeof response.error === "object") {
    const nestedError = response.error as Record<string, unknown>;
    if (typeof nestedError.message === "string" && nestedError.message.trim()) {
      return nestedError.message;
    }
  }
  if (typeof response.message === "string" && response.message.trim()) {
    return response.message;
  }

  return fallback;
}

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Determine the auth method:
  // - Native platform: use stored session token as Bearer auth
  // - Web (including iframe): use cookie-based auth (browser handles automatically)
  //   Cookie is set on backend domain via POST /api/auth/session after receiving token via postMessage
  // `credentials: "omit"` is also our explicit signal that a request targets
  // an untrusted/user-configurable host. React Native does not otherwise strip
  // a manually supplied Authorization header, so never attach the app session
  // token to those requests.
  if (Platform.OS !== "web" && options.credentials !== "omit") {
    const sessionToken = await Auth.getSessionToken();
    console.log("[API] Native request prepared");
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
      console.log("[API] Authorization header added");
    }
  } else {
    console.log("[API] Web request prepared");
  }

  const baseUrl = getConfiguredApiHost() || getApiBaseUrl();
  // Ensure no double slashes between baseUrl and endpoint
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;
  try {
    console.log("[API] Making request...");
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials ?? "include",
    });

    console.log("[API] Response received");
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] Error response received");
      let errorMessage = errorText;
      try {
        const errorJson: unknown = JSON.parse(errorText);
        errorMessage = extractApiErrorMessage(errorJson, errorText);
      } catch {
        // Not JSON, use text as is
      }
      throw new ApiError(
        errorMessage || `API call failed: ${response.statusText}`,
        response.status,
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      console.log("[API] JSON response received");
      return data as T;
    }

    const text = await response.text();
    console.log("[API] Text response received");
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    // An aborted signal alone can also accompany an unrelated request failure.
    const cancelled =
      options.signal?.aborted &&
      ((typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError") ||
        (options.signal.reason !== undefined &&
          error === options.signal.reason));
    if (!cancelled) console.error("[API] Request failed");
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error occurred");
  }
}

// OAuth callback handler - exchange code for session token
// Calls /api/oauth/mobile endpoint which returns JSON with app_session_id and user
export async function exchangeOAuthCode(
  code: string,
  state: string,
): Promise<{ sessionToken: string; user: any }> {
  console.log("[API] exchangeOAuthCode called");
  // Use GET with query params
  const params = new URLSearchParams({ code, state });
  const endpoint = `/api/oauth/mobile?${params.toString()}`;
  console.log("[API] Calling OAuth mobile endpoint");
  const result = await apiCall<{ app_session_id: string; user: any }>(endpoint);

  // Convert app_session_id to sessionToken for compatibility
  const sessionToken = result.app_session_id;
  console.log("[API] OAuth exchange completed");

  return {
    sessionToken,
    user: result.user,
  };
}

// Logout
export async function logout(): Promise<void> {
  await apiCall<void>("/api/auth/logout", {
    method: "POST",
  });
}

// Get current authenticated user (web uses cookie-based auth)
export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch {
    console.error("[API] getMe failed");
    return null;
  }
}

// Establish session cookie on the backend (3000-xxx domain)
// Called after receiving token via postMessage to get a proper Set-Cookie from the backend
export async function establishSession(token: string): Promise<boolean> {
  try {
    console.log("[API] establishSession: setting cookie on backend...");
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/auth/session`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include", // Important: allows Set-Cookie to be stored
    });

    if (!response.ok) {
      console.error("[API] establishSession failed");
      return false;
    }

    console.log("[API] establishSession: cookie set successfully");
    return true;
  } catch {
    console.error("[API] establishSession error");
    return false;
  }
}
