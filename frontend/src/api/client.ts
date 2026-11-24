import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

const TOKEN_KEY = "sf_access_token";
const REFRESH_KEY = "sf_refresh_token";

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY) || localStorage.getItem(REFRESH_KEY);
}

export function saveTokens(access: string, refresh: string, remember = true) {
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(TOKEN_KEY);
  other.removeItem(REFRESH_KEY);
  store.setItem(TOKEN_KEY, access);
  store.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  try {
    const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (clientTz) {
      config.headers["X-Client-Timezone"] = clientTz;
    }
  } catch {
    // Fallback to server timezone if Intl is unavailable
  }
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else if (token) prom.resolve(token);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/login/") &&
      !originalRequest.url?.includes("/auth/refresh/")
    ) {
      const refresh = getRefreshToken();
      if (!refresh) {
        clearTokens();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (newToken) => {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const res = await axios.post(`${API_BASE}/auth/refresh/`, { refresh });
        const newAccess = res.data.access;
        const newRefresh = res.data.refresh || refresh;
        const remember = Boolean(localStorage.getItem(REFRESH_KEY));
        saveTokens(newAccess, newRefresh, remember);
        processQueue(null, newAccess);
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        window.dispatchEvent(new Event("sf:session-expired"));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (!data) return err.message || "Network error. Please check your connection.";
    if (typeof data === "string") {
      if (/<(?:!doctype|html|head|body)/i.test(data)) {
        const match = data.match(/<pre[^>]*class="exception_value"[^>]*>([\s\S]*?)<\/pre>/i);
        if (match && match[1]) {
          const clean = match[1].replace(/<[^>]+>/g, "").trim();
          if (clean) return clean;
        }
        return "Server error occurred. Please check your inputs and try again.";
      }
      return data;
    }
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.non_field_errors)) return data.non_field_errors[0];
    const firstKey = Object.keys(data)[0];
    if (firstKey) {
      const val = data[firstKey];
      if (Array.isArray(val)) return `${firstKey}: ${val[0]}`;
      if (typeof val === "string") return `${firstKey}: ${val}`;
    }
  }
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

export async function downloadAuthenticatedFile(url: string, filename: string) {
  const response = await api.get(url, { responseType: "blob" });
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}
