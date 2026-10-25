import { useCallback, useEffect, useRef, useState } from "react";
import { getConfiguredApiHost } from "@/lib/api-host";
import {
  fetchServerMappings,
  saveServerMapping,
} from "@/lib/nfc/server-mapping-api";
import type {
  ServerMapping,
  ServerMappingInput,
} from "@/lib/nfc/server-mappings";

export function useServerMappings(host: string | null, apiKey: string) {
  const [servers, setServers] = useState<ServerMapping[]>([]);
  const [loading, setLoading] = useState(host !== null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [catalogHost, setCatalogHost] = useState(host);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const writeInFlight = useRef(false);

  // Discard the previous backend's catalog before rendering the new one.
  if (catalogHost !== host) {
    setCatalogHost(host);
    setServers([]);
    setLoading(host !== null);
    setError(null);
    setSaveError(null);
  }

  const load = useCallback(() => {
    if (
      host === null ||
      host !== getConfiguredApiHost() ||
      writeInFlight.current
    )
      return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    return fetchServerMappings(controller.signal)
      .then((rows) => {
        if (
          mounted.current &&
          request.current === controller &&
          host === getConfiguredApiHost()
        ) {
          setServers(rows);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (
          mounted.current &&
          request.current === controller &&
          host === getConfiguredApiHost()
        ) {
          setError(
            controller.signal.aborted
              ? "Loading servers timed out. Check the backend and try again."
              : cause instanceof Error
                ? cause.message
                : "Could not load servers.",
          );
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (mounted.current && request.current === controller)
          setLoading(false);
      });
  }, [host]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  const refresh = () => {
    if (
      host === null ||
      host !== getConfiguredApiHost() ||
      writeInFlight.current
    )
      return;
    setLoading(true);
    setError(null);
    return load();
  };

  const save = async (input: ServerMappingInput) => {
    if (host === null || host !== getConfiguredApiHost())
      throw new Error("Connect to the backend before saving a server.");
    if (writeInFlight.current)
      throw new Error("A server save is already in progress.");
    writeInFlight.current = true;
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setSaving(true);
    setSaveError(null);
    try {
      const server = await saveServerMapping(input, apiKey);
      if (mounted.current && host === getConfiguredApiHost()) {
        setServers((current) =>
          [...current.filter((row) => row.id !== server.id), server].sort(
            (a, b) => a.serverName.localeCompare(b.serverName) || a.id - b.id,
          ),
        );
        setError(null);
      }
      return server;
    } catch (cause) {
      if (mounted.current && host === getConfiguredApiHost())
        setSaveError(
          cause instanceof Error
            ? cause.message
            : "Could not save the server mapping.",
        );
      throw cause;
    } finally {
      writeInFlight.current = false;
      if (mounted.current) {
        setSaving(false);
        // A save may have interrupted the initial list load. Re-read the full
        // catalog so adding one row never hides servers already in the DB.
        void refresh();
      }
    }
  };

  return {
    servers,
    loading,
    error,
    saving,
    saveError,
    refresh,
    save,
    clearSaveError: () => setSaveError(null),
  };
}
