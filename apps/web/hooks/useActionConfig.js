"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_CONFIG = {
  defect_requires_photo: false,
  spare_parts_workflow: "shopify",
  exchange_workflow: "shopify",
};

export function useActionConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [initialConfig, setInitialConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/action-config", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const loaded = {
          defect_requires_photo: data?.action_config?.defect_requires_photo ?? false,
          spare_parts_workflow: data?.action_config?.spare_parts_workflow ?? "shopify",
          exchange_workflow: data?.action_config?.exchange_workflow ?? "shopify",
        };
        setConfig(loaded);
        setInitialConfig(loaded);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const isDirty = JSON.stringify(config) !== JSON.stringify(initialConfig);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/action-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      const saved = {
        defect_requires_photo: data.action_config?.defect_requires_photo ?? false,
        spare_parts_workflow: data.action_config?.spare_parts_workflow ?? "shopify",
        exchange_workflow: data.action_config?.exchange_workflow ?? "shopify",
      };
      setConfig(saved);
      setInitialConfig(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const update = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  return { config, loading, saving, error, isDirty, update, save, reset };
}
